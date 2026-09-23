# Descoberta balanceada por marketplace + melhorias na tela da fila

## Contexto

Hoje `discoverForRule` (worker) sorteia **um** marketplace aleatório por rodada de
descoberta e busca até 20 produtos dele. Ao longo do dia, com sorteio aleatório repetido,
a distribuição entre os marketplaces selecionados na regra é desigual e imprevisível — nada
garante que Shopee, Awin e AliExpress apareçam em proporção parecida.

Na tela (`RuleCard` + `QueuePanel`), a fila corta o título do produto numa linha só, não
mostra quantos itens já foram enviados hoje (a API já calcula esse número mas não expõe),
a linha não é clicável para conferir o link, e não há nenhum sinal de que a automação está
buscando produtos no momento.

Este spec cobre duas frentes independentes, entregues juntas por tocarem a mesma regra e o
mesmo painel:

1. Descoberta balanceada com redistribuição de cota e intercalação na fila.
2. Melhorias na tela: responsividade, linha clicável, "enviados hoje", selo "Buscando...".

## Fora de escopo

- Mudar o gatilho de quando a descoberta roda (continua: fila sem item manual pendente, no
  máximo uma vez por rodada de despacho — já implementado em `AutomationScheduler`).
- Mudar os filtros de elegibilidade já existentes (`matchesKeyword`, `blockedKeywords`,
  `minDiscountPct`, `minPrice`, `maxPrice`).
- Mostrar itens já disparados na lista da fila (decisão do usuário: a fila continua só com
  pendentes; o número de enviados hoje aparece como estatística, não como item na lista).

## 1. Descoberta balanceada por marketplace

### Cota

`quotaPerMarketplace = Math.floor(rule.maxOffersPerDay / rule.marketplaces.length)`. Sobra
por divisão não exata (ex.: 20/3 → 6 cada, sobram 2) fica sem uso — não é redistribuída, é
só descartada, conforme decisão do usuário.

### Busca com folga + redistribuição

Cada marketplace selecionado é buscado com a mesma folga que já existe hoje (até ~20
resultados brutos por chamada), filtrado pelos critérios da regra. Depois de aplicar a cota
base em cada marketplace, se algum ficou abaixo da cota (poucos elegíveis), a diferença é
redistribuída: os marketplaces que sobraram itens elegíveis além da própria cota cedem um
item extra por vez, em rodízio, até fechar a diferença total ou esgotar todo mundo. Nenhuma
chamada extra à API é feita para isso — a redistribuição usa só o que já veio na busca com
folga de cada marketplace.

Algoritmo, dado `results: Map<MarketplaceKind, ProductData[]>` (já filtrados, um array por
marketplace selecionado, na ordem de `rule.marketplaces`):

1. `taken: Map<MarketplaceKind, ProductData[]>` — para cada marketplace, pega os primeiros
   `min(quota, results[m].length)` itens.
2. `shortfall = soma, para cada marketplace, de max(0, quota - taken[m].length)`.
3. Enquanto `shortfall > 0` e existir algum marketplace com itens sobrando (
   `results[m].length > taken[m].length`): percorre os marketplaces em rodízio (na ordem de
   `rule.marketplaces`), e para cada um que ainda tem sobra, move mais um item de
   `results[m]` para `taken[m]` e decrementa `shortfall`. Para o rodízio assim que
   `shortfall` chega a 0 ou uma volta completa não move nenhum item (todos esgotados).

### Intercalação na fila

Depois de calcular `taken` por marketplace, os itens entram na fila alternando a origem:
round-robin sobre `rule.marketplaces`, pegando um item de cada vez (pulando marketplaces que
já esgotaram seu `taken`), até esvaziar todos. Como a fila já ordena por `position`
(autoincrement, coluna adicionada na feature anterior), a ordem de `create()` de cada item é
a própria ordem de disparo — não precisa calcular posição manualmente.

### Escopo dos marketplaces

Todos os marketplaces que a regra tiver selecionado participam do balanceamento, incluindo
Mercado Livre/Amazon/Magalu (busca por scraping, best-effort). Um marketplace que não retornar
nada (ex.: ML bloqueado por anti-bot) simplesmente fica com `taken = []` e sua cota inteira
vira `shortfall`, redistribuída para os demais — o mecanismo já cobre esse caso sem tratamento
especial.

### Keyword

