-- Diagnóstico (somente leitura): itens de lote com texto próprio (copiados de grupo pela extensão)
-- cujo produto vinculado é compartilhado com outros itens — sinal de que a tela do lote mostrava
-- uma oferta e o envio mandava outra.
-- Uso no VPS, na raiz do repositório:
--   docker compose -f docker-compose.prod.yml exec -T postgres psql -U afilados -d afilados < scripts/diagnose-batch-custom-text.sql

-- 1) Últimos 30 itens com texto próprio: produto mostrado na tela x começo do texto enviado.
SELECT bi."runAt",
       b.name                                   AS lote,
       bi.status,
       p.title                                  AS produto_na_tela,
       p."originalUrl"                          AS url_do_produto,
       left(regexp_replace(bi."customText", '\s+', ' ', 'g'), 120) AS texto_enviado
FROM "BatchItem" bi
JOIN "Batch" b ON b.id = bi."batchId"
LEFT JOIN "Product" p ON p.id = bi."productId"
WHERE bi."customText" IS NOT NULL
ORDER BY bi."runAt" DESC
LIMIT 30;

-- 2) Produtos usados por mais de um item com texto próprio (colisão pelo mesmo link).
SELECT p.id, p.title, p."originalUrl", count(*) AS itens
FROM "BatchItem" bi
JOIN "Product" p ON p.id = bi."productId"
WHERE bi."customText" IS NOT NULL
GROUP BY p.id, p.title, p."originalUrl"
HAVING count(*) > 1
ORDER BY itens DESC
LIMIT 30;
