# Design: Unificação da tela de Marketplaces (Fase 1)

**Data:** 2026-09-16
**Status:** Aprovado

## Contexto

Hoje o Afilados não tem uma tela única de "Marketplaces". Cada marketplace (Shopee, Mercado Livre, Amazon, Magalu) tem sua própria rota e página cheia (`/config/shopee`, `/config/mercadolivre`, `/config/amazon`, `/config/magalu`), linkadas individualmente na sidebar. O Shopee usa um formulário próprio; Amazon e Magalu reaproveitam o `TagConnectionForm`; o Mercado Livre tem um card extra de status de sincronização de sessão via extensão.

O usuário pediu para organizar tudo em uma seção "Marketplaces" única (grid de cards + drawer de configuração), inspirada num app de referência (SenaFlow), que usa cookies de sessão do próprio usuário para rodar automações nas plataformas de afiliados. Hoje o Afilados já tem esse padrão de cookie de sessão implementado, mas só para o Mercado Livre, e só via extensão Chrome instalada — não existe opção de colar o cookie manualmente na web, como no app de referência.

Este documento cobre a **Fase 1** de um projeto maior, decomposto em:
- **Fase 1 (este documento):** unificação visual da tela de Marketplaces + generalização do fluxo de cookie de sessão (extensão + colar manual) para Mercado Livre, Amazon e Magalu, mantendo a geração de link como está hoje (baseada em tag) para Amazon/Magalu.
- **Fase 2 (futura):** geração real de link de afiliado via cookie (SiteStripe) para Amazon.
- **Fase 3 (futura):** geração real de link de afiliado via cookie para Magalu.

Correção do bug de mock do Shopee (`checkConnection` sempre retorna OK quando `SHOPEE_MOCK=1`) fica fora do escopo desta entrega.

## Decisões de design

### 1. Arquitetura de rotas e página de lista

- Nova rota `/marketplaces` substitui o item único "Marketplaces" na sidebar (`apps/web/src/components/app-shell/sidebar.tsx`).
- As rotas antigas (`/config/shopee`, `/config/mercadolivre`, `/config/amazon`, `/config/magalu`) passam a redirecionar para `/marketplaces?open=<kind>`.
- A página `/marketplaces` consome `GET /marketplaces` (já existe, sem mudanças de contrato) e renderiza um grid de cards, um por `MarketplaceKind` (SHOPEE, MERCADOLIVRE, AMAZON, MAGALU): ícone, nome, badge de status (`NÃO CONFIGURADO` / `CONECTADO` / `ERRO`, derivado do campo `status`), descrição curta dos campos exigidos, botão "Configurar marketplace".
- Clicar no card/botão abre o drawer de configuração sobre a própria página, sem navegação real de rota — apenas estado local refletido em `?open=<kind>` na URL, para permitir link direto e botão voltar do navegador.
- A página `/config/extensao` (instalação da extensão) continua existindo como está; passa a ser linkada de dentro do drawer do Mercado Livre em vez de aparecer solta na sidebar.

### 2. Componente de drawer genérico

Um único componente `MarketplaceDrawer` (`apps/web/src/components/marketplaces/marketplace-drawer.tsx`), dirigido por um mapa de configuração declarativo por `kind` (`apps/web/src/components/marketplaces/marketplace-config.ts`):

```ts
type MarketplaceFieldConfig = {
  kind: MarketplaceKind
  label: string
  platformUrl: string // usado no link "Abrir plataforma"
  fields: {
    key: string // 'tag' | 'appId' | 'secret' | 'mattWord' | 'mattTool'
    label: string
    type: 'text' | 'password'
    required: boolean
    helpTitle?: string
    helpContent?: string
  }[]
  supportsSession: boolean // true para MERCADOLIVRE, AMAZON, MAGALU
  sessionCookieName?: string // ex. "MELI_SESSION", só texto de instrução
  sessionHelpContent?: string
}
```

- Esse componente substitui o `TagConnectionForm` atual e o formulário bespoke do Shopee — ambos passam a ser instâncias do `MarketplaceDrawer`, variando apenas a config.
- Layout segue a referência: cabeçalho (nome, subtítulo, badge "Criptografado com AES-256-GCM", link "Abrir plataforma"), campos obrigatórios marcados com asterisco, blocos colapsáveis de ajuda por campo, e um textarea de cookie de sessão (quando `supportsSession` for true) com texto de ajuda "Como exportar o cookie?".
- Botão único "Testar e Salvar": no clique, o front chama `PUT /marketplaces/:kind` e, em seguida, `POST /marketplaces/:kind/check`, exibindo o resultado combinado. Não é necessário endpoint novo para essa combinação — é orquestração no cliente.
- Campos sensíveis (senha/appId/secret) nunca voltam da API; quando já salvos, o campo mostra placeholder "•••• (já salvo)", mesmo padrão que o Shopee já usa hoje (`hasSecret`/`hasTag`).