Continua sorteando uma keyword da regra por rodada de descoberta (como hoje), aplicada igual
em todos os marketplaces daquela rodada — mantém o lote coerente tematicamente.

## 2. Melhorias na tela da fila

### Responsividade + descrição em várias linhas

Em `QueuePanel`, remove a classe `truncate` do texto do item — o título do produto (ou
"Cupom X") passa a quebrar em várias linhas em vez de cortar com reticências. Ajusta o layout
do item (`flex` → permite wrap) e do card da regra (`RuleCard`) para não gerar overflow
horizontal em telas estreitas: a linha de estatísticas (`Frescos p/ enviar · Buscados hoje ·
Último disparo`) e o cabeçalho da regra usam `flex-wrap` em vez de depender de espaço
horizontal fixo.

### Linha clicável para teste manual

Cada `<li>` da fila vira clicável (fora da área do botão "Remover" e do próprio handle de
arrastar): clicar abre `window.open(url, '_blank', 'noopener,noreferrer')`, onde `url` é
`it.product?.originalUrl` para itens `PRODUCT` ou `it.coupon?.sourceUrl` para itens `COUPON`
(quando o cupom não tiver `sourceUrl`, o clique não faz nada). O drag-and-drop continua
funcionando normalmente — o clique só dispara se não houve arraste (sem `dragstart` disparado
naquele gesto).

### "Enviados hoje"

`AutomationStats` (tipo já existe, tanto na API quanto no web) já calcula
`dispatchedToday` — só não aparece na tela. `RuleCard` ganha mais um item na linha de
estatísticas: `Enviados hoje: {rule.stats.dispatchedToday}`.

### Selo "Buscando..."

**Worker:** em `discoverForRule`, antes de disparar as buscas nos marketplaces, seta uma
chave no Redis `automation-discovering:{ruleId}` com TTL de segurança de 5 minutos (evita
selo travado para sempre se o processo cair no meio da busca). Remove a chave num `finally`
ao terminar (sucesso ou erro).

**API:** `getAutomationStats` ganha um campo `isDiscovering: boolean`, calculado checando a
existência dessa chave no Redis. `AutomationStats` (schema/tipo compartilhado e tipo web)
ganha o campo.

**Tempo real:** novo evento `{ type: 'automation.discovery'; ruleId: string; discovering:
boolean }`, publicado pelo worker logo após setar/remover a chave Redis (mesmo canal já usado
para `automation.queue.updated`). O client web (`realtime.tsx`) invalida `['automations']`
quando recebe esse evento — a real atualização do selo vem do refetch das stats (que já
reflete o Redis), não do payload do evento em si. Isso garante: (a) feedback quase instantâneo
enquanto a aba está aberta, e (b) estado correto mesmo se a página for recarregada no meio da
busca, já que a leitura do Redis é a fonte de verdade, não o evento.

**UI:** `RuleCard`, quando `rule.stats.isDiscovering` for `true`, mostra um selo pequeno
"Buscando..." (com ícone de loading) ao lado das estatísticas.

## Testes

- **Worker** (`apps/worker/test/automation-discovery.test.ts`): cota exata quando todos os
  marketplaces têm produtos suficientes; redistribuição quando um marketplace fica abaixo da
  cota; marketplace sem nenhum resultado tem cota inteira redistribuída; ordem de inserção
  intercalada (verificar `position` alternando marketplace); sobra por divisão não exata fica
  sem uso (soma de itens criados = `quotaPerMarketplace * n`, não `maxOffersPerDay`); a chave
  Redis de "discovering" é setada antes das buscas e removida ao final, mesmo quando alguma
  busca lança erro.
- **API** (`apps/api/test/automations.test.ts`): `GET /automations` inclui `isDiscovering` e
  `dispatchedToday` corretos.
- **Web**: teste de componente do `RuleCard`/`QueuePanel` cobrindo: item sem `truncate`
  renderiza texto longo por extenso; clique na linha abre a URL certa (mock de
  `window.open`); selo "Buscando..." aparece só quando `isDiscovering` é `true`.

## Migração e compatibilidade

Nenhuma mudança de schema Postgres. `isDiscovering` é campo aditivo em `AutomationStats` —
clientes antigos que não leem o campo continuam funcionando normalmente. O evento
`automation.discovery` é aditivo no union `RealtimeEvent`.
