# Dashboard e Métricas — Design

**Data:** 2026-10-13  
**Status:** aprovado  

## Objetivo

Substituir o stub de visualização em `/dashboard` (`apps/web/src/app/(app)/dashboard/page.tsx`, atualmente um placeholder de 4 linhas) por um módulo analítico completo de métricas e indicadores operacionais do Afilados:
- **Grupos de WhatsApp:** monitoramento de entradas, saídas, remoções, saldo líquido e curva de evolução do tamanho da audiência.
- **Envios de mensagens:** volume total, taxa de sucesso na entrega, distribuição temporal e diagnóstico dos principais erros.
- **Produtos enviados:** catálogo de itens com maior tração e distribuição por marketplace de origem.
- **Cliques e conversão:** tráfego e taxa de cliques nos links públicos rastreáveis de grupos (`/g/[slug]`).
- **Espelhamento e automações:** volume de mensagens capturadas e espelhadas, regras de automação disparadas e cupons validados/propagados.

## Decisões aprovadas

- **Escopo de grupos:** monitoramento restrito aos registros de `WaGroup` onde o bot é administrador (`botIsAdmin = true`), visto que o protocolo do WhatsApp (Baileys) só fornece eventos de entrada/saída de participantes para administradores do grupo.
- **Extras incluídos na v1:** 
  - Métrica de cliques e conversão de links de entrada.
  - Indicadores de saúde e taxa de sucesso dos envios de mensagens.
  - Acompanhamento de execuções de espelhamento (`MirrorLog`) e automações (`AutomationLog`).
  - Painéis de top produtos enviados e divisão por marketplace.
- **Abordagem híbrida (Opção C):**
  - **Grupos:** uso de eventos granulares (`GroupMemberEvent`) combinados com snapshots diários (`GroupSnapshot`), visto que o WhatsApp não fornece histórico retroativo de entradas e saídas.
  - **Demais painéis:** consulta analítica direta nas tabelas operacionais já existentes (`SendLog`, `BatchItem`, `Product`, `MirrorLog`, `AutomationLog`), filtrando por `tenantId` e índices de data (`createdAt` / `sentAt`).
  - **Agregados pré-calculados (`MetricDaily`):** mantidos fora do escopo inicial da v1; serão avaliados apenas se algum painel demonstrar gargalo de desempenho com grande volume de dados.
- **Linha base do histórico de grupos:** o histórico de movimentação (entradas/saídas) e snapshots passa a existir estritamente a partir da data de deploy da funcionalidade. A interface (UI) deve alertar de forma clara a data inicial de coleta dos dados para evitar interpretação de histórico ausente como estagnação.

## Modelo de Dados (Prisma)

Todas as entidades pertencem a um tenant específico com chave `tenantId` referenciando `Tenant` (`onDelete: Cascade`).

### 1. `GroupMemberEvent`
Registra cada movimentação de participante em grupos onde o bot é administrador:
- `id`: String (`@id @default(cuid())`).
- `tenantId`: String (chave estrangeira para `Tenant`).
- `sessionId`: String (sessão do WhatsApp que capturou o evento).
- `groupJid`: String (JID do grupo no WhatsApp).
- `participantJid`: String (JID bruto do participante; não armazena nome nem telefone formatado por privacidade).
- `action`: Enum `GroupMemberAction` (`JOIN`, `LEAVE`, `REMOVED`, `ADDED`, `PROMOTED`, `DEMOTED`).
- `actorJid`: String opcional (JID do administrador responsável pela ação, quando informado pelo WhatsApp).
- `occurredAt`: DateTime (carimbo de data/hora do evento no WhatsApp).
- `createdAt`: DateTime (`@default(now())`).
- **Índices e unicidade:**
  - `@@index([tenantId, occurredAt])`
  - `@@index([tenantId, groupJid, occurredAt])`
  - Idempotência: deduplicação por chave composta ou verificação prévia no handler para evitar duplicação em caso de retransmissão de eventos pelo socket.
- **Retenção:** 12 meses (configurável via rotina de limpeza).

### 2. `GroupSnapshot`
Fotografia diária da quantidade de participantes por grupo para composição do gráfico de evolução e histórico consolidado:
- `id`: String (`@id @default(cuid())`).
- `tenantId`: String (chave estrangeira para `Tenant`).
- `sessionId`: String.
- `groupJid`: String.
- `date`: DateTime (truncada para 00:00:00 no fuso `America/Sao_Paulo`).
- `memberCount`: Int (contagem de participantes).
- `createdAt`: DateTime (`@default(now())`).
- **Índices e unicidade:**
  - `@@unique([sessionId, groupJid, date])`
  - `@@index([tenantId, date])`
  - `@@index([tenantId, groupJid, date])`

