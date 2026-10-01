# Envio manual e despacho de cupons — design

Data: 2026-09-30

## Objetivo

1. Envio manual avulso: mensagem livre (texto + imagem opcional) para grupos de WhatsApp e chats do Telegram, com a opção de inserir cupons cadastrados no texto.
2. Despacho de cupons por seleção: o usuário marca cupons na tela de cupons, escolhe template e destinos, e clica em "Enviar agora" ou "Colocar na fila".
3. Template de exemplo de cupom, com prévia usando cupons reais cadastrados.

## Já existe (não refazer)

- `coupon-sync` (AliExpress e Awin) e o botão "Sincronizar APIs" em `/config/cupons`.
- `Template.kind = COUPON` e `renderCouponTemplate`.
- `BatchItem.couponId`; `send-offer` já envia cupom (WhatsApp e Telegram).
- `isEligibleCoupon`, `scheduleBatch`, `enqueueBatchItems`.

## Fora do escopo

- Captura de cupons pelo espelhamento.
- Novas fontes de cupom além de AliExpress e Awin.
- Agendamento para data e hora específicas.

## Seção 1 — Dados e envio

**Item de lote com mensagem livre.** `BatchItem` ganha `customText String?` e `customImageUrl String?`. Um item com `customText` é uma mensagem avulsa. `[batchId, productId]` continua único (productId nulo não conflita).

**Worker.** `send-offer.ts` ganha o ramo `if (item.customText)`: envia texto (ou imagem com legenda) pelo mesmo `sendPlainMessages` (grupos, `SendLog`, rate limit, Telegram). `SendTelegramJob` ganha `customText?` e `customImageUrl?`.

**Enviar agora.** Cria um lote de um envio (`intervalMin = 0`, `runAt = agora`) e enfileira em `send-offer`. Usa o mesmo processador, então respeita rate limit e janela de horário. Fora da janela o item é reagendado para a abertura e a tela informa o horário. Não existe caminho de envio paralelo.

**Colocar na fila.** Cria um lote novo "Cupons {data hora}" com os itens na ordem selecionada, intervalo informado (padrão igual ao dos outros lotes) e horários via `scheduleBatch`.

**API.**
- `POST /coupons/dispatch`: `couponIds`, `templateId`, `sessionId`, `groupJids`, `telegramChatIds`, `mode: 'now' | 'queue'`, `intervalMin` (só na fila). Valida com `isEligibleCoupon`, ignora os inelegíveis (listados na resposta) e devolve o lote.
- `POST /manual-send`: `text`, `imageUrl?`, mesmos destinos e `mode`.
- Ambos chamam `createDispatchBatch` em `apps/api/src/lib/batches.ts`; só diferem no item criado.

## Seção 2 — Interface

**`/config/cupons`.** Coluna de checkbox (com "selecionar todos"); só cupons elegíveis são marcáveis. Com seleção, aparece uma barra fixa com: seletor de template (`kind = COUPON`), sessão, grupos de WhatsApp e chats do Telegram (última escolha em `localStorage`), botão "Enviar agora", botão "Colocar na fila" com intervalo em minutos, contador e limpar seleção. Após o envio, aviso com link para o lote e lista dos cupons ignorados. "Sincronizar APIs" continua; o feedback passa a mostrar criados, atualizados e expirados.

**`/enviar/manual`.** Texto livre com prévia estilo WhatsApp, imagem opcional (URL ou upload), seletor de destinos e modo agora/fila. Painel "Inserir cupom": lista os cupons válidos e insere no campo o texto do template de cupom renderizado.

**Componente compartilhado.** `DispatchTargetPicker` (template, sessão, grupos, Telegram, agora ou fila) usado pela barra de cupons e pela página manual.

## Seção 3 — Template de exemplo, erros, testes

**Template de exemplo.** Botão "Criar template de exemplo de cupom" na tela de templates cria um `Template` `kind = COUPON` com corpo padrão (`store`, `code`, `description`, `expiresAt`); não duplica se já existir com o mesmo nome. A prévia do editor tem o seletor "pré-visualizar com o cupom…" com os cupons válidos do tenant; sem cupons, usa um exemplo fixo. `GET /templates/:id/preview?couponId=` devolve o texto renderizado com o mesmo código de renderização do envio.

**Erros.**
- Cupom expirado ou inelegível: ignorado e listado; se todos forem ignorados, 422 com o motivo.
- Sessão do WhatsApp desconectada: recusado antes de criar o lote.
- Fora da janela: "Enviar agora" é reagendado e a tela mostra o horário.
- Mensagem vazia ou acima do limite do WhatsApp: validada na API e na tela.
- Tudo escopado por tenant.

**Testes.**
- Worker: ramo `customText` do `send-offer` (texto, imagem com legenda, Telegram, idempotência por `SendLog`).
- API: `/coupons/dispatch` e `/manual-send` (agora, fila, expirados, sessão off, isolamento de tenant), `/templates/:id/preview`.
- Web: seleção e barra de ações, página manual, inserir cupom.
- Rebuild e validação no Docker antes de dar como concluído.
