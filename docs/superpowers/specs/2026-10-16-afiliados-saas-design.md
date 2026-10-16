# Afiliados (SaaS sem pagamento) — Design

**Data:** 2026-10-16
**Status:** aprovado em brainstorming, aguardando revisão do spec

## Objetivo

Permitir que o SuperAdmin (`admin@dudurochatec.com`) crie contas de afiliados. Cada afiliado:

- tem login e senha próprios;
- opera numa conta isolada, como num SaaS (WhatsApp, grupos, Telegram, extensão, produtos, fila, lotes, automações, cupons, dashboard), sem cobrança;
- **não configura credenciais de marketplace nem de IA**: usa as do SuperAdmin por trás;
- cadastra apenas **um identificador por plataforma** (SubID / tracking ID / etiqueta / loja), usado para atribuir a comissão a ele dentro das contas do SuperAdmin.

O SuperAdmin cria, edita, ativa/desativa afiliados e consegue **entrar na conta** de qualquer um.

## Decisões

| Tema | Decisão |
| --- | --- |
| Quem recebe a comissão | Sempre a conta do SuperAdmin; o identificador separa por afiliado |
| Amazon / ML / Magalu | Tracking ID / etiqueta / loja do afiliado criados **dentro da conta do SuperAdmin** |
| Busca, fila, lotes | Separados por afiliado; a busca usa as APIs do SuperAdmin |
| IA | Chave, URL e modelo do SuperAdmin (ocultos); tom, emojis, limite e instruções extras por afiliado |
| Controle | Apenas ativar/desativar; sem limites de uso |
| Exclusão de afiliado | Fora do escopo (só desativar) |
| Abordagem técnica | Tenant pai: o tenant do afiliado aponta para o tenant do SuperAdmin |

## 1. Modelo de dados

Alterações no `schema.prisma`:

- `Tenant`
  - `parentTenantId String?` → tenant do SuperAdmin. Nulo = tenant raiz (comportamento atual inalterado).
  - `active Boolean @default(true)`.
- `User`
  - `isSuperAdmin Boolean @default(false)`. Marcado para `admin@dudurochatec.com` via migration de dados. OWNER/MEMBER continuam valendo dentro do tenant.
- `MarketplaceConnection`
  - `subId String?` — único campo preenchido pelo afiliado. No afiliado, `encryptedCredentials` fica sempre nulo.
- `Session`
  - `impersonatorUserId String?` — preenchido quando o SuperAdmin está "entrando como" o afiliado.

### Resolvedor único (`packages/db`)

Hoje as credenciais são lidas em ~37 pontos (API e worker; inclui `apps/api/src/lib/marketplaces.ts`, `apps/worker/src/lib/marketplace-credentials.ts`, `apps/worker/src/automation/discovery.ts`, schedulers de cupons e Awin, `ai-settings`). Todos passam a usar:

- `resolveMarketplace(tenantId, kind)` → `{ creds, subId, ownerTenantId }`
  - `creds`: do tenant pai se existir, senão do próprio tenant.
  - `subId`: sempre do próprio tenant.
- `resolveAi(tenantId)` → chave/URL/modelo do pai; tom, emojis, limite e instruções extras do próprio tenant.
- Renovação do token OAuth do ML (refresh token de uso único) grava sempre em `ownerTenantId`.

### Agendadores

Sync de cupons, import Awin e descoberta passam a incluir tenants afiliados **ativos**, usando credenciais do pai. O catálogo Awin é importado por tenant (uma cópia por afiliado); aceito por ora.

## 2. Autenticação e papéis

- Login inalterado. Tenant inativo → login recusado ("Conta desativada"); sessões existentes são apagadas na desativação.
- Guard `requireSuperAdmin`: exige `user.isSuperAdmin` e sessão **sem** `impersonatorUserId`. Protege `/api/v1/admin/*`.
- Impersonação:
  - `POST /api/v1/admin/affiliates/:id/impersonate` cria sessão para o OWNER do afiliado com `impersonatorUserId` = SuperAdmin; o cookie de sessão do admin é preservado num segundo cookie httpOnly.
  - `POST /api/v1/admin/impersonation/stop` apaga a sessão de impersonação e restaura o cookie do admin.