### 3. Generalização do schema de credenciais de sessão

Em `packages/shared/src/marketplaces.ts`, o campo `mlSession: { cookies, syncedAt }` permanece intocado (evita migração de dados existentes). São adicionados, no mesmo formato, mais dois campos opcionais em `TagCredentials`:

```ts
type SessionCookies = {
  cookies: Record<string, string>
  syncedAt: string
  source: 'extension' | 'manual'
}

// em TagCredentials:
mlSession?: SessionCookies       // já existe, ganha o campo `source` (opcional, default implícito 'extension' para dados antigos)
amazonSession?: SessionCookies   // novo
magaluSession?: SessionCookies   // novo
```

O campo `source` diferencia sincronização via extensão de colagem manual — hoje isso não é rastreado em lugar nenhum.

### 4. Novo endpoint de cookie manual

`POST /marketplaces/:kind/session` (`apps/api/src/routes/marketplaces.ts`):
- Body: `{ cookie: string }` — string bruta colada pelo usuário (ex.: `MELI_SESSION=abc123; other=xyz`, ou um valor único).
- Um parser novo (`packages/shared/src/cookie-parser.ts`) converte a string colada em `Record<string,string>`: tenta o formato `nome=valor; nome=valor` separado por `;`; se não encontrar nenhum `=`, trata a string inteira como valor do cookie padrão daquele marketplace (`sessionCookieName` da config, ex. `MELI_SESSION`).
- Mescla o resultado no blob de credenciais já criptografado da conexão (mesmo padrão de `POST /extension/session`), grava com `source: 'manual'` e `syncedAt: now()`, marca `status: OK` — mesmo comportamento de "sincronização não valida de verdade, só registra que foi sincronizado" que a extensão já tem hoje.
- Disponível apenas para os 3 kinds com `supportsSession: true` (MERCADOLIVRE, AMAZON, MAGALU). Shopee não usa esse endpoint — continua exclusivamente com `appId`/`secret`.
- Autenticação: sessão web normal (usuário logado no dashboard), diferente de `POST /extension/session` que usa token de API da extensão — são dois endpoints distintos para dois contextos de autenticação diferentes.

### 5. Extensão Chrome

Sem mudanças nesta fase. A extensão continua coletando cookies apenas do domínio `mercadolivre.com.br`. Colar manual é o único caminho de sessão para Amazon/Magalu por enquanto. A extensão só passaria a capturar cookies desses domínios quando as Fases 2/3 implementarem a geração real de link via cookie para eles.

### 6. Uso do cookie nesta fase

Nesta fase, o cookie de sessão de Amazon/Magalu é apenas armazenado e refletido como "sincronizado" na UI (data/hora + origem). A geração de link de afiliado para Amazon e Magalu continua baseada em tag, exatamente como hoje. A geração real de link via cookie (raspagem de SiteStripe/portal Magalu) é o escopo das Fases 2 e 3.

## Fora de escopo (Fase 1)

- Correção do bug de mock do Shopee (`SHOPEE_MOCK=1` sempre retorna OK).
- Adição de novos marketplaces (AliExpress, KaBuM!, Nike, Shein, Temu) — não existem no código hoje e não entram nesta entrega.
- Geração real de link via cookie para Amazon (Fase 2) e Magalu (Fase 3).
- Mudanças na extensão Chrome para capturar cookies de Amazon/Magalu.

## Testes

- Testes de API existentes para `PUT/POST /marketplaces/:kind` devem continuar passando sem alteração de contrato.
- Novos testes para `POST /marketplaces/:kind/session`: parsing de cookie (formato `nome=valor;...` e valor único), merge no blob criptografado sem sobrescrever outros campos de credenciais, rejeição para `kind` sem `supportsSession` (Shopee).
- Teste do parser de cookie isoladamente (`packages/shared/src/cookie-parser.ts`).
- Teste de UI/componente do `MarketplaceDrawer` cobrindo os 4 `kind`s a partir da config declarativa (placeholders de campo já salvo, exibição condicional do bloco de sessão).
