#!/usr/bin/env node
// Sonda da API oficial do Mercado Livre — script avulso, fora do app.
//
// Faz o login OAuth (authorization_code + PKCE) com o app criado no DevCenter e testa os endpoints
// que poderiam alimentar a descoberta de produtos, mostrando status e um resumo de cada resposta.
// Não grava nada em disco e NUNCA imprime token nem segredo.
//
// Uso:
//   ML_CLIENT_ID=... ML_CLIENT_SECRET=... node scripts/ml-api-probe.mjs ["fone bluetooth"] [MLB1000]
//   (ou coloque as variáveis no .env da raiz — ele é ignorado pelo git)
//
// redirect_uri (precisa estar cadastrado EXATAMENTE igual no DevCenter):
//   DESENVOLVIMENTO=true  → http://localhost:3000/callback
//   ausente ou false      → https://<DOMAIN>/callbackml

import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(join(rootDir, '.env')); // não sobrescreve variáveis já definidas no shell
} catch {
  // sem .env: usa só o ambiente do shell
}

const API = 'https://api.mercadolibre.com';
const AUTH = 'https://auth.mercadolivre.com.br/authorization';
const SITE = 'MLB';

const [, , queryArg, categoryArg] = process.argv;
const QUERY = queryArg || 'fone bluetooth';
const CATEGORY = categoryArg || 'MLB1000'; // Eletrônicos, Áudio e Vídeo

const env = (name) => process.env[name] ?? process.env[name.toLowerCase()];

function resolveRedirectUri() {
  const dev = String(env('DESENVOLVIMENTO') ?? '').trim().toLowerCase();
  if (['true', '1', 'sim', 'yes'].includes(dev)) {
    return { uri: 'http://localhost:3000/callback', mode: 'desenvolvimento' };
  }
  const domain = String(env('DOMAIN') ?? env('DOMINIO') ?? '').trim().replace(/\/+$/, '');
  if (!domain || domain === 'localhost') {
    fail('Defina DOMAIN com o domínio público (ex.: painel.seudominio.com.br) ou DESENVOLVIMENTO=true.');
  }
  const base = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
  return { uri: `${base}/callbackml`, mode: 'produção' };
}

function fail(message) {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

const short = (value, n = 80) => (value == null ? '—' : String(value).slice(0, n));

// ---------- OAuth ----------

const clientId = env('ML_CLIENT_ID');
const clientSecret = env('ML_CLIENT_SECRET');
if (!clientId || !clientSecret) fail('Defina ML_CLIENT_ID e ML_CLIENT_SECRET (variáveis de ambiente ou .env).');

const { uri: redirectUri, mode } = resolveRedirectUri();
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('hex');

const authUrl = `${AUTH}?${new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: redirectUri,
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
})}`;

console.log(`Modo: ${mode}`);
console.log(`redirect_uri: ${redirectUri}`);
console.log('  ↑ precisa estar cadastrado exatamente assim nas configurações do app no DevCenter.\n');
console.log('1) Abra este endereço no navegador, logado com o usuário ADMINISTRADOR da conta e autorize:\n');
console.log(authUrl);
console.log('\n2) O navegador vai redirecionar para o redirect_uri (a página pode dar erro/404, é normal).');
console.log('   Copie o endereço COMPLETO da barra do navegador (ou só o valor de code=) e cole abaixo.\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const pasted = (await rl.question('Cole aqui: ')).trim();
rl.close();

let code = pasted;
try {
  const u = new URL(pasted);
  code = u.searchParams.get('code') ?? '';
  const returnedState = u.searchParams.get('state');
  if (returnedState && returnedState !== state) fail('O parâmetro state não confere — refaça o processo do zero.');
  if (u.searchParams.get('error')) fail(`O Mercado Livre devolveu erro: ${u.searchParams.get('error')}`);
} catch {
  // colou só o código
}
if (!code) fail('Não encontrei o código de autorização no que foi colado.');

const tokenRes = await fetch(`${API}/oauth/token`, {
  method: 'POST',
  headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }),
});
const tokenBody = await tokenRes.json().catch(() => ({}));
if (!tokenRes.ok || !tokenBody.access_token) {
  fail(
    `Troca do código por token falhou (HTTP ${tokenRes.status}): ${short(tokenBody.error)} — ${short(tokenBody.message, 200)}`,
  );
}
const token = tokenBody.access_token;
console.log(
  `\n✅ Token obtido — user_id ${tokenBody.user_id}, expira em ${tokenBody.expires_in}s, scope: ${short(tokenBody.scope, 120)}\n`,
);

