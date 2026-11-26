# Links da Awin em lote e cota de links curtos

Data: 2026-11-26 · Subprojeto C (último) da leva "novidades da API da Awin" (D → A → B → **C**).

## Fonte (Awin, API legada, `Authorization: Bearer <token>`, 20 req/min)
- `POST https://api.awin.com/publishers/{publisherId}/linkbuilder/generate-batch` — corpo
  `{"requests":[{"advertiserId":int,"destinationUrl":string,"parameters":{"clickref","clickref2".."clickref6","campaign"}}]}`
  (até 100 por chamada); resposta `{"responses":[{"status":<http>,"body":{"url":...},"request":{...}}]}`.
  **Lote não gera link curto.** 400 com `deeplinkNotPermitted` = anunciante não permite.
- `POST .../linkbuilder/generate` — individual; com `shorten:true` devolve `shortUrl` (tidd.ly).
- `GET .../linkbuilder/quota` — `{publisherId, limit, usage}` (links curtos nas últimas 24 h).

## Desenho
1. **Clientes** em `packages/marketplaces/src/awin/linkbuilder.ts`:
   - `generateAwinLinksBatch(creds, requests)` — divide em blocos de 100, uma chamada por bloco,
     devolve resultado por item na mesma ordem (`{ok, url} | {ok:false, error}`); erro de rede/401 no
     bloco marca todos os itens do bloco como falha (401 → `AwinApiError('AWIN_UNAUTHORIZED')`
     propagado para quem chamou decidir).
   - `getAwinLinkQuota(creds)` → `{limit:number|null, usage:number, remaining:number|null}`.
   - `parseAwinCreadLink(url)` — extrai `advertiserId` (`awinmid`), `destinationUrl` (`ued`) e
     `clickref*` de um link `cread.php`; `null` para outros formatos (ex.: `pclick.php`, que não dá
     para converter sem requisitar a Awin — **nunca** fazer requisição a links de rastreio).
   - Mover `generateAwinTrackingLinkViaApi` para este arquivo (reexportar do antigo para não quebrar).
2. **Conversão em lote** — rota autenticada `POST /api/v1/marketplaces/awin/links/batch`
   `{ items: [{ url, subId? }] (1..200) }`: identifica o parceiro de cada URL (mesma lógica de
   `generateAwinPartnerLink` em `apps/api/src/lib/awin-partners.ts`), monta uma única chamada de
   lote por até 100 itens e devolve por item `{ input, url, source: 'api'|'canonical', error? }`;
   item que falhar na API cai no link canônico (`buildAwinTrackingLink`); URL de site não parceiro →
   erro por item, sem derrubar os demais. Usar onde hoje se converte vários links Awin um a um
   (verificar a aba "Por Links / CSV" da Buscar Produtos e a extensão) — se não houver conversão em
   massa, expor só a rota e usá-la na aba "Por Links / CSV" para links Awin.
3. **Links curtos no envio (opcional, desligado por padrão)** — setting `awinShortLinks`
   (boolean) com toggle no drawer da Awin, ao lado da cota ("Links curtos usados hoje: X de Y").
   No `send-offer`/`send-telegram`, quando o link final do canal é um `cread.php` direto (não o link
   do site) e o setting está ligado: antes de enviar, consulta a cota (cache 10 min no Redis por
   tenant); se `remaining` cobre os canais do item, gera o link curto de cada canal com
   `generate` + `shorten:true` (respeitando no máximo 1 chamada a cada 3,1 s por tenant via o mesmo
   limitador); falha ou cota insuficiente → mantém o link longo. Sem setting → comportamento atual.
4. **Cota no painel** — rota `GET /api/v1/marketplaces/awin/links/quota` (cache 10 min) e
   exibição no drawer da Awin.

## Fora do escopo
Encurtar links `pclick.php` (exigiria requisitar a Awin); encurtador próprio.

## Testes
- `generateAwinLinksBatch`: blocos de 100, ordem preservada, falha parcial, 401.
- `parseAwinCreadLink`; `getAwinLinkQuota`.
- Rota de lote: mistura de parceiro/não parceiro, fallback canônico.
- Envio: setting desligado = igual hoje; ligado + cota ok = link curto por canal; cota insuficiente
  ou erro = link longo; link do site nunca é encurtado.
- Web: toggle + cota no drawer; conversão em lote na aba de links (se aplicável).
- Teste garante que nenhuma requisição vai para `awin1.com` (só `api.awin.com`).
