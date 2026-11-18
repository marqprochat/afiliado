# Diretrizes e Arquitetura do Projeto (Para IAs e Desenvolvedores)

> [!IMPORTANT]
> **REGRAS FUNDAMENTAIS SOBRE AS LANDING PAGES NO SISTEMA**
> Este documento define a separação estrita entre a Landing Page do Dono da Aplicação e as Landing Pages dos Afiliados.
> Qualquer IA que atue neste projeto DEVE seguir estas convenções.

---

## 1. Separação de Landing Pages: `/landpage` vs `/lp/[slug]`

### A. Landing Page Principal do Dono da Aplicação (`/landpage`)
- **Público / Papel:** Pertence ao **dono da aplicação** (SuperAdmin / usuário principal / administrador do sistema todo).
- **URL Pública:** `/landpage` (ex: `https://meudominio.com/landpage`).
- **Finalidade:** Divulgar os grupos VIP e canais oficiais do próprio dono do sistema (ex: Dudu Rocha / Geral / Matriz de Categorias).
- **Dados e Rota da API:**
  - Consome `GET /api/v1/public/group-links`.
  - Esta rota busca os links fixos cadastrados no tenant do SuperAdmin / dono da aplicação (`tenantId` do SuperAdmin ou tenant `default`).
  - **NÃO** deve misturar nem exibir grupos cadastrados por afiliados.
- **Navegação no Painel:**
  - Para o usuário principal (`isAffiliate === false` / `isSuperAdmin === true`), o botão **"Ver Landing Page"** em `/links-grupos` direciona para `/landpage`.

---

### B. Landing Page de Afiliados (`/lp/[slug]`)
- **Público / Papel:** Pertence aos **afiliados individuais** (tenants filhos).
- **URL Pública:** `/lp/[slug]` (ex: `https://meudominio.com/lp/meu-clube-vip`).
- **Finalidade:** Cada afiliado divulga a sua própria landing page personalizada (estilo Aura Landing Page), exibindo exclusivamente os seus grupos de WhatsApp cadastrados no painel dele.
- **Dados e Rota da API:**
  - Consome `GET /api/v1/public/affiliate-landing/:slug`.
  - Esta rota consulta a tabela `AffiliateLandingPage` pelo slug e busca os links de grupos vinculados **estritamente àquele `tenantId` do afiliado**.
  - **Sem dados fakes:** Se o afiliado não cadastrou grupos ou apagou os grupos, a página deve exibir estado vazio (0 grupos) e **JAMAIS** injetar nichos fakes mockados hardcoded (ex: Beleza, Casa, etc.).
- **Navegação no Painel:**
  - O afiliado edita suas configurações visuais e textos em `/minha-landpage`.
  - Em `/links-grupos`, o botão **"Ver Landing Page"** do afiliado (`isAffiliate === true`) direciona para `/lp/${slug}` (ou `/minha-landpage` caso ainda não tenha definido o slug).

---

## 2. Resumo das Rotas e Permissões

| Rota Web | Tipo | Quem Utiliza | Rota API de Dados |
| :--- | :--- | :--- | :--- |
| `/landpage` | Pública | **Dono da Aplicação / SuperAdmin** | `GET /api/v1/public/group-links` |
| `/lp/:slug` | Pública | **Afiliado Específico** | `GET /api/v1/public/affiliate-landing/:slug` |
| `/minha-landpage` | Painel Interno | Editor da LP de Afiliado | `GET/PUT /api/v1/affiliate-landing` |
| `/links-grupos` | Painel Interno | Gestão de Links Fixos e Ordem | `GET/POST/PATCH /api/v1/group-links` |

---

## 3. Comportamento do Botão "Ver Landing Page" em `/links-grupos`
O componente `apps/web/src/app/(app)/links-grupos/page.tsx` verifica `me?.isAffiliate`:
```ts
const landingUrl = isAffiliate
  ? (lpRes?.data?.slug ? `/lp/${lpRes.data.slug}` : '/minha-landpage')
  : '/landpage';
```
- Se `!isAffiliate`: vai para `/landpage`.
- Se `isAffiliate`: vai para `/lp/${slug}`.
