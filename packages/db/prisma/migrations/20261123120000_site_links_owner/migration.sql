-- Liga o link do site nas ofertas postadas para o tenant do dono da aplicação (superadmin raiz).
-- Afiliados e demais tenants seguem com o link de afiliado direto (chave ausente = desligado).
INSERT INTO "Setting" ("tenantId", "key", "value")
SELECT DISTINCT u."tenantId", 'siteLinks', '{"enabled": true}'::jsonb
FROM "User" u
JOIN "Tenant" t ON t."id" = u."tenantId"
WHERE u."isSuperAdmin" = true AND t."parentTenantId" IS NULL
ON CONFLICT ("tenantId", "key") DO NOTHING;
