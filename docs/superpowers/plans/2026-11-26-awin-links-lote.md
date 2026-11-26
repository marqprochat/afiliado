# Plano: links da Awin em lote e cota de links curtos

Spec: `docs/superpowers/specs/2026-11-26-awin-links-lote-design.md`. Sem migração (o setting
`awinShortLinks` fica na tabela `Setting`). Regra: nenhuma requisição a `awin1.com`, só `api.awin.com`.

## 1. Clientes (packages/marketplaces/src/awin/linkbuilder.ts)
- Teste primeiro (`test/awin-linkbuilder.test.ts`): `generateAwinLinksBatch` (blocos de 100, ordem,
  falha parcial, `deeplinkNotPermitted`, 401 → `AwinApiError('AWIN_UNAUTHORIZED')`, erro de rede marca
  o bloco), `getAwinLinkQuota`, `parseAwinCreadLink` (cread ok; pclick/outros → null),
  `generateAwinLink` com `shorten`, e uma checagem de que todo `fetch` vai para `api.awin.com`.
- Mover `generateAwinTrackingLinkViaApi` para o arquivo novo; `programmes.ts` reexporta.

## 2. API
- `lib/awin-links.ts`: `convertAwinLinksBatch(tenantId, items)` (parceiro pela mesma regra de
  `generateAwinLinkForTenant`, fallback canônico por item, erro por item p/ não parceiro),
  `getAwinQuotaForTenant` (cache Redis 10 min), leitura/escrita do setting `awinShortLinks`.
- Rotas: `POST /marketplaces/awin/links/batch`, `GET /marketplaces/awin/links/quota`,
  `PUT /marketplaces/awin/short-links`. Teste com DB (`test/awin-links.test.ts`, fetch mockado).

## 3. Worker (envio)
- `lib/awin-short-links.ts`: `createAwinShortener({tenantId, creds, enabled, channels})` — consulta a
  cota (cache 10 min por tenant no Redis), aprova se `remaining >= channels`, gera o curto com
  `generateAwinLink(..., shorten:true)` respeitando 1 chamada/3,1 s por tenant (trava no Redis);
  qualquer falha → link longo. Só atua em `awin1.com/cread.php` direto (nunca no link do site).
- Ligar em `send-offer` (por grupo, depois de `channelizeLink`) e `send-telegram` (por chat).
- Testes unitários do helper + testes com DB de envio (desligado = igual; ligado = curto por canal;
  cota insuficiente/erro = longo; link do site nunca encurtado).

## 4. Web
- Drawer da Awin: painel "Links curtos" com toggle e "Links curtos usados hoje: X de Y".
- Aba "Por Links / CSV" (fonte Awin): botão "Gerar links Awin" → rota de lote, lista com copiar.
- Testes vitest dos dois componentes.

## 5. Verificação
- vitest local (marketplaces, web, worker unit), tsc em cada pacote, testes com DB no servidor,
  rebuild Docker (api, worker, web) e health checks.