// ---------- sondas ----------

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, json };
}

function header(status, label) {
  console.log(`${status >= 200 && status < 300 ? '✅' : '❌'} [${status}] ${label}`);
}

function errorLine(json) {
  if (!json) return;
  console.log(`     ↳ ${short(json.code ?? json.error, 60)}: ${short(json.message, 160)}`);
}

// 1. quem sou eu (só campos não sensíveis)
{
  const r = await get('/users/me');
  header(r.status, '/users/me');
  if (r.ok) console.log(`     id ${r.json.id} · ${r.json.nickname} · site ${r.json.site_id}`);
  else errorLine(r.json);
}

// 2. busca por palavra-chave no catálogo de produtos
{
  const path = `/products/search?status=active&site_id=${SITE}&q=${encodeURIComponent(QUERY)}&limit=3`;
  const r = await get(path);
  header(r.status, `/products/search?q="${QUERY}"`);
  if (r.ok) {
    console.log(`     total ${r.json.paging?.total ?? '?'}`);
    for (const p of (r.json.results ?? []).slice(0, 3)) console.log(`     · ${p.id} — ${short(p.name, 70)}`);
    const first = (r.json.results ?? [])[0];
    if (first) console.log(`     campos de um resultado: ${short(Object.keys(first).join(', '), 220)}`);
  } else errorLine(r.json);
}

// 3. busca de anúncios por palavra-chave (a que costuma dar 403)
{
  const r = await get(`/sites/${SITE}/search?q=${encodeURIComponent(QUERY)}&limit=3`);
  header(r.status, `/sites/${SITE}/search?q="${QUERY}"`);
  if (r.ok) {
    console.log(`     total ${r.json.paging?.total ?? '?'}`);
    for (const it of (r.json.results ?? []).slice(0, 3)) {
      console.log(`     · ${it.id} — ${short(it.title, 60)} — R$ ${it.price}`);
    }
  } else errorLine(r.json);
}

// 4. tendências (buscas em alta) da categoria
{
  const r = await get(`/trends/${SITE}/${CATEGORY}`);
  header(r.status, `/trends/${SITE}/${CATEGORY}`);
  if (r.ok && Array.isArray(r.json)) {
    console.log(`     ${r.json.length} tendências, ex.: ${r.json.slice(0, 5).map((t) => t.keyword).join(' | ')}`);
  } else errorLine(r.json);
}

