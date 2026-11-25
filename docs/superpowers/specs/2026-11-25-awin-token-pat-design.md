# Token da Awin (PAT) — aceitar token longo e avisar antes de vencer

Data: 2026-11-25 · Subprojeto D da leva "novidades da API da Awin" (ordem: D → A → B → C).

## Contexto

A Awin passou a oferecer o **Personal Access Token (PAT)** além do Classic Token
(help.awin.com/apidocs/api-authentication). O PAT é bem mais longo, tem validade escolhida pelo
usuário (renovável no painel) e é o único aceito nas APIs novas (`/public/v1`). Os endpoints que
usamos (`/publisher/{id}/promotions`, `/publishers/{id}/programmes`, `linkbuilder/generate`)
continuam e aceitam o PAT via `Authorization: Bearer`.

Problemas: o schema limitava `offersApiToken` a 200 caracteres (o PAT era rejeitado) e, com PAT,
o token vence sem aviso, parando a sincronização de cupons em silêncio. A API da Awin **não
expõe** a data de validade do token.

## Decisões

1. **Token longo:** `offersApiToken` aceita até 4096 caracteres, com `trim`.
2. **Validade informada pelo usuário:** novo campo opcional `offersApiTokenExpiresAt`
   (`YYYY-MM-DD`; string vazia limpa) salvo nas credenciais cifradas da conexão AWIN.
   Alterar só a validade não reseta o status da conexão (mesma regra da seleção de feeds).
3. **Exposição na API:** `publicConnection` devolve `awinTokenExpiresAt` e
   `awinTokenDaysLeft` (dias de calendário entre hoje em America/Sao_Paulo e a data; 0 = vence
   hoje; negativo = vencido; `null` sem data).
4. **Aviso no painel:** pílula "Awin" da barra superior e o drawer da Awin mostram
   - amarelo: `0 ≤ dias ≤ 7` → "Token da Awin vence em N dias" / "vence hoje";
   - vermelho: `dias < 0` → "Token da Awin venceu em DD/MM/AAAA".
   Status `ERROR` real da conexão continua tendo prioridade (vermelho com o `lastError`).
5. **Detecção real:** quando a sincronização de cupons (worker `coupon-sync`) recebe
   `AWIN_UNAUTHORIZED` (401/403), a conexão vai para `ERROR` com
   `lastError = "Token de API da Awin inválido ou expirado — renove em Settings → API credentials"`.
   Numa sincronização posterior bem-sucedida, o erro é limpo (status `OK`) **somente se** o
   `lastError` atual for esse erro de token.
6. **Correções junto:** Link Builder lia `shortenedUrl`, a Awin devolve `shortUrl` (link curto
   nunca era usado); texto de ajuda do campo explica PAT/Classic; mensagem de 401 cita expiração.

Fora do escopo: alerta por WhatsApp/e-mail (pode reaproveitar `awinTokenDaysLeft` depois).

## Testes

- `packages/shared`: schema aceita data válida e `''`, rejeita formato inválido; token de 1000+ chars.
- `apps/api`: helper de dias (hoje, futuro, passado, sem data, virada de dia no fuso SP);
  rota PUT só com validade preserva status.
- `apps/worker`: `coupon-sync` marca `ERROR` no `AWIN_UNAUTHORIZED` e limpa no sucesso apenas
  quando o erro anterior era de token.
- `apps/web`: helper de alerta (amarelo/vermelho/nenhum); drawer envia/limpa a validade.