### 3. `LinkClickEvent`
Rastreamento analítico de acessos aos links inteligentes de grupos (`/g/[slug]`):
- `id`: String (`@id @default(cuid())`).
- `tenantId`: String (chave estrangeira para `Tenant`).
- `groupLinkId`: String (chave estrangeira para `GroupLink`, `onDelete: Cascade`).
- `slug`: String (slug do link no momento do clique).
- `targetGroupJid`: String opcional (JID do grupo ativo de destino para onde o usuário foi direcionado).
- `clickedAt`: DateTime (`@default(now())`).
- **Índices:**
  - `@@index([tenantId, clickedAt])`
  - `@@index([groupLinkId, clickedAt])`
- *Nota:* Registrado durante a resolução do redirecionamento HTTP, permitindo séries temporais por dia e hora (hoje `GroupLink.clickCount` mantém apenas um contador acumulado global).
- **Retenção:** 12 meses.

## Worker & Processamento em Segundo Plano

- **Handler de Participantes (`group-participants.update`):**
  - Integrado ao gateway Baileys (`apps/worker/src/wa/baileys-gateway.ts`, por volta da linha 230) e nos ouvintes de sessão (`session-manager.ts`, por volta da linha 194).
  - Ao receber o evento, itera sobre a lista de participantes e persiste um registro `GroupMemberEvent` para cada um.
  - **Tolerância a falhas:** O processo de gravação do evento no banco roda protegido por bloco de captura de erro (`try/catch`), garantindo que qualquer inconsistência de banco nunca interrompa ou derrube o handler do gateway Baileys.
- **Snapshots de Grupos:**
  - Job agendado BullMQ executado diariamente (meia-noite no fuso `America/Sao_Paulo`) para registrar o `memberCount` atual de cada grupo `WaGroup`.
  - Também grava snapshot durante a sincronização de grupos (`syncGroups`) para manter os dados atualizados mesmo após reinicializações.

## API Backend (Fastify)

Rotas sob `/api/v1/metrics`, protegidas por autenticação multi-tenant e validadas via Zod.

### Parâmetros comuns de consulta (Query Params)
- `from`: String ISO 8601 (obrigatório).
- `to`: String ISO 8601 (obrigatório, intervalo máximo permitido de 366 dias entre `from` e `to`).
- `groupJid`: String opcional (quando fornecido, valida se o grupo pertence ao tenant autenticado; caso não pertença, retorna erro 404).

### Regras de negócio do serviço de métricas
- Uma função de agregação dedicada por painel/visão.
- Agrupamento temporal diário padronizado no fuso horário `America/Sao_Paulo`.
- Todo acesso filtra estritamente por `tenantId` da sessão autenticada.

### Rotas disponíveis
1. `GET /metrics/overview`:
   - KPIs consolidados: total de membros atuais, entradas, saídas, saldo líquido, volume total de envios, taxa de sucesso de envio (%) e total de cliques em links.
   - Cálculo comparativo com o período anterior equivalente (ex.: variação percentual vs os 30 dias imediatamente anteriores).
2. `GET /metrics/groups`:
   - Total de membros, entradas, saídas e saldo líquido do intervalo.
   - Série diária (data, entradas, saídas, saldo acumulado).
   - Tabela comparativa e rankings de grupos por crescimento e movimentação.
3. `GET /metrics/sends`:
   - Total de mensagens enviadas, sucesso vs falha e percentual de entrega (fonte `SendLog`).
   - Série temporal de envios por dia e por hora.
   - Matriz de calor (heatmap) cruzando hora do dia x dia da semana.
   - Lista dos principais motivos de erro com contagem.
4. `GET /metrics/products`:
   - Ranking do Top 10 produtos mais enviados (fonte `BatchItem` com relação a `Product`).
   - Distribuição de produtos enviados agrupados por marketplace (`SHOPEE`, `MERCADOLIVRE`, `AMAZON`, `MAGALU`, `AWIN`).
5. `GET /metrics/clicks`:
   - Total de cliques e série temporal diária a partir de `LinkClickEvent`.
   - Distribuição de cliques por link/slug e ranking de links mais acessados.
6. `GET /metrics/automation`:
   - Métricas de mensagens capturadas e espelhadas (fonte `MirrorLog`).
   - Ações executadas pelo motor de regras automáticas (fonte `AutomationLog`: `DISCOVERED`, `DISPATCHED`, `SKIPPED`, `ERROR`).
   - Quantidade de cupons validados e propagados nas mensagens.

## Frontend (Next.js, Tailwind/shadcn, Recharts)

Implementação em `apps/web/src/app/(app)/dashboard/page.tsx` substituindo o placeholder existente.

