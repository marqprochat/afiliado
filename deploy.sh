#!/usr/bin/env bash
# Uso no VPS: ./deploy.sh  (a partir da raiz do repositório, com .env preenchido)
set -euo pipefail
cd "$(dirname "$0")"
test -f .env || { echo "Crie o .env a partir de .env.example"; exit 1; }
git pull --ff-only
docker compose -f docker-compose.prod.yml build --pull
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @afilados/db exec prisma migrate deploy
docker compose -f docker-compose.prod.yml up -d
docker image prune -f
docker compose -f docker-compose.prod.yml ps
echo "Deploy concluído: https://$(grep ^DOMAIN= .env | cut -d= -f2)"
