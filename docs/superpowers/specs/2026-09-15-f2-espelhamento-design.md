# Fase 2 — Espelhamento de Grupos (Mirroring)

**Data:** 2026-09-15
**Status:** Aprovado
**Depende de:** `2026-09-14-afilados-architecture-design.md` (§7), Fase 1 completa em `main`.

## 1. Resultado esperado

O dono, com o WhatsApp conectado e participando de grupos de ofertas de terceiros, consegue:

1. Criar uma regra de espelhamento: grupos de **origem** (onde o número está) → grupos de **destino** (seus grupos), modo **Template** ou **Clone**, mídia **Imagem** ou **Preview**, template, horas de deduplicação.
2. Ver, em tempo real, cada mensagem de origem sendo espelhada, descartada (sem link / duplicada / loja sem tag) ou com erro, com o motivo.
3. Ter os links de Shopee (API), Amazon, Mercado Livre e Magalu (por tag de afiliado) trocados pelos seus antes do envio.
4. Ativar/desativar regras sem perder o histórico.

**Decisões fechadas no brainstorm:**
- Conversão de ML/Amazon/Magalu por **parâmetros na URL** (sem cookies). Amazon: `tag`; Magalu: nome da loja; **Mercado Livre: `matt_word` (ID do afiliado) e `matt_tool` (número fixo da conta)** — o usuário copia os dois de um link gerado no painel de afiliados. O link oficial do ML (`meli.la` → `/social/…?ref=<token>`) só pode ser gerado logado; isso fica para a F3 (cookies via Cookie-Editor), que substitui esta conversão por chamada ao gerador oficial.
- Origens: **grupos e comunidades**; canais (`@newsletter`) ficam para a F3.
- **Dedup**: não repetir o mesmo produto (`productKey`) no mesmo destino dentro de `dedupHours` (padrão 12).
- Modo Template com link não-Shopee → **fallback para Clone** com log `template->clone`.
- Mensagens **sem link oficial de loja são ignoradas**.

Fora da F2: canais, selos na imagem (F4), scraping de dados de ML/Amazon/Magalu (F3), espelhar texto puro.

## 2. Dados (Prisma)

```prisma
model MirrorRule {
  id, tenantId, sessionId (FK WaSession), name
  sourceJids String[], targetJids String[]
  mode MirrorMode (TEMPLATE|CLONE) @default(CLONE)
  mediaMode MediaMode (IMAGE|PREVIEW) @default(PREVIEW)
  templateId String? (FK Template)
  dedupHours Int @default(12)
  enabled Boolean @default(true)
  createdAt, updatedAt
  logs MirrorLog[]
}

enum MirrorLogStatus { MIRRORED DISCARDED ERROR }

model MirrorLog {
  id, tenantId, ruleId (FK MirrorRule, Cascade)
  sourceJid, sourceMsgId, targetJid String
  status MirrorLogStatus
  reason String?          // no-links | duplicate | unsupported-store:<KINDS> | template->clone | <erro>
  productKey String?      // "SHOPEE:987654", "AMAZON:B0ABC…"
  waMessageId String?
  createdAt
  @@index([tenantId, targetJid, productKey, createdAt])   // dedup
  @@index([ruleId, createdAt])
}
```

Migration aditiva: `MirrorRule` já existe (sourceJids, targetJids, mode, mediaMode, enabled) — ganha `sessionId`, `name`, `templateId`, `dedupHours`, `updatedAt`. `MirrorLog` tem `tenantId` e entra em `TENANT_MODELS` do `forTenant` (`MirrorRule` já está).

## 3. `packages/core` (puro)

| Função | Contrato |
|---|---|
| `extractStoreLinks(text: string): StoreLink[]` | `StoreLink = { url: string; parsed: ParsedProductUrl }` — só URLs `http(s)` cujo `parseProductUrl` retorna loja conhecida; ignora encurtadores e terceiros; remove duplicatas por URL; preserva ordem. |
| `buildAffiliateUrl(kind, url, creds): string` | `creds: { tag?: string; mattWord?: string; mattTool?: string }`. `AMAZON`: seta/substitui `?tag=<tag>`; `MERCADOLIVRE`: seta `matt_word=<mattWord>&matt_tool=<mattTool>` (ambos obrigatórios); `MAGALU`: reescreve para `https://www.magazinevoce.com.br/<tag>/<resto-do-path>`; `SHOPEE`: lança (usa API). Remove parâmetros de rastreio alheios (`utm_*`, `ref`, `sp_atk`, `xptdk`, `forceInApp`). |
| `rewriteLinks(text, replacements: Map<string,string>): string` | substitui cada URL original pela convertida (todas as ocorrências), sem tocar no resto do texto. |
| `productKey(parsed: ParsedProductUrl): string` | `${source}:${externalId}`. |
| `pickText(message)` | texto útil da mensagem (ordem: `conversation` → `extendedTextMessage.text` → `imageMessage.caption`). |

