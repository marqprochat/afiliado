-- Liga o link do site nas ofertas postadas só para o tenant do dono da aplicação: o do superadmin
-- mais antigo entre as contas raiz (mesma regra de resolveOwnerTenantId, que o site público e o
-- worker usam). Afiliados e demais tenants seguem com o link de afiliado direto (chave ausente =
-- desligado).
INSERT INTO "Setting" ("tenantId", "key", "value")
SELECT owner."tenantId", 'siteLinks', '{"enabled": true}'::jsonb
FROM (
  SELECT u."tenantId"
  FROM "User" u
  JOIN "Tenant" t ON t."id" = u."tenantId"
  WHERE u."isSuperAdmin" = true AND t."parentTenantId" IS NULL
  ORDER BY u."createdAt" ASC
  LIMIT 1
) owner
ON CONFLICT ("tenantId", "key") DO NOTHING;
