// Popup Script para Afilados Connect

document.addEventListener('DOMContentLoaded', async () => {
  const connPill = document.getElementById('conn-pill');
  const configSection = document.getElementById('config-section');
  const productSection = document.getElementById('product-section');
  const unsupportedSection = document.getElementById('unsupported-section');
  const apiUrlInput = document.getElementById('api-url');
  const apiTokenInput = document.getElementById('api-token');
  const btnSaveConfig = document.getElementById('btn-save-config');
  const configMsg = document.getElementById('config-msg');
  const btnCapture = document.getElementById('btn-capture');
  const captureStatus = document.getElementById('capture-status');
  const captureTarget = document.getElementById('capture-target');
  const captureTargetLabel = document.getElementById('capture-target-label');
  const linkDashboard = document.getElementById('link-dashboard');
  const mlSection = document.getElementById('ml-session-section');
  const mlPill = document.getElementById('ml-session-pill');
  const mlMsg = document.getElementById('ml-session-msg');
  const btnSyncMl = document.getElementById('btn-sync-ml');
  const discoverSection = document.getElementById('discover-section');
  const btnDiscover = document.getElementById('btn-discover');
  const discoverMsg = document.getElementById('discover-msg');

  function renderDiscovery(results) {
    if (!results || results.length === 0) {
      discoverMsg.textContent = 'Nenhuma palavra-chave de ML/Magalu nas automações ativas.';
      discoverMsg.className = 'msg';
      return;
    }
    const failed = results.filter((r) => r.error);
    const queued = results.reduce((n, r) => n + (r.queued || 0), 0);
    const lines = results.map((r) =>
      r.error
        ? `❌ ${r.marketplace} "${r.keyword}": ${r.error}`
        : `✅ ${r.marketplace} "${r.keyword}": ${r.found} lidos, ${r.queued} novos na fila`,
    );
    discoverMsg.textContent = `${queued} novos na fila\n${lines.join('\n')}`;
    discoverMsg.style.whiteSpace = 'pre-line';
    discoverMsg.className = failed.length ? 'msg msg-error' : 'msg msg-success';
  }

  btnDiscover.addEventListener('click', async () => {
    btnDiscover.disabled = true;
    discoverMsg.textContent = 'Buscando… abre abas em segundo plano, pode levar alguns minutos.';
    discoverMsg.className = 'msg';
    try {
      const res = await chrome.runtime.sendMessage({ action: 'DISCOVER_NOW' });
      if (res && res.ok) renderDiscovery(res.results);
      else {
        discoverMsg.textContent = `❌ ${(res && res.error) || 'Falha na descoberta'}`;
        discoverMsg.className = 'msg msg-error';
      }
    } catch {
      discoverMsg.textContent = '❌ Falha ao falar com a extensão';
      discoverMsg.className = 'msg msg-error';
    }
    btnDiscover.disabled = false;
  });

  function normalizeApiUrl(url) {
    let clean = (url || '').trim().replace(/\/+$/, '');
    clean = clean.replace(/\/api\/v1\/?$/, '');
    clean = clean.replace(/\/api\/?$/, '');
    return clean || 'http://localhost:3011';
  }

  let currentProduct = null;
  let config = { apiUrl: 'http://localhost:3011', apiToken: '' };

  // Permite clicar no status para abrir configurações / trocar token
  connPill.style.cursor = 'pointer';
  connPill.title = 'Clique para abrir configurações de conexão';
  connPill.addEventListener('click', () => {
    configSection.classList.toggle('hidden');
  });

  // Carrega configurações salvas no Chrome Storage
  if (typeof chrome !== 'undefined' && chrome.storage) {
    const saved = await chrome.storage.local.get(['apiUrl', 'apiToken']);
    if (saved.apiUrl) config.apiUrl = normalizeApiUrl(saved.apiUrl);
    if (saved.apiToken) config.apiToken = saved.apiToken;
    apiUrlInput.value = config.apiUrl;
    apiTokenInput.value = config.apiToken;
  }

  // Verifica status da conexão
  async function checkAuth() {
    if (!config.apiToken) {
      connPill.textContent = 'Desconectado';
      connPill.className = 'pill pill-off';
      configSection.classList.remove('hidden');
      return false;
    }

    try {
      const url = `${normalizeApiUrl(config.apiUrl)}/api/v1/extension/auth`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiToken}`,
        },
        body: '{}',
      });

      if (res.ok) {
        const data = await res.json();
        connPill.textContent = data.tenantName || 'Conectado';
        connPill.className = 'pill pill-on';
        configSection.classList.add('hidden');
        return true;
      } else {
        const data = await res.json().catch(() => null);
        connPill.textContent = 'Token Inválido';
        connPill.className = 'pill pill-off';
        configSection.classList.remove('hidden');
        if (data?.error?.message) {
          configMsg.textContent = `❌ ${data.error.message}`;
          configMsg.className = 'msg msg-error';
        }
        return false;
      }
    } catch (e) {
      connPill.textContent = 'Offline';
      connPill.className = 'pill pill-off';
      configSection.classList.remove('hidden');
      configMsg.textContent = '❌ Falha de rede ao conectar à API. Verifique a URL.';
      configMsg.className = 'msg msg-error';
      return false;
    }
  }

  let isAuthed = await checkAuth();

  // --- Destino da captura: Fila de Triagem (padrão), uma automação ou um lote ativo ---
  // O valor do <select> carrega o tipo: '' (Triagem), 'rule:<id>' ou 'batch:<id>'. O botão
  // flutuante da página lê o mesmo destino de `lastCaptureTarget` no chrome.storage.
  let automationRules = [];
  let activeBatches = [];

  const BATCH_STATUS_LABEL = { SCHEDULED: 'agendado', RUNNING: 'rodando', PAUSED: 'pausado' };

  function parseTarget(value) {
    if (value && value.startsWith('batch:')) return { kind: 'batch', id: value.slice(6) };
    if (value && value.startsWith('rule:')) return { kind: 'rule', id: value.slice(5) };
    return { kind: 'triage', id: null };
  }

  function findTargetName(value) {
    const t = parseTarget(value);
    if (t.kind === 'rule') return automationRules.find((r) => r.id === t.id)?.name;
    if (t.kind === 'batch') return activeBatches.find((b) => b.id === t.id)?.name;
    return undefined;
  }

  function updateCaptureButtonLabel() {
    const t = parseTarget(captureTarget.value);
    const name = findTargetName(captureTarget.value);
    if (t.kind === 'batch' && name) btnCapture.textContent = `⚡ Enviar para lote: ${name}`;
    else if (t.kind === 'rule' && name) btnCapture.textContent = `⚡ Enviar para: ${name}`;
    else btnCapture.textContent = '⚡ Enviar para Fila de Triagem';
  }

  async function fetchJsonList(path) {
    try {
      const res = await fetch(`${normalizeApiUrl(config.apiUrl)}/api/v1/extension/${path}`, {
        headers: { Authorization: `Bearer ${config.apiToken}` },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async function saveCaptureTarget() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const value = captureTarget.value;
    await chrome.storage.local.set({
      lastCaptureTarget: { value, label: findTargetName(value) || '' },
    });
  }

  async function loadCaptureTargets() {
    if (!isAuthed) {
      captureTargetLabel.classList.add('hidden');
      captureTarget.classList.add('hidden');
      return;
    }
    [automationRules, activeBatches] = await Promise.all([
      fetchJsonList('automations'),
      fetchJsonList('batches'),
    ]);

    if (automationRules.length === 0 && activeBatches.length === 0) {
      captureTargetLabel.classList.add('hidden');
      captureTarget.classList.add('hidden');
      captureTarget.innerHTML = '';
      updateCaptureButtonLabel();
      return;
    }

    captureTargetLabel.classList.remove('hidden');
    captureTarget.classList.remove('hidden');
    captureTarget.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Fila de Triagem';
    captureTarget.appendChild(defaultOpt);

    function addGroup(label, items, toOption) {
      if (items.length === 0) return;
      const group = document.createElement('optgroup');
      group.label = label;
      for (const item of items) {
        const opt = document.createElement('option');
        const { value, text } = toOption(item);
        opt.value = value;
        opt.textContent = text;
        group.appendChild(opt);
      }
      captureTarget.appendChild(group);
    }
    addGroup('Automações', automationRules, (r) => ({ value: `rule:${r.id}`, text: r.name }));
    addGroup('Lotes', activeBatches, (b) => ({
      value: `batch:${b.id}`,
      text: `${b.name} (${BATCH_STATUS_LABEL[b.status] || b.status} · ${b.pending} pendentes)`,
    }));

    if (typeof chrome !== 'undefined' && chrome.storage) {
      const { lastCaptureTarget } = await chrome.storage.local.get(['lastCaptureTarget']);
      // Formato antigo: string com o id da automação (sem prefixo).
      const saved =
        typeof lastCaptureTarget === 'string'
          ? lastCaptureTarget && `rule:${lastCaptureTarget}`
          : lastCaptureTarget && lastCaptureTarget.value;
      if (saved && findTargetName(saved) !== undefined) captureTarget.value = saved;
      // O destino salvo sumiu (lote concluído, automação desativada): volta para a Triagem.
      else if (saved) await saveCaptureTarget();
    }
    updateCaptureButtonLabel();
  }

  captureTarget.addEventListener('change', async () => {
    updateCaptureButtonLabel();
    await saveCaptureTarget();
  });

  await loadCaptureTargets();

  // --- Sessão do Mercado Livre (cookies → link oficial meli.la) ---
  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString('pt-BR');
    } catch {
      return iso;
    }
  }

  async function renderMlSession() {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    const { mlSessionSync } = await chrome.storage.local.get(['mlSessionSync']);
    mlSection.classList.remove('hidden');
    discoverSection.classList.remove('hidden');
    if (mlSessionSync && mlSessionSync.ok) {
      mlPill.textContent = `Sincronizada ${fmtDate(mlSessionSync.syncedAt || mlSessionSync.at)}`;
      mlPill.className = 'pill pill-on';
    } else {
      mlPill.textContent = 'Não sincronizada';
      mlPill.className = 'pill pill-off';
      if (mlSessionSync && mlSessionSync.error) {
        mlMsg.textContent = mlSessionSync.error;
        mlMsg.className = 'msg msg-error';
      }
    }
  }

  btnSyncMl.addEventListener('click', async () => {
    btnSyncMl.disabled = true;
    mlMsg.textContent = 'Sincronizando cookies do Mercado Livre...';
    mlMsg.className = 'msg';
    try {
      const result = await chrome.runtime.sendMessage({ action: 'SYNC_ML_SESSION' });
      if (result && result.ok) {
        mlMsg.textContent = `✅ ${result.cookieCount} cookies sincronizados`;
        mlMsg.className = 'msg msg-success';
      } else {
        mlMsg.textContent = `❌ ${(result && result.error) || 'Falha ao sincronizar'}`;
        mlMsg.className = 'msg msg-error';
      }
    } catch {
      mlMsg.textContent = '❌ Falha ao falar com a extensão';
      mlMsg.className = 'msg msg-error';
    }
    btnSyncMl.disabled = false;
    await renderMlSession();
  });

  // Salvar configuração
  btnSaveConfig.addEventListener('click', async () => {
    config.apiUrl = normalizeApiUrl(apiUrlInput.value);
    config.apiToken = apiTokenInput.value.trim();
    apiUrlInput.value = config.apiUrl;

    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ apiUrl: config.apiUrl, apiToken: config.apiToken });
    }

    configMsg.textContent = 'Testando conexão...';
    configMsg.className = 'msg';

    const ok = await checkAuth();
    if (ok) {
      isAuthed = ok;
      configMsg.textContent = 'Conectado com sucesso!';
      configMsg.className = 'msg msg-success';
      // primeira sincronização da sessão ML logo após conectar
      chrome.runtime
        .sendMessage({ action: 'SYNC_ML_SESSION' })
        .then(renderMlSession)
        .catch(() => {});
      setTimeout(() => inspectCurrentTab(), 500);
      void loadCaptureTargets();
    }
  });

  // Inspeciona aba ativa
  async function inspectCurrentTab() {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const url = tab.url;
    let marketplaceKind = null;

    if (url.includes('mercadolivre.com.br')) marketplaceKind = 'MERCADOLIVRE';
    else if (url.includes('amazon.com.br')) marketplaceKind = 'AMAZON';
    else if (url.includes('magazineluiza.com.br') || url.includes('magazinevoce.com.br'))
      marketplaceKind = 'MAGALU';
    else if (url.includes('shopee.com.br')) marketplaceKind = 'SHOPEE';
    else if (url.includes('aliexpress.com')) marketplaceKind = 'ALIEXPRESS';

    if (!marketplaceKind) {
      productSection.classList.add('hidden');
      unsupportedSection.classList.remove('hidden');
      return;
    }

    // Tenta obter metadados da página via content script
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PRODUCT_DATA' });
      if (response && response.product) {
        currentProduct = {
          ...response.product,
          url,
          marketplaceKind,
        };
      }
    } catch {
      // Fallback: usa a URL para scraping no backend
      currentProduct = {
        url,
        marketplaceKind,
        title: tab.title || 'Produto detectado na página',
      };
    }

    renderProductPreview(currentProduct);
  }

  function renderProductPreview(p) {
    if (!p) return;
    unsupportedSection.classList.add('hidden');
    productSection.classList.remove('hidden');

    document.getElementById('market-badge').textContent = p.marketplaceKind;
    document.getElementById('p-title').textContent = p.title || 'Produto detectado';
    document.getElementById('p-price').textContent = p.price
      ? `R$ ${p.price.toFixed(2).replace('.', ',')}`
      : 'Preço na importação';

    const origEl = document.getElementById('p-orig');
    const discEl = document.getElementById('p-disc');
    if (p.originalPrice && p.originalPrice > p.price) {
      origEl.textContent = `R$ ${p.originalPrice.toFixed(2).replace('.', ',')}`;
      origEl.classList.remove('hidden');
    } else {
      origEl.classList.add('hidden');
    }

    if (p.discountPct) {
      discEl.textContent = `${p.discountPct}% OFF`;
      discEl.classList.remove('hidden');
    } else {
      discEl.classList.add('hidden');
    }

    const imgEl = document.getElementById('p-img');
    if (p.images && p.images.length > 0) {
      imgEl.src = p.images[0];
      imgEl.classList.remove('hidden');
    } else {
      imgEl.classList.add('hidden');
    }

    const extraEl = document.getElementById('p-extra');
    const extras = [];
    if (p.shipping === 'FULL') extras.push('⚡ FULL');
    else if (p.shipping === 'FREE') extras.push('🚚 Frete Grátis');
    if (p.couponCode) extras.push(`🎟️ ${p.couponCode}`);
    extraEl.textContent = extras.join(' • ');
  }

  // Capturar oferta
  btnCapture.addEventListener('click', async () => {
    if (!currentProduct) return;
    btnCapture.disabled = true;
    captureStatus.textContent = 'Enviando oferta para o Afilados...';
    captureStatus.className = 'msg';

    const target = parseTarget(captureTarget.value);
    const payload = {
      url: currentProduct.url,
      marketplaceKind: currentProduct.marketplaceKind,
      ...(currentProduct.title ? { title: currentProduct.title } : {}),
      ...(currentProduct.price !== null && currentProduct.price !== undefined
        ? { price: currentProduct.price }
        : {}),
      ...(currentProduct.originalPrice ? { originalPrice: currentProduct.originalPrice } : {}),
      ...(currentProduct.discountPct ? { discountPct: currentProduct.discountPct } : {}),
      ...(currentProduct.images && currentProduct.images.length > 0
        ? { images: currentProduct.images }
        : {}),
      ...(currentProduct.shipping && currentProduct.shipping !== 'UNKNOWN'
        ? { shipping: currentProduct.shipping }
        : {}),
      ...(currentProduct.couponCode ? { couponCode: currentProduct.couponCode } : {}),
      ...(target.kind === 'rule' ? { automationRuleId: target.id } : {}),
      ...(target.kind === 'batch' ? { batchId: target.id } : {}),
    };

    try {
      const targetUrl = `${normalizeApiUrl(config.apiUrl)}/api/v1/extension/capture`;
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        const name = findTargetName(captureTarget.value) ?? '';
        if (target.kind === 'batch') {
          captureStatus.textContent = data?.batchItem?.runAt
            ? `✅ Adicionado como próximo envio do lote "${name}"!`
            : `✅ Adicionado ao lote "${name}" (pausado): sai primeiro quando for retomado.`;
        } else {
          const destino = target.kind === 'rule' ? `automação "${name}"` : 'Fila de Triagem';
          captureStatus.textContent = `✅ Oferta adicionada em ${destino}!`;
        }
        captureStatus.className = 'msg msg-success';
        btnCapture.textContent = '✓ Adicionado';
      } else {
        const err = await res.json().catch(() => null);
        captureStatus.textContent = `❌ ${err?.error?.message || 'Falha ao capturar oferta'}`;
        captureStatus.className = 'msg msg-error';
        btnCapture.disabled = false;
        // Lote concluído/cancelado ou removido: atualiza a lista para ele sair do seletor.
        if (err?.error?.code === 'BATCH_INACTIVE' || res.status === 404) void loadCaptureTargets();
      }
    } catch (e) {
      captureStatus.textContent = '❌ Erro de conexão com a API';
      captureStatus.className = 'msg msg-error';
      btnCapture.disabled = false;
    }
  });

  linkDashboard.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      let dashboardUrl = 'http://localhost:3000/produtos';
      try {
        const origin = new URL(config.apiUrl).origin;
        if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin)) {
          dashboardUrl = `${origin}/produtos`;
        }
      } catch {
        // mantém o padrão local se apiUrl for inválida
      }
      chrome.tabs.create({ url: dashboardUrl });
    }
  });

  if (isAuthed) {
    inspectCurrentTab();
    renderMlSession();
  }
});
