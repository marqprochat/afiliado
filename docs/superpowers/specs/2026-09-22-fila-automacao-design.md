# Gerenciamento da fila de automação: marketplace visível, reordenação e envio pela extensão

## Contexto

A automação de ofertas (`AutomationQueueItem`) hoje dispara nesta ordem: todos os itens
manuais primeiro (por `addedAt`), depois os descobertos automaticamente (por `addedAt`).
O painel (`QueuePanel`) lista os itens sem indicar de qual marketplace vieram, não permite
reordenar, e só aceita link manual colado à mão — a extensão Afilados Connect só manda
produtos para a Fila de Triagem (`QueueItem`), não para a fila de uma automação.

Este spec cobre três mudanças sobre a mesma fila:

1. Mostrar o marketplace de cada item na fila.
2. Permitir reordenar a fila por arrastar-e-soltar, e essa ordem manda no disparo.
3. Permitir que a extensão envie um link direto para a fila de uma automação escolhida.

## Fora de escopo

- Mudar a Fila de Triagem (`QueueItem`) ou o fluxo de captura genérico da extensão.
- Suporte a toque/mobile no drag-and-drop (fica para uma iteração futura, se necessário).
- Mudar como a descoberta automática escolhe marketplace/keyword (coberto no spec de
  2026-09-17 e no fix de busca por keyword já aplicado).

## 1. Marketplace visível na fila

O marketplace de um item já existe implicitamente: `product.source` para itens `PRODUCT`,
`coupon.store` para itens `COUPON`. Não é preciso coluna nova — a API passa a devolver um
campo `marketplace: MarketplaceKind` computado em cada item de `GET /automations/:id/queue`,
e o painel renderiza um badge com o nome do marketplace ao lado do badge "manual" que já
existe.

## 2. Reordenação por arrastar-e-soltar

### Dados

`AutomationQueueItem` ganha uma coluna `position Int`. Uma migration faz backfill com a
ordem atual — mesma lógica que o scheduler usa hoje (`manual desc, addedAt asc`) — para que
nada mude de lugar ao aplicar. Novo índice: `@@index([tenantId, ruleId, status, position])`.

Toda inserção nova (link manual, cupom manual, item descoberto pelo worker) entra com
`position` = `(maior position da regra) + 1`, ou seja, sempre no fim da fila.

### API

- `GET /automations/:id/queue`: ordena por `position asc` (em vez de `manual desc, addedAt
  asc`), inclui `marketplace` em cada item.
- `PATCH /automations/:id/queue/order`: body `{ itemIds: string[] }` com a ordem completa
  desejada dos itens `PENDING` daquela regra. Valida numa transação que o conjunto de IDs
  recebido é exatamente o conjunto de itens `PENDING` da regra (nem a mais, nem a menos) —
  senão `400`. Regrava `position` de cada item pela posição no array. Publica
  `automation.queue.updated` (evento que o painel já escuta via SSE/query invalidation).

### Worker

`AutomationScheduler.dispatchNext` troca a busca de candidato automático de
`orderBy: { addedAt: 'asc' }` para `orderBy: { position: 'asc' }`, e para de tratar manual e
automático como grupos separados — a lista antes buscava manual primeiro (`manual: true`) e
só se não achasse ia para os automáticos (`manual: false`). Agora é uma única busca por
`status: 'PENDING'` ordenada por `position`, independente de `manual`. A ordem que o usuário
vê no painel é a ordem real de disparo.

### Painel

`QueuePanel` implementa arrastar-e-soltar com atributos HTML5 nativos
(`draggable`, `onDragStart`, `onDragOver`, `onDrop`) — sem nova dependência, dado que a
lista é uma coluna vertical simples e o projeto mantém as deps enxutas. Ao soltar, atualiza a
ordem local otimisticamente e dispara o `PATCH /order`; em caso de erro, reverte para os
dados do último fetch e mostra toast de erro (padrão já usado por `useApiMutation`).

## 3. Envio de link pela extensão para uma automação

### API

- `GET /extension/automations`: lista `{ id, name, keywords, marketplaces }` das
  `AutomationRule` do tenant com `enabled: true`. Autenticado do mesmo jeito que as demais
  rotas de `/extension/*` (token de API).
- `POST /extension/capture`: ganha campo opcional `automationRuleId`. Quando presente:
  - valida que a regra existe e pertence ao tenant (senão `404`);
  - em vez de upsert em `QueueItem` (Fila de Triagem), cria um `AutomationQueueItem` com
    `kind: 'PRODUCT'`, `manual: true`, `position` no fim da fila daquela regra;
  - publica `automation.queue.updated` (em vez de `queue.updated`).
  Quando ausente, comportamento inalterado (vai para a Fila de Triagem).

### Extensão (popup)

Novo `<select id="capture-target">` no card de captura, com opção padrão "Fila de Triagem" e
uma opção por automação ativa (carregadas de `/extension/automations` na abertura do popup,
com fallback silencioso — se a chamada falhar, some o select e mantém só a Fila de Triagem).
A última escolha persiste em `chrome.storage.local` e é restaurada na próxima abertura. O
texto do botão principal acompanha a seleção: "⚡ Enviar para Fila de Triagem" ou "⚡ Enviar
para: <nome da automação>". O payload de `POST /extension/capture` inclui
`automationRuleId` quando uma automação está selecionada.

## Testes

- **API** (`apps/api/test/automations.test.ts`): `PATCH /order` reordena corretamente;
  rejeita quando o array não bate com o conjunto de itens `PENDING` da regra; rejeita item de
  outra regra.
- **API** (`apps/api/test/extension.test.ts`): `GET /extension/automations` lista só regras
  `enabled: true` do tenant; `POST /extension/capture` com `automationRuleId` cria
  `AutomationQueueItem` em vez de `QueueItem`, com `automationRuleId` de outro tenant → 404.
- **Worker** (`apps/worker/test/automation-scheduler.test.ts`): dispatch respeita `position`
  ao escolher entre um item manual e um automático fora de ordem de criação.
- **DB** (`packages/db/test/automation-schema.test.ts` ou equivalente): migration de
  backfill preserva a ordem manual-primeiro/addedAt existente.
- **Web**: teste de componente do badge de marketplace no `QueuePanel` (se houver suíte de
  componente já configurada; senão, verificação manual documentada no PR).

## Migração e compatibilidade

A coluna `position` é `NOT NULL` com backfill na própria migration (não pode ficar opcional
— o scheduler depende dela para ordenar). Nenhuma rota antiga muda de contrato além de
`GET /queue` (novo campo `marketplace`, aditivo) e `POST /extension/capture` (novo campo
opcional). Sem breaking change para clientes existentes da extensão em uso.