- Para tenants com pai, ficam bloqueadas (403) as rotas que gravam credenciais: credenciais de marketplace, OAuth do ML, sync de cookies ML/Amazon/Magalu da extensão, chave/URL/modelo da IA. A rota de marketplace aceita apenas `subId`.

## 3. Painel do SuperAdmin

Página **Afiliados** (substitui o placeholder F7), visível só para SuperAdmin.

- Lista: nome, e-mail, status, WhatsApp conectado, nº de grupos, envios nos últimos 7 dias, criado em.
- Ações: Entrar como, Editar, Ativar/Desativar, Redefinir senha.
- Criar afiliado (modal): nome, e-mail, senha inicial (pode ser gerada e exibida uma única vez) e SubIDs por plataforma (opcionais).
- Criação numa transação: `Tenant` (com `parentTenantId`), `User` OWNER, `MarketplaceConnection` com `subId`, configurações padrão (janela de operação, templates iniciais — reaproveitando a lógica do seed).

Rotas (`/api/v1/admin/affiliates`, todas com `requireSuperAdmin`):

| Método | Rota | Função |
| --- | --- | --- |
| GET | `/` | listar |
| POST | `/` | criar |
| PATCH | `/:id` | editar nome, e-mail, SubIDs |
| POST | `/:id/active` | ativar/desativar |
| POST | `/:id/reset-password` | nova senha |
| POST | `/:id/impersonate` | entrar como |

Tenant inativo: agendadores e processadores ignoram; jobs já enfileirados são descartados ao executar com log "tenant inativo". Nada é apagado; reativar retoma.

## 4. Geração de link

| Plataforma | Montagem |
| --- | --- |
| Shopee | `subIds: [subId do afiliado, padrão data/lote atual]` |
| AliExpress | `sub_id` = subId do afiliado |
| Awin | `clickref` = subId do afiliado |
| Amazon | `tag` = tracking ID do afiliado |
| Mercado Livre | etiqueta = a do afiliado (gerador meli.la com a sessão do SuperAdmin) |
| Magalu | loja = a do afiliado; vazio → loja do SuperAdmin |

- O subId passa pela mesma sanitização atual (só alfanumérico, máx. 50).
- Sem subId cadastrado: o envio continua com a tag padrão do SuperAdmin, e a tela de Marketplaces do afiliado avisa que a comissão não será atribuída a ele.
- Assinatura dos adapters (`toAffiliateLink`) não muda; o subId chega pelo resolvedor.
- Tenant raiz (SuperAdmin) mantém o comportamento atual.

## 5. Telas do afiliado

- **Marketplaces:** uma linha por plataforma com um campo (rótulo: SubID / Tracking ID / Etiqueta / Loja). Sem OAuth, cookies ou chaves.
- **Configurações → IA:** apenas tom, emojis, limite de caracteres e instruções extras.
- **Extensão:** funciona com o token do próprio afiliado; sync de sessões de marketplace bloqueado.
- **Faixa de impersonação:** "Acessando como {nome} · Voltar ao admin", fixa no topo.
- Demais telas sem mudança (já são por tenant).

## 6. Erros e testes

Erros:

- Tenant inativo → 403 "Conta desativada".
- Credencial do SuperAdmin ausente/inválida → afiliado vê "Marketplace indisponível, fale com o administrador"; detalhe técnico só no log.

Testes (foco em isolamento):

- Afiliado não lê dados de outro afiliado nem do SuperAdmin.
- `resolveMarketplace` retorna credenciais do pai e subId do filho; tenant raiz inalterado.
- Renovação do token ML grava no tenant dono.
- Afiliado não consegue gravar credenciais (403).
- Sessão de impersonação não acessa `/admin/*`.
- Tenant inativo não loga e não dispara envio.
- Montagem do link por plataforma com e sem subId.
- Suíte existente continua passando.

## Fases de implementação

1. Schema + resolvedor único + migração dos pontos de leitura (sem mudança visível).
2. `isSuperAdmin`, guard, CRUD de afiliados e ativar/desativar.
3. Impersonação (entrar como / voltar ao admin).
4. Geração de link com subId + telas simplificadas do afiliado.
