# Fase 2 — Espelhamento (Mirroring)

**Data:** 2026-09-15
**Status:** Aprovado
**Depende de:** `2026-09-14-afilados-architecture-design.md` (§7), `2026-09-14-f1-nucleo-disparo-design.md`

## 1. Resultado esperado ao final da F2

1. O usuário escolhe grupos de origem (grupos/comunidades em que o número dele está) e grupos de destino, define modo **Template** ou **Clone**, mídia **Imagem** ou **Preview**, template e janela de dedup, e ativa a regra.
2. Toda mensagem com link oficial de loja (Shopee, Mercado Livre, Amazon, Magalu) postada em uma origem é replicada nos destinos em tempo real (respeitando a janela de operação e o rate limit), com os links trocados pelos links de afiliado do usuário.
3. Links de Shopee são convertidos pela API oficial; ML/Amazon/Magalu por **tag na URL** informada em Configurações → Conexão da loja. Loja sem tag configurada mantém o link original e registra aviso.
4. O mesmo produto não é reenviado ao mesmo destino dentro de `dedupHours` (padrão 12).
5. Mensagens sem link de loja, encurtados ou de terceiros são ignoradas com log.
6. Modo Template com produtos de lojas sem dados estruturados (ML/Amazon/Magalu na F2) cai automaticamente para Clone, com log.
7. A tela **Espelhamento** mostra as regras configuradas (com ativar/desativar e contadores) e um log em tempo real (espelhadas, descartadas, erros).

Fora da F2: canais (`@newsletter`), selos na imagem (F4), scraping de dados de ML/Amazon/Magalu (F3), espelhar mensagens sem link.

## 2. Modelo de dados

```prisma
model MirrorRule {                       // já existe; campos novos marcados com +
  id, tenantId, enabled, createdAt
  + sessionId   String                   // sessão WA que escuta as origens
  + name        String
  sourceJids    String[]
  targetJids    String[]
  mode          TEMPLATE | CLONE
  mediaMode     IMAGE | PREVIEW
  + templateId  String?                  // null → template padrão do tenant
  + dedupHours  Int @default(12)
  @@index([tenantId, enabled])
}

model MirrorLog {                        // novo
  id, tenantId, ruleId (FK MirrorRule, Cascade)
  sourceJid, sourceMsgId, targetJid
  status      MIRRORED | DISCARDED | ERROR
  reason      String?                    // no-links | duplicate | unsupported-store:<KIND> | template->clone | <erro>
  productKey  String?                    // "SHOPEE:987654" — 1º produto da mensagem
  waMessageId String?
  createdAt   DateTime @default(now())
  @@unique([ruleId, sourceMsgId, targetJid])
  @@index([tenantId, targetJid, productKey, createdAt])   // dedup
  @@index([tenantId, createdAt])
}
```

`MarketplaceConnection` para ML/Amazon/Magalu passa a ser válida só com `affiliateTag` (status `OK` quando presente; `encryptedCredentials` continua nulo até a F3).

## 3. `packages/core` — funções puras

- `extractStoreLinks(text): StoreLink[]` — `{ url, source, externalId, shopId? }` para cada URL oficial reconhecida por `parseProductUrl`; ignora `s.shopee.com.br`, `meli.la`, `amzn.to`, `magalu.link` e qualquer domínio não reconhecido. Sem duplicatas.
- `buildAffiliateUrl(kind, url, tag): string` — Amazon: adiciona/substitui `tag=<tag>`; Mercado Livre: adiciona `matt_word=<tag>&matt_tool=<tag>`; Magalu: `https://www.magazinevoce.com.br/<tag>/<path-sem-host>`; Shopee: lança (usa API). Preserva os demais parâmetros.
- `rewriteLinks(text, map: Record<string,string>): string` — substitui cada URL original pela convertida, mantendo o resto do texto intacto.
- `productKey(link): string` → `${source}:${externalId}`.
- `messageText(msg)` (no worker, depende do tipo do Baileys): extrai `conversation` | `extendedTextMessage.text` | `imageMessage.caption` | `videoMessage.caption` de um `WAMessage`.

## 4. `packages/marketplaces`

Adapters `mercadolivre`, `amazon`, `magalu` com credencial `{ affiliateTag: string }`:
- `checkConnection` → `{ ok: !!tag }`.
- `toAffiliateLink(creds, url)` → `buildAffiliateUrl(kind, url, creds.affiliateTag)`.
- `search`/`fetchByUrls` → lançam `UnsupportedError('disponível na fase 3')`.

`getAdapter(kind)` em `apps/api` e `apps/worker` devolve o adapter certo.

## 5. Worker

### 5.1 Listener
- `BaileysGateway` ganha `onMessage(handler: (sessionId, msg: WAMessage) => void)`; chama para `messages.upsert` com `type === 'notify'`, `key.remoteJid` terminando em `@g.us` e `!key.fromMe`.
- `MirrorListener`: índice em memória `sessionId → sourceJid → MirrorRule[]` (só `enabled`). Carrega no boot e recarrega ao receber `mirror.rules.changed` no canal Redis de eventos (publicado pela API em qualquer mutação de regra). Para cada mensagem com regra: enfileira `mirror-message` `{ tenantId, ruleId, sessionId, sourceJid, msgId, message: WAMessage serializado (BufferJSON) }`, `jobId = ${ruleId}:${msgId}`, `attempts: 3`, backoff exponencial 30 s.