- **Barra de filtros superior (Fixa):**
  - Seletor de período rápido: `Hoje`, `7 dias`, `30 dias` (padrão), `90 dias`, `Personalizado` (date-picker).
  - Seletor de grupo: dropdown com opção "Todos os grupos" ou filtro por grupo específico.
  - Estado sincronizado diretamente na URL via search params (`period`, `from`, `to`, `groupJid`), garantindo navegação com histórico e compartilhamento de estado.
- **Consumo de dados:**
  - TanStack Query (`useQuery`) com `staleTime: 60000` (60 segundos) para evitar requisições desnecessárias.
- **Seções da interface:**
  - **Cards de KPIs:** Membros Totais, Entradas, Saídas, Saldo Líquido, Total de Envios, Taxa de Sucesso, Cliques em Links, com badges de variação comparativa vs período anterior.
  - **Seção de Grupos:**
    - Gráfico de linha/área da evolução de membros.
    - Gráfico de barras com entradas vs saídas por dia.
    - Tabela detalhada de grupos ordenável por colunas.
  - **Seção de Envios:**
    - Volume diário de envios com distinção de sucesso e falha.
    - Heatmap de volume por hora do dia e dia da semana.
    - Card com diagnóstico e contagem dos principais erros.
  - **Seção de Produtos:**
    - Top 10 produtos mais disparados no período.
    - Gráfico de rosca (donut chart) com volume por marketplace.
  - **Seção de Cliques:**
    - Curva de cliques por dia e detalhamento por slug de link.
  - **Seção de Espelhamento e Automações:**
    - Resumo consolidado de espelhamento, automação e cupons.
- **Acessibilidade e Design System:**
  - Suporte completo aos modos claro e escuro (`light` / `dark`).
  - Paleta de cores acessível com contraste adequado nos gráficos, seguindo boas práticas de visualização de dados.
- **Estados de interface:**
  - **Skeleton loading:** Esqueletos estruturados por seção durante carregamento inicial.
  - **Tratamento de erro granular:** Card de erro por seção com botão "Tentar novamente", sem comprometer as demais seções do dashboard.
  - **Estado vazio explicativo:** Mensagens contextualizadas em períodos sem movimentação e aviso explícito na seção de grupos: *"Histórico de movimentação disponível a partir de DD/MM/AAAA"*.

## Estratégia de Testes

- **Serviço de métricas backend (com banco real):**
  - Execução via ambiente de testes Linux (`.superpowers/sdd/remote.sh`):
    - Filtros por múltiplos períodos, viradas de mês/ano e fuso horário `America/Sao_Paulo`.
    - Isolamento rigoroso multi-tenant (garantir que nenhum dado de outro tenant vaze nas agregações).
    - Comportamento resiliente em períodos sem registros (devolver valores zerados sem exceptions).
- **Handler do Worker:**
  - Testes cobrindo cada `action` de participantes (`JOIN`, `LEAVE`, `REMOVED`, `ADDED`, `PROMOTED`, `DEMOTED`), assegurando a gravação correta do evento.
  - Validação de idempotência (eventos repetidos do socket não duplicam registros).
- **Rotas Fastify:**
  - Validação de esquema com Zod (parâmetros obrigatórios, datas inválidas, intervalos superiores a 366 dias, grupo pertencente a outro tenant retornando 404).
- **Componentes de Frontend e E2E:**
  - Testes de renderização de KPIs, skeletons e cards de erro/vazio.
  - Testes E2E com Playwright cobrindo abertura do dashboard, troca de período e filtro por grupo.
- **Validação Docker:**
  - Validação obrigatória da suíte de testes e compilação completa no ambiente Docker antes de concluir.

## Fora do escopo da v1

- Exportação de dados para relatórios em formatos CSV ou PDF.
- Disparo de alertas automáticos configuráveis (ex.: alerta de queda de membros ou alta taxa de falhas).
- Tabelas agregadas pré-calculadas (`MetricDaily`).

## Execução pelo Time (Maestri)

- **Planejador:** Decomposição da especificação em tasks e plano detalhado de implementação.
- **Programador (Prisma / Worker):** Schema Prisma, migrations, modelos `GroupMemberEvent`, `GroupSnapshot` e `LinkClickEvent`, jobs e handlers de eventos no worker.
- **Programador (API Fastify):** Implementação dos serviços analíticos de métricas, agregações SQL/Prisma e endpoints sob `/api/v1/metrics`.
- **FrontEnd Designer:** Desenvolvimento dos componentes de tela, gráficos Recharts, filtros e integração na rota `/dashboard`.
- **Github:** Revisão de PR, checagens de CI e merge da funcionalidade na `main`.
- **Revisão e Validação Docker:** Homologação e execução de todos os testes no contêiner antes do encerramento.
