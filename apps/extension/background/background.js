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
const DISCOVER_ALARM = 'afilados-discovery';
const DISCOVER_PERIOD_MIN = 30;

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
  if (alarm.name === DISCOVER_ALARM) void runDiscovery('periodic');
});

// Garante o alarme de descoberta (idempotente; o alarme sobrevive ao reinício do worker MV3)
chrome.alarms.get(DISCOVER_ALARM).then((a) => {
  if (!a) chrome.alarms.create(DISCOVER_ALARM, { periodInMinutes: DISCOVER_PERIOD_MIN });
});

// Cookies do ML mudaram (login/renovação) → sincroniza com debounce
if (chrome.cookies) {
  chrome.cookies.onChanged.addListener((changeInfo) => {
    if (changeInfo.removed) return;
    if (!changeInfo.cookie.domain.includes(ML_DOMAIN)) return;
    scheduleDebouncedSync();
  });
}

// --- Descoberta por palavra-chave no Chrome do usuário ---
//
// O servidor não consegue buscar no Mercado Livre/Magalu (anti-bot bloqueia o IP). Aqui a
// busca roda numa aba em segundo plano do navegador do usuário, que a loja não bloqueia; os
// cards lidos vão para /extension/discover, que aplica os filtros da automação e enfileira.
// A Amazon continua sendo descoberta pelo servidor.

// `visible`: a busca do Mercado Livre não renderiza os resultados numa aba em segundo plano
// (fica em spinner, mesmo fingindo a Page Visibility API — testado), então ela abre numa janela
// pequena e real, sem foco. O Magalu renderiza normalmente numa aba oculta.
const DISCOVER_MARKETPLACES = {
  MERCADOLIVRE: {
    url: (kw) => `https://lista.mercadolivre.com.br/${encodeURIComponent(kw)}`,
    visible: true,
  },
  MAGALU: {
    url: (kw) => `https://www.magazineluiza.com.br/busca/${encodeURIComponent(kw)}/`,
    visible: false,
  },
};
const TAB_LOAD_TIMEOUT_MS = 30000;

let discovering = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('Tempo esgotado carregando a busca'));
    }, TAB_LOAD_TIMEOUT_MS);
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// Abre a busca (aba inativa ou, com `visible`, janela pequena sem foco), pede ao content script
// os cards e fecha o que abriu.
async function scrapeSearchTab(url, visible = false) {
  let windowId;
  let tab;
  if (visible) {
    const win = await chrome.windows.create({
      url,
      type: 'popup',
      focused: false,
      width: 520,
      height: 700,
      left: 0,
      top: 0,
    });
    windowId = win.id;
    tab = win.tabs && win.tabs[0];
    if (!tab) {
      chrome.windows.remove(windowId).catch(() => {});
      throw new Error('Não foi possível abrir a janela de busca');
    }
  } else {
    tab = await chrome.tabs.create({ url, active: false });
  }
  try {
    await waitTabComplete(tab.id);
    await sleep(1500);
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_PRODUCTS' });
        if (res && Array.isArray(res.items)) return res;
      } catch (e) {
        lastError = e;
      }
      await sleep(1500);
    }
    throw new Error(
      lastError && lastError.message ? lastError.message : 'Página não respondeu à extensão',
    );
  } finally {
    if (windowId !== undefined) chrome.windows.remove(windowId).catch(() => {});
    else chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function runDiscovery(reason = 'manual') {
  if (discovering) return { ok: false, error: 'Descoberta já em andamento' };
  const { apiUrl, apiToken } = await getConfig();
  if (!apiToken) return { ok: false, error: 'Extensão não conectada' };

  discovering = true;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` };
  const results = [];
  try {
    const rulesRes = await fetch(`${apiUrl}/api/v1/extension/automations`, { headers });
    if (!rulesRes.ok) return { ok: false, error: `HTTP ${rulesRes.status} ao listar automações` };
    const rules = await rulesRes.json();

    let first = true;
    for (const rule of rules) {
      const kinds = (rule.marketplaces || []).filter((k) => DISCOVER_MARKETPLACES[k]);
      for (const kind of kinds) {
        for (const keyword of rule.keywords || []) {
          // pausa entre buscas para não parecer varredura em rajada
          if (!first) await sleep(4000 + Math.random() * 4000);
          first = false;
          const entry = { rule: rule.name, marketplace: kind, keyword };
          try {
            const market = DISCOVER_MARKETPLACES[kind];
            const page = await scrapeSearchTab(market.url(keyword), market.visible);
            const items = page.items
              .filter((it) => it.title && it.price > 0)
              .slice(0, 100)
              .map((it) => ({
                url: it.url,
                title: it.title,
                price: it.price,
                ...(it.originalPrice ? { originalPrice: it.originalPrice } : {}),
                ...(it.images && it.images.length ? { images: it.images } : {}),
              }));
            entry.found = page.items.length;
            if (items.length === 0) {
              // diz o que a aba realmente mostrou, para separar "carregando", "bloqueio" e
              // "sem resultados" em vez de um genérico "página vazia ou anti-bot"
              entry.error = `Nenhum produto lido — ${page.diagnosis || 'motivo desconhecido'}`;
            } else {
              const res = await fetch(`${apiUrl}/api/v1/extension/discover`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  automationRuleId: rule.id,
                  keyword,
                  marketplaceKind: kind,
                  items,
                }),
              });
              const body = await res.json().catch(() => ({}));
              if (res.ok) {
                entry.accepted = body.accepted;
                entry.queued = body.queued;
              } else {
                entry.error = (body.error && body.error.message) || `HTTP ${res.status}`;
              }
            }
          } catch (e) {
            entry.error = (e && e.message) || 'Falha na busca';
          }
          results.push(entry);
        }
      }
    }
    return { ok: true, results, reason };
  } catch {
    return { ok: false, error: 'Erro de conexão com a API' };
  } finally {
    discovering = false;
    await chrome.storage.local.set({
      discoverySummary: { at: new Date().toISOString(), reason, results },
    });
  }
}

// Mensagens do popup
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req && req.action === 'SYNC_ML_SESSION') {
    syncMlSession('manual').then(sendResponse);
    return true; // resposta assíncrona
  }
  if (req && req.action === 'DISCOVER_NOW') {
    runDiscovery('manual').then(sendResponse);
    return true;
  }
  return false;
});