## 4. `packages/marketplaces`

Adapters `mercadolivre`, `amazon`, `magalu` (`createTagAdapter(kind)`): `checkConnection` → ok se as credenciais necessárias estão presentes (`tag` para Amazon/Magalu; `mattWord` **e** `mattTool` para ML); `toAffiliateLink` → `buildAffiliateUrl`; `search`/`fetchByUrls` → lançam `UnsupportedError('disponível na fase 3')`. Credenciais: `TagCredentials = { tag?: string; mattWord?: string; mattTool?: string }`, guardadas em `MarketplaceConnection.encryptedCredentials`; `affiliateTag` (coluna existente) recebe `tag` ou `mattWord` para exibição. Registro central `getAdapter(kind)` usado por API e worker.

## 5. Worker

### 5.1 Captura
- `BaileysGateway` ganha `onMessage(handler: (sessionId, msg: WAMessage) => void)`; registra `sock.ev.on('messages.upsert')` e repassa só `type === 'notify'`, `key.remoteJid` termina em `@g.us`, `!key.fromMe`.
- `MirrorListener` (`src/mirror/listener.ts`): cache `Map<sessionId, Map<sourceJid, MirrorRule[]>>` carregado do banco no boot e recarregado ao receber `mirror.rules.changed` no canal Redis de eventos (publicado pela API em qualquer mutação de regra). Para cada mensagem com regra(s) ativa(s): enfileira `mirror-message` por regra com `jobId = ${ruleId}:${msgId}`, payload `{ tenantId, ruleId, sessionId, sourceJid, msgId, message: BufferJSON }`, `attempts: 3`, backoff 30s.

### 5.2 Processor `mirror-message` (`src/processors/mirror-message.ts`)
Deps injetáveis (mesmo padrão de `send-offer`): `gateway`, `adapters`, `downloadMedia(msg) → Buffer`, `now`, `sleep`, `rng`, `bucketFor`.

1. Carrega regra (`!enabled` → skip), template (regra ou padrão do tenant), conexões de marketplace, janela.
2. `text = pickText(message)`; `links = extractStoreLinks(text)`; vazio → `MirrorLog DISCARDED no-links` (um por destino) e fim.
3. Conversão: Shopee → `shopee.toAffiliateLink(creds, url, generateSubId('{yyyyMMdd}-mirror-{ruleId}'))`; outras lojas → `buildAffiliateUrl` com a `affiliateTag` da conexão; sem tag → mantém URL original e marca `unsupportedStores.add(kind)`.
4. Fora da janela → `moveToDelayed(nextWindowOpen)` + `DelayedError` (nada gravado).
5. Modo efetivo: `TEMPLATE` se `rule.mode === 'TEMPLATE'` **e** todos os links são Shopee (dados via `shopee.fetchByUrls`); senão `CLONE` (reason `template->clone` quando houve fallback).
6. Saída: `CLONE` → `rewriteLinks(text, map)`; `TEMPLATE` → `renderTemplate(template, produto, { affiliateLink })`, um envio por produto. Mídia: `IMAGE` e origem tem `imageMessage` → `downloadMedia` e envia `{ kind:'image', imageBuffer, caption }` (gateway passa a aceitar `imageBuffer` além de `imageUrl`); senão `{ kind:'preview' }` com o primeiro link como `url`.
7. Por destino: dedup (`MirrorLog MIRRORED` com mesmo `productKey`+`targetJid` desde `now - dedupHours`) → `DISCARDED duplicate`; senão `waitForToken` + jitter + `gateway.sendMessage`; grava `MirrorLog MIRRORED` (`waMessageId`, `productKey`, `reason` = `template->clone` ou `unsupported-store:<KINDS>` quando aplicável) ou `ERROR`; publica `mirror.log`.
8. Falha total (ex.: sessão desconectada) → lança para o BullMQ retentar; no `failed` final grava `ERROR` por destino ainda sem log.

## 6. API (`/api/v1/mirror`)

