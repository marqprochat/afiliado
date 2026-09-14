# Afilados

Automação de ofertas de afiliado para grupos de WhatsApp. Specs e planos em `docs/superpowers/`.

## Desenvolvimento

```bash
cp .env.example .env            # preencha APP_ENCRYPTION_KEY e SESSION_SECRET (openssl rand -hex 32)
echo "DATABASE_URL=postgresql://afilados:afilados@localhost:5434/afilados" > packages/db/.env
pnpm install
docker compose up -d --wait
pnpm db:migrate
set -a && . ./.env && set +a && pnpm db:seed
pnpm test
```

## Rodando API e worker

```bash
set -a && . ./.env && set +a
pnpm dev            # api em :3001, worker em :3002 (health em /health)
```

Testes de integração (precisam do Postgres/Redis do compose e das variáveis do `.env`):

```bash
set -a && . ./.env && set +a && pnpm test
```

## Pacotes

- `packages/shared` — tipos, enums, schemas Zod
- `packages/core` — regras de negócio puras (template, janela, agendamento, shuffle, URLs, SubID)
- `packages/db` — Prisma, `forTenant`, criptografia, seed
- `packages/marketplaces` — adapters (Shopee na F1; `SHOPEE_MOCK=1` para rodar sem credenciais)

## Web (painel)

```bash
pnpm --filter @afilados/web dev     # http://localhost:3000 (proxy /api → :3001)
```

E2E (API rodando com `SHOPEE_MOCK=1`; não rode `pnpm build` da web com o `dev` ativo — ambos usam `.next/`):

```bash
set -a && . ./.env && set +a
pnpm --filter @afilados/web e2e:seed
pnpm --filter @afilados/web e2e
```
