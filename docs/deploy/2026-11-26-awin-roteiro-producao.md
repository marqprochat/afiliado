# Roteiro de produção — leva Awin (D, A, B, C + imagens)

Código: `main` em `bdd5a3e` (já no GitHub). Validado no Docker do servidor de testes.

## 1. Backup e deploy (no VPS)
```bash
cd ~/afilados            # pasta do repositório no VPS
docker compose -f docker-compose.prod.yml exec postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > ~/backup-$(date +%F).sql
./deploy.sh              # git pull + build + prisma migrate deploy + restart
```
Migrações novas que o deploy aplica:
- `20261125120000_awin_sales_attribution` (vendas, cliques, código dos grupos)
- `20261125130000_awin_image_original` (imagem original do catálogo Awin)
- `20261126100000_awin_programme_stats` (indicadores/EPC + opções nas automações)

## 2. Imagens da Awin (Drogal)
```bash
docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @afilados/db exec tsx ../../scripts/repair-awin-images.ts --advertiser=68224
# revise o resumo; se estiver ok:
docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @afilados/db exec tsx ../../scripts/repair-awin-images.ts --advertiser=68224 --apply
```

## 3. Painel
1. Marketplaces → Awin: confira o token (se for PAT, preencha a validade) e clique em
   "Atualizar indicadores" (tabela de EPC).
2. Vendas → copie a URL do webhook.
3. Awin → Toolbox → Transaction notifications → método POST → cole a URL → salve.
4. (Opcional) Marketplaces → Awin → ligue "Links curtos" se quiser tidd.ly nos envios.

## 4. Conferência
- `/vendas` abre e, após a próxima sincronização (1 h), mostra as transações dos últimos 7 dias.
- Abrir uma oferta Drogal em `/ofertas/<slug>` mostra a foto.
- Enviar uma oferta de teste a um grupo: o link do site deve ter `?c=<código>&b=<lote>`.
- A primeira venda real deve aparecer em Vendas com o grupo identificado.
