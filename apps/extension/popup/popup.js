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
  const linkDashboard = document.getElementById('link-dashboard');
  const mlSection = document.getElementById('ml-session-section');
  const mlPill = document.getElementById('ml-session-pill');
  const mlMsg = document.getElementById('ml-session-msg');
  const btnSyncMl = document.getElementById('btn-sync-ml');

  let currentProduct = null;
  let config = { apiUrl: 'http://localhost:3001', apiToken: '' };

  // Carrega configurações salvas no Chrome Storage
  if (typeof chrome !== 'undefined' && chrome.storage) {
    const saved = await chrome.storage.local.get(['apiUrl', 'apiToken']);
    if (saved.apiUrl) config.apiUrl = saved.apiUrl;
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
      const res = await fetch(`${config.apiUrl}/api/v1/extension/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiToken}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        connPill.textContent = data.tenantName || 'Conectado';
        connPill.className = 'pill pill-on';
        configSection.classList.add('hidden');
        return true;
      } else {
        connPill.textContent = 'Token Inválido';
        connPill.className = 'pill pill-off';
        configSection.classList.remove('hidden');
        return false;
      }
    } catch {
      connPill.textContent = 'Offline';
      connPill.className = 'pill pill-off';
      configSection.classList.remove('hidden');
      return false;
    }
  }

  const isAuthed = await checkAuth();

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
    config.apiUrl = apiUrlInput.value.trim().replace(/\/$/, '');
    config.apiToken = apiTokenInput.value.trim();

    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ apiUrl: config.apiUrl, apiToken: config.apiToken });
    }

    configMsg.textContent = 'Testando conexão...';
    configMsg.className = 'msg';

    const ok = await checkAuth();
    if (ok) {
      configMsg.textContent = 'Conectado com sucesso!';
      configMsg.className = 'msg msg-success';
      // primeira sincronização da sessão ML logo após conectar
      chrome.runtime
        .sendMessage({ action: 'SYNC_ML_SESSION' })
        .then(renderMlSession)
        .catch(() => {});
      setTimeout(() => inspectCurrentTab(), 500);
    } else {
      configMsg.textContent = 'Falha ao conectar. Verifique o token e a URL.';
      configMsg.className = 'msg msg-error';
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

    try {
      const res = await fetch(`${config.apiUrl}/api/v1/extension/capture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiToken}`,
        },
        body: JSON.stringify(currentProduct),
      });

      if (res.ok) {
        captureStatus.textContent = '✅ Oferta adicionada na Fila de Triagem!';
        captureStatus.className = 'msg msg-success';
        btnCapture.textContent = '✓ Adicionado na Fila';
      } else {
        const err = await res.json();
        captureStatus.textContent = `❌ ${err.error?.message || 'Falha ao capturar oferta'}`;
        captureStatus.className = 'msg msg-error';
        btnCapture.disabled = false;
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
      chrome.tabs.create({ url: 'http://localhost:3000/produtos' });
    }
  });

  if (isAuthed) {
    inspectCurrentTab();
    renderMlSession();
  }
});