| Rota | Comportamento |
|---|---|
| `GET /mirror/rules` | regras do tenant com `counts { mirrored, discarded, error }` das últimas 24h |
| `POST /mirror/rules` | body `mirrorRuleSchema`: `name`, `sessionId`, `sourceJids[]≥1`, `targetJids[]≥1`, `mode`, `mediaMode`, `templateId?`, `dedupHours 1..168`, `enabled`. Valida: sessão do tenant; todos os jids existem em `WaGroup` da sessão; `sourceJids ∩ targetJids = ∅`. Publica `mirror.rules.changed`. 201 |
| `PUT /mirror/rules/:id` | mesmas validações; publica evento |
| `DELETE /mirror/rules/:id` | 204; logs em cascata; publica evento |
| `POST /mirror/rules/:id/toggle` | inverte `enabled`; publica evento |
| `GET /mirror/logs?ruleId&status&limit(≤200)` | últimos logs, ordem desc, com nome do grupo destino resolvido |
| `GET /mirror/stats` | `{ today: { mirrored, discarded, error } }` |
| `PUT /marketplaces/:kind` | `AMAZON|MAGALU`: aceita `affiliateTag`; `MERCADOLIVRE`: aceita `mattWord` e `mattTool` (ambos obrigatórios juntos). Grava em `encryptedCredentials` e espelha em `affiliateTag`; status `OK` quando completo. `appId/secret` continuam só Shopee. `GET /marketplaces` devolve também `mattWord`/`mattTool` (não são segredos). |

Eventos realtime novos em `shared`: `mirror.log { ruleId, logId, status, reason?, targetJid }`; `mirror.rules.changed { }` (consumido pelo worker).

## 7. Web

- `/espelhamento`: aviso fixo "Somente links oficiais das lojas são espelhados…"; formulário "Monitorar novos grupos" (sessão; multi-select origem e destino a partir de `useGroups`; Template/Clone; Imagem/Preview; template; horas de dedup; "Adicionar monitoramento"); lista "Espelhamentos configurados (n)" com nome, origem→destino, contadores 24h, switch ativar, excluir; tabela de logs com filtro por status e atualização via `mirror.log`.
- `/config/amazon` e `/config/magalu`: saem do placeholder — campo "Tag de afiliado" (Amazon: `SEUID-20`; Magalu: nome da sua loja em `magazinevoce.com.br/<loja>`) + "Salvar". `/config/mercadolivre`: campos `matt_word` e `matt_tool` com instrução "No painel de afiliados do Mercado Livre, gere um link de qualquer produto, abra-o e copie os valores de `matt_word` e `matt_tool` da URL final"; nota "Na fase 3, com os cookies, o sistema gera o link oficial (meli.la) automaticamente". Pill de status `OK` quando completo.

## 8. Testes

- `core`: `extractStoreLinks` (mistura de lojas, encurtadores ignorados, duplicatas), `buildAffiliateUrl` (4 lojas, substituição de `tag=`/`matt_*` existentes, remoção de `utm_*`/`ref`/`forceInApp`, ML sem `mattTool` lança), `rewriteLinks`, `pickText`. Valores de afiliado nos testes são fictícios.
- `marketplaces`: adapters por tag (ok/sem tag, unsupported em `search`).
- `worker`: processor com gateway falso e `downloadMedia` falso — no-links, duplicate, template→clone, imagem clonada, preview, fora da janela, unsupported-store mantém link; listener enfileira só para regras ativas.
- `api`: CRUD com validações (jid desconhecido, origem=destino, sessão de outro tenant → 404), logs/stats, `PUT /marketplaces/AMAZON {affiliateTag}`.
- `web`: `MirrorRuleForm` (unit); E2E: criar regra → aparece na lista → toggle.

## 9. Critérios de aceite

- [ ] Mensagem com link Shopee em grupo de origem chega ao destino com link `s.shopee.com.br/...` próprio em < 10 s (dentro da janela).
- [ ] Mensagem com link Amazon chega com `?tag=<minha tag>`; link ML chega com `?matt_word=<id>&matt_tool=<n>`; sem credenciais configuradas, chega com link original e log `unsupported-store:<LOJA>`.
- [ ] Mesmo produto postado duas vezes em 12 h → segundo é `DISCARDED duplicate`.
- [ ] Regra Template + link ML → espelha em Clone com `template->clone`.
- [ ] Desativar regra interrompe o espelhamento sem reiniciar o worker.
- [ ] `pnpm test` e E2E verdes; `docker compose up -d --build` sobe tudo.
