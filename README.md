# Afilados

Automação de ofertas de afiliado para grupos de WhatsApp. Specs e planos em `docs/superpowers/`.

## Subir tudo via Docker (recomendado)

`docker compose up -d --wait` sobe o sistema inteiro — Postgres, Redis, API, worker e o painel web — já com migrations e seed rodados automaticamente pela `api` na inicialização.

```bash
cp .env.example .env            # preencha APP_ENCRYPTION_KEY, SESSION_SECRET (openssl rand -hex 32) e demais chaves
docker compose up -d --wait     # builda as imagens na 1ª vez (alguns minutos)
```

Portas publicadas no host (diferentes das internas do container para não colidir com outros projetos):

| Serviço         | URL                                 |
| --------------- | ----------------------------------- |
| Painel web      | http://localhost:3010               |
| API             | http://localhost:3011/api/v1/health |
| Worker (health) | http://localhost:3012/health        |
| Postgres        | localhost:5434                      |
| Redis           | localhost:6379                      |

Login com o usuário do seed (`SEED_USER_EMAIL`/`SEED_USER_PASSWORD` do `.env`). Para reconstruir depois de alterar código: `docker compose up -d --build`.

## Desenvolvimento local (hot reload, sem rebuildar imagem a cada mudança)

```bash
cp .env.example .env            # preencha APP_ENCRYPTION_KEY e SESSION_SECRET (openssl rand -hex 32)
echo "DATABASE_URL=postgresql://afilados:afilados@localhost:5434/afilados" > packages/db/.env
pnpm install
docker compose up -d --wait postgres redis   # só banco e fila, sem buildar api/worker/web
pnpm db:migrate
set -a && . ./.env && set +a && pnpm db:seed
pnpm test
```

## Rodando API e worker (local)

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

## Deploy no VPS

1. Instale Docker + Compose plugin; aponte o DNS de `DOMAIN` para o VPS (portas 80/443 abertas).
2. `git clone <repo> && cd afilados && cp .env.example .env` — preencha `POSTGRES_PASSWORD`, `DOMAIN`, `APP_ENCRYPTION_KEY`, `SESSION_SECRET`, `SEED_USER_*` e `SHOPEE_MOCK=0`.
3. `./deploy.sh` (primeira vez e a cada atualização). O Caddy emite o certificado TLS automaticamente.
4. Primeiro acesso: `docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @afilados/db seed`.
5. Backups diários em `./backups/` (14 dias). Logs: `docker compose -f docker-compose.prod.yml logs -f worker`.

O compose de produção usa o projeto `afilados-prod` (não conflita com o `docker-compose.yml` de dev).
