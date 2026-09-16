// Background Service Worker — sincronização da sessão de afiliado do Mercado Livre.
//
// O painel de afiliados do ML (meli.la) só gera links logado. Este worker copia os cookies
// da sessão do usuário em mercadolivre.com.br para a API do Afilados, que os guarda
// criptografados e os usa no gerador oficial (com fallback para matt_word/matt_tool).

const ML_DOMAIN = 'mercadolivre.com.br';
const DEFAULT_API_URL = 'http://localhost:3011';
const SYNC_DEBOUNCE_MS = 5000;
const SYNC_ALARM = 'afilados-ml-session-sync';
const SYNC_ALARM_PERIOD_MIN = 6 * 60; // re-sincroniza a cada 6h mesmo sem mudança de cookie

let debounceTimer = null;

function normalizeApiUrl(url) {
  let clean = (url || '').trim().replace(/\/+$/, '');
  clean = clean.replace(/\/api\/v1\/?$/, '');
  clean = clean.replace(/\/api\/?$/, '');
  return clean || DEFAULT_API_URL;
}

async function getConfig() {
  const saved = await chrome.storage.local.get(['apiUrl', 'apiToken']);
  return { apiUrl: normalizeApiUrl(saved.apiUrl), apiToken: saved.apiToken || '' };
}

async function collectMlCookies() {
  const all = await chrome.cookies.getAll({ domain: ML_DOMAIN });
  const map = {};
  for (const c of all) map[c.name] = c.value;
  return map;
}

/**
 * Envia os cookies do ML para a API. Devolve { ok, syncedAt?, cookieCount?, error? }.
 * Guarda o resultado em storage (mlSessionSync) para o popup exibir o status.
 */
async function syncMlSession(reason = 'manual') {
  const { apiUrl, apiToken } = await getConfig();
  if (!apiToken) return { ok: false, error: 'Extensão não conectada' };

  const cookies = await collectMlCookies();
  const cookieCount = Object.keys(cookies).length;
  let result;
  if (cookieCount === 0) {
    result = { ok: false, error: 'Faça login no Mercado Livre neste navegador' };
  } else {
    try {
      const res = await fetch(`${apiUrl}/api/v1/extension/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({ marketplaceKind: 'MERCADOLIVRE', cookies }),
      });
      const body = await res.json().catch(() => ({}));
      result = res.ok
        ? {
            ok: true,
            syncedAt: body.syncedAt,
            cookieCount: body.cookieCount ?? cookieCount,
            reason,
          }
        : { ok: false, error: (body.error && body.error.message) || `HTTP ${res.status}` };
    } catch (e) {
      result = { ok: false, error: 'Erro de conexão com a API' };
    }
  }
  await chrome.storage.local.set({ mlSessionSync: { ...result, at: new Date().toISOString() } });
  return result;
}

function scheduleDebouncedSync() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncMlSession('cookie-change');
  }, SYNC_DEBOUNCE_MS);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Afilados Connect instalado.');
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_ALARM_PERIOD_MIN });
  void syncMlSession('install');
});

chrome.runtime.onStartup.addListener(() => {
  void syncMlSession('startup');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void syncMlSession('periodic');
});

// Cookies do ML mudaram (login/renovação) → sincroniza com debounce
if (chrome.cookies) {
  chrome.cookies.onChanged.addListener((changeInfo) => {
    if (changeInfo.removed) return;
    if (!changeInfo.cookie.domain.includes(ML_DOMAIN)) return;
    scheduleDebouncedSync();
  });
}

// Mensagens do popup
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req && req.action === 'SYNC_ML_SESSION') {
    syncMlSession('manual').then(sendResponse);
    return true; // resposta assíncrona
  }
  return false;
});