### 5.2 Processor `mirror-message`
1. Regra ainda `enabled`? Senão `DISCARDED rule-disabled`.
2. `text = messageText(msg)`; `links = extractStoreLinks(text)`; vazio → um `MirrorLog DISCARDED no-links` (targetJid = `*`) e fim.
3. Fora da janela → `moveToDelayed(nextWindowOpen)` + `DelayedError` (padrão do `send-offer`).
4. Conversão por link: Shopee → `toAffiliateLink` da API com `subId = generateSubId('{yyyyMMdd}-mirror-{ruleId}')`; ML/Amazon/Magalu → adapter por tag; sem conexão/tag → mantém URL original e marca `unsupportedStores.add(kind)`.
5. `mode` efetivo: `TEMPLATE` só se todos os links forem Shopee e `fetchByUrls` devolver dados; senão `CLONE` (razão `template->clone` no log quando a regra pedia Template).
6. Conteúdo:
   - **CLONE**: `rewriteLinks(text, map)`; se a mensagem tem `imageMessage` e `mediaMode = IMAGE`, baixa a imagem (`downloadMediaMessage`) e envia `{ kind:'image', imageBuffer, caption }`; senão `{ kind:'preview', text, url: 1º link convertido, title/description/thumbnail do produto quando Shopee, senão só texto }`.
   - **TEMPLATE**: `renderTemplate(template.body, product, { affiliateLink, now })` por produto (1 mensagem por produto); imagem do produto quando `IMAGE`.
7. Por destino: dedup (`MirrorLog MIRRORED` com mesmo `productKey`+`targetJid` em `createdAt > now - dedupHours`) → `DISCARDED duplicate`; senão `waitForToken` + jitter + `gateway.sendMessage`; `MirrorLog MIRRORED` com `waMessageId` (ou `ERROR` com a mensagem, sem abortar os outros destinos).
8. Publica `mirror.log` `{ ruleId, targetJid, status, reason?, productKey? }` por destino.

`OutgoingImage` ganha `imageBuffer?: Buffer` como alternativa a `imageUrl`.

## 6. API

Prefixo `/api/v1/mirror`, autenticado, escopado por tenant:

| Rota | Função |
|---|---|
| `GET /rules` | regras com contadores do dia (`mirrored`, `discarded`, `errors`) |
| `POST /rules` | `mirrorRuleSchema`: `name`, `sessionId`, `sourceJids[≥1]`, `targetJids[≥1]`, `mode`, `mediaMode`, `templateId?`, `dedupHours (1–168)`, `enabled` — valida que todos os jids pertencem a `WaGroup` da sessão e que origem ∩ destino = ∅ |
| `PUT /rules/:id`, `DELETE /rules/:id`, `POST /rules/:id/toggle` | idem; toda mutação publica `mirror.rules.changed` |
| `GET /logs?ruleId&status&limit≤200` | últimos logs |
| `GET /stats` | totais do dia por status |

`PUT /marketplaces/:kind` aceita `affiliateTag` para `MERCADOLIVRE|AMAZON|MAGALU` (status `OK` se tag não vazia); `appId/secret` continuam só Shopee. `POST /marketplaces/:kind/check` para essas lojas verifica a tag.

Eventos novos em `shared`: `mirror.log`, `mirror.rules.changed`.

## 7. Web

- `/espelhamento` (substitui o placeholder): aviso "Somente links oficiais das lojas são espelhados…"; card **Monitorar novos grupos**: sessão, origens (multi-select dos grupos da sessão), destinos (multi-select, excluindo os já escolhidos como origem), Template/Clone, Imagem/Preview, template, dedup (horas), "Adicionar monitoramento"; lista **Espelhamentos configurados** (nome, origens → destinos com contadores, switch ativar, excluir); **Log** em tempo real (últimos 200, filtro por status, invalida em `mirror.log`).
- `/config/{mercadolivre,amazon,magalu}`: campo "Tag de afiliado" + Salvar + status; nota "importação de cookies/produtos disponível na F3".
- Topbar: pills dessas lojas ficam verdes com tag salva.

## 8. Testes

- `core`: `extractStoreLinks` (oficiais, encurtadores, duplicatas, texto sem link), `buildAffiliateUrl` (3 lojas, parâmetros existentes preservados), `rewriteLinks`, `productKey`.
- `marketplaces`: adapters por tag (ok/sem tag, unsupported).
- `worker`: `mirror-message` com gateway falso — no-links, duplicate, template→clone, clone com imagem (buffer), preview, loja sem tag, fora da janela, erro em um destino não bloqueia os outros; `MirrorListener` filtra por regra e ignora `fromMe`.
- `api`: CRUD + validações (jid fora da sessão, origem=destino, tenant isolation), logs/stats, `PUT /marketplaces/AMAZON {affiliateTag}`.
- `web`: teste do formulário de regra; E2E: criar regra → aparece na lista com switch.

## 9. Critérios de aceite

- [ ] Mensagem com link `shopee.com.br/...-i.X.Y` postada numa origem chega ao destino com link `s.shopee.com.br/...` (mock) em < 10 s dentro da janela.
- [ ] Mesma mensagem repetida na origem dentro de 12 h → log `duplicate`, nenhum reenvio.
- [ ] Link Amazon com tag configurada sai como `...?tag=<tag>`; sem tag configurada, sai original com log `unsupported-store:AMAZON`.
- [ ] Regra Template com link Amazon → enviado em Clone com log `template->clone`.
- [ ] Desativar a regra na UI interrompe o espelhamento sem reiniciar o worker.
- [ ] `pnpm test` e E2E verdes.