// 5. mais vendidos da categoria + resolução de cada tipo de ID
const highlights = await get(`/highlights/${SITE}/category/${CATEGORY}`);
header(highlights.status, `/highlights/${SITE}/category/${CATEGORY}`);
if (!highlights.ok) {
  errorLine(highlights.json);
} else {
  const content = highlights.json.content ?? [];
  console.log(`     ${content.length} itens no ranking`);
  const sample = content.slice(0, 6);
  for (const el of sample) console.log(`     · #${el.position} ${el.type} ${el.id}`);

  console.log('\nResolvendo os primeiros do ranking (título, preço, link):');
  const productIds = [];
  for (const el of sample) {
    if (el.type === 'ITEM') {
      const r = await get(`/items/${el.id}`);
      header(r.status, `/items/${el.id}`);
      if (r.ok) {
        console.log(`     ${short(r.json.title, 60)} — R$ ${r.json.price} (de ${r.json.original_price ?? '—'})`);
        console.log(`     ${short(r.json.permalink, 100)}`);
      } else errorLine(r.json);
    } else if (el.type === 'PRODUCT') {
      const r = await get(`/products/${el.id}`);
      header(r.status, `/products/${el.id}`);
      if (r.ok) {
        const bb = r.json.buy_box_winner;
        productIds.push(el.id);
        console.log(`     ${short(r.json.name, 60)}`);
        console.log(`     campos: ${short(Object.keys(r.json).join(', '), 220)}`);
        console.log(
          bb
            ? `     buy box: item ${bb.item_id} — R$ ${bb.price} — ${short(bb.permalink, 80)}`
            : '     sem buy_box_winner na resposta',
        );
      } else errorLine(r.json);
    } else {
      const r = await get(`/user-products/${el.id}`);
      header(r.status, `/user-products/${el.id}`);
      if (r.ok) console.log(`     ${short(r.json.name, 70)}`);
      else errorLine(r.json);
    }
  }

  // 6. preço e link de um produto de catálogo: ofertas (itens) do produto → detalhe do item
  console.log('\nOfertas dos produtos de catálogo (de onde sai o preço):');
  for (const pid of productIds.slice(0, 2)) {
    const offers = await get(`/products/${pid}/items?limit=3`);
    header(offers.status, `/products/${pid}/items`);
    if (!offers.ok) {
      errorLine(offers.json);
      continue;
    }
    const rows = Array.isArray(offers.json) ? offers.json : (offers.json.results ?? offers.json.items ?? []);
    console.log(`     formato: ${Array.isArray(offers.json) ? 'array' : `objeto {${short(Object.keys(offers.json).join(', '), 100)}}`}, ${rows.length} ofertas`);
    const row = rows[0];
    if (!row) continue;
    console.log(`     campos de uma oferta: ${short(Object.keys(row).join(', '), 200)}`);
    const itemId = typeof row === 'string' ? row : (row.item_id ?? row.id);
    if (!itemId) continue;

    const item = await get(`/items/${itemId}`);
    header(item.status, `/items/${itemId}`);
    if (item.ok) {
      const i = item.json;
      console.log(`     ${short(i.title, 60)}`);
      console.log(`     R$ ${i.price} (de ${i.original_price ?? '—'}) · frete grátis: ${i.shipping?.free_shipping ?? '?'} · estoque ref.: ${i.available_quantity ?? '?'}`);
      console.log(`     link: ${short(i.permalink, 110)}`);
      console.log(`     foto: ${short(i.thumbnail, 90)} · catalog_product_id: ${i.catalog_product_id ?? '—'}`);
    } else errorLine(item.json);

    const sale = await get(`/items/${itemId}/sale_price`);
    header(sale.status, `/items/${itemId}/sale_price`);
    if (sale.ok) console.log(`     amount ${sale.json.amount} · regular ${sale.json.regular_amount ?? '—'}`);
    else errorLine(sale.json);
  }

  // 7. detalhes em lote de itens (o endpoint que substitui /items?ids=)
  const itemIds = sample.filter((e) => e.type === 'ITEM').map((e) => e.id);
  if (itemIds.length > 0) {
    const r = await get(`/items/bulk?ids=${itemIds.join(',')}&attributes=body.id,body.price,body.permalink`);
    header(r.status, `/items/bulk?ids=${itemIds.length} itens`);
    if (r.ok && Array.isArray(r.json)) {
      for (const row of r.json.slice(0, 3)) console.log(`     · ${row.id ?? row.body?.id} — status ${row.status_code} — R$ ${row.body?.price}`);
    } else errorLine(r.json);
  }
}

// 8. categorias: para escolher de onde tirar o ranking de mais vendidos
{
  const cats = await get(`/sites/${SITE}/categories`);
  header(cats.status, `/sites/${SITE}/categories`);
  if (cats.ok && Array.isArray(cats.json)) {
    console.log(`     ${cats.json.length} categorias, ex.: ${cats.json.slice(0, 6).map((c) => `${c.id}=${c.name}`).join(' | ')}`);
  } else errorLine(cats.json);

  const dd = await get(`/sites/${SITE}/domain_discovery/search?q=${encodeURIComponent(QUERY)}&limit=3`);
  header(dd.status, `/sites/${SITE}/domain_discovery/search?q="${QUERY}"`);
  if (dd.ok && Array.isArray(dd.json)) {
    for (const d of dd.json.slice(0, 3)) console.log(`     · ${d.category_id} — ${short(d.category_name, 40)} (${d.domain_id})`);
  } else errorLine(dd.json);
}

console.log('\nPronto. Nada foi salvo em disco e o token não foi impresso.');
