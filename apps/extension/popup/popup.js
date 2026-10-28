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
  const btnCaptureAll = document.getElementById('btn-capture-all');
  const captureAllStatus = document.getElementById('capture-all-status');
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

  // Elementos do Link Builder (AWIN)
  const linkBuilderSection = document.getElementById('link-builder-section');
  const linkBuilderBadge = document.getElementById('link-builder-badge');
  const linkBuilderStore = document.getElementById('link-builder-store');
  const linkBuilderOrig = document.getElementById('link-builder-orig');
  const linkBuilderTracking = document.getElementById('link-builder-tracking');
  const btnShortenTracking = document.getElementById('btn-shorten-tracking');
  const btnCopyTracking = document.getElementById('btn-copy-tracking');
  const linkBuilderStatus = document.getElementById('link-builder-status');

  // Elementos de Cupom
  const pCouponSection = document.getElementById('p-coupon-section');
  const pCouponBadge = document.getElementById('p-coupon-badge');
  const pCouponDesc = document.getElementById('p-coupon-desc');
  const pCouponSelect = document.getElementById('p-coupon-select');
  const btnRemoveCoupon = document.getElementById('btn-remove-coupon');
  let activeStoreCoupons = [];

  let currentAwinTrackingLink = '';
  let awinPartners = {
    'drogal.com.br': {
      advertiserId: '68224',
      name: 'Drogal BR',
      domain: 'drogal.com.br',
      displayUrl: 'https://www.drogal.com.br',
    },
  };
  let awinPublisherId = null;

  // Elementos das Abas
  const tabBtnPage = document.getElementById('tab-btn-page');
  const tabBtnGroup = document.getElementById('tab-btn-group');
  const tabPageView = document.getElementById('tab-page-view');
  const tabGroupView = document.getElementById('tab-group-view');

  // Elementos da Aba "Colar de Grupo"
  const groupTextInput = document.getElementById('group-text-input');
  const btnProcessText = document.getElementById('btn-process-text');
  const groupProcessMsg = document.getElementById('group-process-msg');
  const groupParsedCard = document.getElementById('group-parsed-card');
  const tagPrice = document.getElementById('tag-price');
  const valPrice = document.getElementById('val-price');
  const valOrig = document.getElementById('val-orig');
  const valDisc = document.getElementById('val-disc');
  const tagCoupon = document.getElementById('tag-coupon');
  const valCoupon = document.getElementById('val-coupon');
  const groupLinksReport = document.getElementById('group-links-report');
  const btnToggleEdit = document.getElementById('btn-toggle-edit');
  const groupPreviewBubble = document.getElementById('group-preview-bubble');
  const groupEditTextarea = document.getElementById('group-edit-textarea');
  const groupCaptureTarget = document.getElementById('group-capture-target');
  const btnSendGroup = document.getElementById('btn-send-group');
  const groupSendStatus = document.getElementById('group-send-status');

  let currentParsedResult = null;
  let isEditing = false;

  // Alternância de Abas
  tabBtnPage.addEventListener('click', () => {
    tabBtnPage.classList.add('active');
    tabBtnGroup.classList.remove('active');
    tabPageView.classList.remove('hidden');
    tabGroupView.classList.add('hidden');
  });

  tabBtnGroup.addEventListener('click', () => {
    tabBtnGroup.classList.add('active');
    tabBtnPage.classList.remove('active');
    tabGroupView.classList.remove('hidden');
    tabPageView.classList.add('hidden');
  });

  // Copiar link de afiliado gerado (Link Builder)
  btnCopyTracking.addEventListener('click', async () => {
    const textToCopy = linkBuilderTracking.value || currentAwinTrackingLink;
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      btnCopyTracking.textContent = '✓ Copiado!';
      linkBuilderStatus.textContent = '✅ Link copiado para a área de transferência!';
      linkBuilderStatus.className = 'msg msg-success';
      setTimeout(() => {
        btnCopyTracking.textContent = '📋 Copiar Link';
      }, 2500);
    } catch {
      linkBuilderStatus.textContent = '❌ Falha ao copiar link.';
      linkBuilderStatus.className = 'msg msg-error';
    }
  });

  // Encurtar link via API da AWIN
  btnShortenTracking.addEventListener('click', async () => {
    if (!isAuthed) {
      linkBuilderStatus.textContent = '❌ Conecte à sua conta para encurtar com a API da AWIN.';
      linkBuilderStatus.className = 'msg msg-error';
      return;
    }
    const origUrl = linkBuilderOrig.value;
    if (!origUrl) return;

    btnShortenTracking.disabled = true;
    linkBuilderStatus.textContent = 'Encurtando link via API da AWIN...';
    linkBuilderStatus.className = 'msg';

    try {
      const res = await fetch(`${normalizeApiUrl(config.apiUrl)}/api/v1/extension/awin/generate-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiToken}`,
        },
        body: JSON.stringify({
          destinationUrl: origUrl,
          shorten: true,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          linkBuilderTracking.value = data.url;
          currentAwinTrackingLink = data.url;
          linkBuilderStatus.textContent = '✅ Link encurtado via API AWIN!';
          linkBuilderStatus.className = 'msg msg-success';
        }
      } else {
        const err = await res.json().catch(() => null);
        linkBuilderStatus.textContent = `❌ ${err?.error?.message || 'Falha ao encurtar link'}`;
        linkBuilderStatus.className = 'msg msg-error';
      }
    } catch {
      linkBuilderStatus.textContent = '❌ Erro de conexão com a API';
      linkBuilderStatus.className = 'msg msg-error';
    } finally {
      btnShortenTracking.disabled = false;
    }
  });

  async function syncAwinPartners() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const saved = await chrome.storage.local.get(['awinPartners', 'awinPublisherId']);
      if (saved.awinPartners) awinPartners = { ...awinPartners, ...saved.awinPartners };
      if (saved.awinPublisherId) awinPublisherId = saved.awinPublisherId;
    }

    if (!isAuthed) return;

    try {
      const res = await fetch(`${normalizeApiUrl(config.apiUrl)}/api/v1/extension/awin/partners`, {
        headers: { Authorization: `Bearer ${config.apiToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.partners) {
          awinPartners = { ...awinPartners, ...data.partners };
        }
        if (data.publisherId) {
          awinPublisherId = data.publisherId;
        }
        if (typeof chrome !== 'undefined' && chrome.storage) {
          await chrome.storage.local.set({ awinPartners, awinPublisherId });
        }
      }
    } catch {}
  }

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
  let currentTabId = null;
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

  // --- Destinos de Envio: Fila de Triagem, Automações e Lotes (incluindo concluídos) ---
  let automationRules = [];
  let activeBatches = [];

  const BATCH_STATUS_LABEL = {
    SCHEDULED: 'agendado',
    RUNNING: 'rodando',
    PAUSED: 'pausado',
    DONE: 'concluído',
  };

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

    btnCaptureAll.textContent =
      t.kind === 'batch' && name
        ? `📦 Enviar todos da página para lote: ${name}`
        : t.kind === 'rule' && name
          ? `📦 Enviar todos da página para: ${name}`
          : '📦 Enviar todos da página para Fila de Triagem';

    // Atualiza também o botão da aba "Colar de Grupo"
    const gt = parseTarget(groupCaptureTarget.value);
    const gname = findTargetName(groupCaptureTarget.value);
    if (gt.kind === 'batch' && gname) btnSendGroup.textContent = `🚀 Enviar para lote: ${gname}`;
    else if (gt.kind === 'rule' && gname) btnSendGroup.textContent = `🚀 Enviar para: ${gname}`;
    else btnSendGroup.textContent = '🚀 Enviar para Fila de Triagem';
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

  function populateSelect(selectEl) {
    selectEl.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Fila de Triagem';
    selectEl.appendChild(defaultOpt);

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
      selectEl.appendChild(group);
    }
    addGroup('Automações', automationRules, (r) => ({ value: `rule:${r.id}`, text: r.name }));
    addGroup('Lotes', activeBatches, (b) => ({
      value: `batch:${b.id}`,
      text: `${b.name} (${BATCH_STATUS_LABEL[b.status] || b.status} · ${b.pending} pendentes)`,
    }));
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
      groupCaptureTarget.innerHTML = '';
      updateCaptureButtonLabel();
      return;
    }

    captureTargetLabel.classList.remove('hidden');
    captureTarget.classList.remove('hidden');

    populateSelect(captureTarget);
    populateSelect(groupCaptureTarget);

    if (typeof chrome !== 'undefined' && chrome.storage) {
      const { lastCaptureTarget } = await chrome.storage.local.get(['lastCaptureTarget']);
      const saved =
        typeof lastCaptureTarget === 'string'
          ? lastCaptureTarget && `rule:${lastCaptureTarget}`
          : lastCaptureTarget && lastCaptureTarget.value;
      if (saved && findTargetName(saved) !== undefined) {
        captureTarget.value = saved;
        groupCaptureTarget.value = saved;
      } else if (saved) {
        await saveCaptureTarget();
      }
    }
    updateCaptureButtonLabel();
  }

  captureTarget.addEventListener('change', async () => {
    groupCaptureTarget.value = captureTarget.value;
    updateCaptureButtonLabel();
    await saveCaptureTarget();
  });

  groupCaptureTarget.addEventListener('change', async () => {
    captureTarget.value = groupCaptureTarget.value;
    updateCaptureButtonLabel();
    await saveCaptureTarget();
  });

  await loadCaptureTargets();

  // --- Processamento de Mensagem de Outro Grupo ---
  btnProcessText.addEventListener('click', async () => {
    const text = groupTextInput.value.trim();
    if (!text) {
      groupProcessMsg.textContent = '❌ Cole um texto de promoção antes de processar.';
      groupProcessMsg.className = 'msg msg-error';
      return;
    }

    if (!isAuthed) {
      groupProcessMsg.textContent = '❌ Conecte à sua conta antes de processar.';
      groupProcessMsg.className = 'msg msg-error';
      return;
    }

    btnProcessText.disabled = true;
    groupProcessMsg.textContent = 'Processando texto e gerando seus links de afiliado...';
    groupProcessMsg.className = 'msg';

    try {
      const res = await fetch(`${normalizeApiUrl(config.apiUrl)}/api/v1/extension/convert-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiToken}`,
        },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        groupProcessMsg.textContent = `❌ ${err?.error?.message || 'Falha ao processar texto'}`;
        groupProcessMsg.className = 'msg msg-error';
        btnProcessText.disabled = false;
        return;
      }

      const data = await res.json();
      currentParsedResult = data;

      groupProcessMsg.textContent = '✅ Texto processado com sucesso!';
      groupProcessMsg.className = 'msg msg-success';

      renderParsedGroupOffer(data);
    } catch {
      groupProcessMsg.textContent = '❌ Erro de conexão com a API';
      groupProcessMsg.className = 'msg msg-error';
    } finally {
      btnProcessText.disabled = false;
    }
  });

  function renderParsedGroupOffer(data) {
    const { detected, convertedText } = data;
    groupParsedCard.classList.remove('hidden');

    // Preço
    if (detected.price) {
      tagPrice.classList.remove('hidden');
      valPrice.textContent = `R$ ${detected.price.toFixed(2).replace('.', ',')}`;
      if (detected.originalPrice && detected.originalPrice > detected.price) {
        valOrig.textContent = `De R$ ${detected.originalPrice.toFixed(2).replace('.', ',')}`;
        valOrig.classList.remove('hidden');
      } else {
        valOrig.classList.add('hidden');
      }
      if (detected.discountPct) {
        valDisc.textContent = `(${detected.discountPct}% OFF)`;
        valDisc.classList.remove('hidden');
      } else {
        valDisc.classList.add('hidden');
      }
    } else {
      tagPrice.classList.add('hidden');
    }

    // Cupom
    if (detected.coupon) {
      tagCoupon.classList.remove('hidden');
      valCoupon.textContent = detected.coupon;
    } else {
      tagCoupon.classList.add('hidden');
    }

    // Relatório de Links
    groupLinksReport.innerHTML = '';
    const links = detected.links || [];
    if (links.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-desc';
      emptyDiv.textContent = 'Nenhum link de produto encontrado no texto.';
      groupLinksReport.appendChild(emptyDiv);
    } else {
      for (const link of links) {
        const item = document.createElement('div');
        item.className = 'link-status-item';

        const header = document.createElement('div');
        header.className = 'link-status-header';

        const title = document.createElement('strong');
        title.textContent = link.marketplace !== 'UNKNOWN' ? link.marketplace : 'Link';
        header.appendChild(title);

        const badge = document.createElement('span');
        if (link.converted) {
          badge.className = 'link-status-badge-ok';
          badge.textContent = '✓ Link Trocado';
        } else {
          badge.className = 'link-status-badge-warn';
          badge.textContent = link.error || 'Não convertido';
        }
        header.appendChild(badge);
        item.appendChild(header);

        if (link.converted) {
          const affUrl = document.createElement('div');
          affUrl.className = 'link-converted-text';
          affUrl.textContent = `⚡ Seu link: ${link.affiliateUrl}`;
          item.appendChild(affUrl);
        } else {
          const rawUrl = document.createElement('div');
          rawUrl.className = 'link-url-text';
          rawUrl.textContent = link.originalUrl;
          item.appendChild(rawUrl);
        }

        groupLinksReport.appendChild(item);
      }
    }

    // Prévia e Edição Rápida
    groupPreviewBubble.textContent = convertedText;
    groupEditTextarea.value = convertedText;
    isEditing = false;
    groupPreviewBubble.classList.remove('hidden');
    groupEditTextarea.classList.add('hidden');
    btnToggleEdit.textContent = '✏️ Editar rápido';

    updateCaptureButtonLabel();
    groupSendStatus.textContent = '';
  }

  // Alternar edição rápida
  btnToggleEdit.addEventListener('click', () => {
    isEditing = !isEditing;
    if (isEditing) {
      groupPreviewBubble.classList.add('hidden');
      groupEditTextarea.classList.remove('hidden');
      btnToggleEdit.textContent = '👁️ Ver prévia';
      groupEditTextarea.focus();
    } else {
      groupPreviewBubble.textContent = groupEditTextarea.value;
      groupEditTextarea.classList.add('hidden');
      groupPreviewBubble.classList.remove('hidden');
      btnToggleEdit.textContent = '✏️ Editar rápido';
    }
  });

  groupEditTextarea.addEventListener('input', () => {
    groupPreviewBubble.textContent = groupEditTextarea.value;
  });

  // Enviar oferta copiada de grupo para Fila / Lote
  btnSendGroup.addEventListener('click', async () => {
    if (!currentParsedResult) return;

    const target = parseTarget(groupCaptureTarget.value);
    const name = findTargetName(groupCaptureTarget.value) ?? '';
    const finalText = groupEditTextarea.value.trim() || groupPreviewBubble.textContent.trim();

    // Identifica o link principal da mensagem
    const detectedLinks = currentParsedResult.detected?.links || [];
    const mainLink = detectedLinks.find((l) => l.converted) || detectedLinks[0];

    const url = mainLink ? (mainLink.resolvedUrl || mainLink.originalUrl) : 'https://www.mercadolivre.com.br';
    const marketplaceKind = mainLink && mainLink.marketplace !== 'UNKNOWN'
      ? mainLink.marketplace
      : 'MERCADOLIVRE';

    const payload = {
      url,
      marketplaceKind,
      title: currentParsedResult.detected?.title || 'Oferta copiada de grupo',
      ...(currentParsedResult.detected?.price ? { price: currentParsedResult.detected.price } : {}),
      ...(currentParsedResult.detected?.originalPrice ? { originalPrice: currentParsedResult.detected.originalPrice } : {}),
      ...(currentParsedResult.detected?.discountPct ? { discountPct: currentParsedResult.detected.discountPct } : {}),
      ...(currentParsedResult.detected?.coupon ? { couponCode: currentParsedResult.detected.coupon } : {}),
      customText: finalText,
      ...(target.kind === 'rule' ? { automationRuleId: target.id } : {}),
      ...(target.kind === 'batch' ? { batchId: target.id } : {}),
    };

    btnSendGroup.disabled = true;
    groupSendStatus.textContent = 'Enviando oferta...';
    groupSendStatus.className = 'msg';

    try {
      const res = await fetch(`${normalizeApiUrl(config.apiUrl)}/api/v1/extension/capture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (target.kind === 'batch') {
          groupSendStatus.textContent = data?.batchItem?.runAt
            ? `✅ Mensagem adicionada ao lote "${name}" (agendado para envio)!`
            : `✅ Mensagem adicionada ao lote "${name}"!`;
        } else if (target.kind === 'rule') {
          groupSendStatus.textContent = `✅ Mensagem adicionada à automação "${name}"!`;
        } else {
          groupSendStatus.textContent = '✅ Mensagem adicionada à Fila de Triagem!';
        }
        groupSendStatus.className = 'msg msg-success';
        btnSendGroup.textContent = '✓ Enviado';
        void loadCaptureTargets();
      } else {
        const err = await res.json().catch(() => null);
        groupSendStatus.textContent = `❌ ${err?.error?.message || 'Falha ao enviar mensagem'}`;
        groupSendStatus.className = 'msg msg-error';
        btnSendGroup.disabled = false;
        if (err?.error?.code === 'BATCH_INACTIVE' || res.status === 404) {
          void loadCaptureTargets();
        }
      }
    } catch {
      groupSendStatus.textContent = '❌ Erro de conexão com a API';
      groupSendStatus.className = 'msg msg-error';
      btnSendGroup.disabled = false;
    }
  });

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
      chrome.runtime
        .sendMessage({ action: 'SYNC_ML_SESSION' })
        .then(renderMlSession)
        .catch(() => {});
      void syncAwinPartners();
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
    currentTabId = tab.id;
    let marketplaceKind = null;

    let hostname = '';
    try {
      hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {}

    let currentAwinPartner = null;

    if (url.includes('mercadolivre.com.br')) marketplaceKind = 'MERCADOLIVRE';
    else if (url.includes('amazon.com.br')) marketplaceKind = 'AMAZON';
    else if (url.includes('magazineluiza.com.br') || url.includes('magazinevoce.com.br'))
      marketplaceKind = 'MAGALU';
    else if (url.includes('shopee.com.br')) marketplaceKind = 'SHOPEE';
    else if (url.includes('aliexpress.com')) marketplaceKind = 'ALIEXPRESS';
    else if (hostname) {
      if (awinPartners[hostname]) {
        currentAwinPartner = awinPartners[hostname];
        marketplaceKind = 'AWIN';
      } else {
        const found = Object.values(awinPartners).find(
          (p) => hostname === p.domain || hostname.endsWith(`.${p.domain}`),
        );
        if (found) {
          currentAwinPartner = found;
          marketplaceKind = 'AWIN';
        }
      }
    }

    if (!marketplaceKind) {
      if (linkBuilderSection) linkBuilderSection.classList.add('hidden');
      productSection.classList.add('hidden');
      unsupportedSection.classList.remove('hidden');
      return;
    }

    // Configura o Link Builder para parceiros AWIN
    if (marketplaceKind === 'AWIN') {
      const advertiserId = currentAwinPartner?.advertiserId || '68224';
      const partnerName = currentAwinPartner?.name || 'Drogal BR';
      const pubId = awinPublisherId || '691887';

      currentAwinTrackingLink = `https://www.awin1.com/cread.php?awinmid=${advertiserId}&awinaffid=${pubId}&platform=dl&ued=${encodeURIComponent(url)}`;

      if (linkBuilderSection) {
        linkBuilderStore.textContent = partnerName;
        linkBuilderOrig.value = url;
        linkBuilderTracking.value = currentAwinTrackingLink;
        linkBuilderStatus.textContent = '';
        linkBuilderSection.classList.remove('hidden');
      }
    } else if (linkBuilderSection) {
      linkBuilderSection.classList.add('hidden');
    }

    let pageProduct = null;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PRODUCT_DATA' });
      if (response && response.product) {
        pageProduct = response.product;
      }
    } catch {
      // Content script pode não ter sido injetado ainda na aba (ex: aberta antes da extensão)
      if (chrome.scripting && chrome.scripting.executeScript && tab.id) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/coupon-stores.js', 'content/content.js'],
          });
          const retryRes = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PRODUCT_DATA' });
          if (retryRes && retryRes.product) {
            pageProduct = retryRes.product;
          }
        } catch {
          // Extração direta inline no contexto da página como fallback
          try {
            const [evalRes] = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                const title =
                  document.querySelector('h1')?.textContent?.trim() ||
                  document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                  document.title;
                const images = [];
                const og =
                  document.querySelector('meta[property="og:image:secure_url"]')?.getAttribute('content') ||
                  document.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
                  document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
                if (og && og.startsWith('http')) images.push(og);
                if (images.length === 0) {
                  for (const img of Array.from(document.querySelectorAll('img'))) {
                    if (img.src && img.src.startsWith('http') && !/logo|icon|badge|avatar|flag/i.test(img.src)) {
                      const w = img.naturalWidth || img.clientWidth || 0;
                      if (w >= 100) {
                        images.push(img.src);
                        break;
                      }
                    }
                  }
                }
                let price = null;
                const metaP =
                  document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content') ||
                  document.querySelector('meta[property="og:price:amount"]')?.getAttribute('content');
                if (metaP) {
                  const p = parseFloat(metaP.replace(',', '.'));
                  if (!isNaN(p) && p > 0) price = p;
                }
                return { title, images, price };
              },
            });
            if (evalRes && evalRes.result) {
              pageProduct = evalRes.result;
            }
          } catch {}
        }
      }
    }

    currentProduct = {
      ...(pageProduct || {}),
      url,
      marketplaceKind,
      title: pageProduct?.title || tab.title || 'Produto detectado na página',
      ...(currentAwinTrackingLink ? { affiliateUrl: currentAwinTrackingLink } : {}),
    };

    await loadCouponsForCurrentProduct(marketplaceKind, currentAwinPartner, hostname);
    renderProductPreview(currentProduct);
  }

  async function loadCouponsForCurrentProduct(marketplaceKind, awinPartner, hostname) {
    if (!config.apiToken) return;
    activeStoreCoupons = [];

    let queryParams = `store=${encodeURIComponent(marketplaceKind)}`;
    if (marketplaceKind === 'AWIN') {
      const advId = awinPartner?.advertiserId;
      if (advId) queryParams += `&advertiserId=${encodeURIComponent(advId)}`;
      if (hostname) queryParams += `&domain=${encodeURIComponent(hostname)}`;
    }

    try {
      const res = await fetch(
        `${normalizeApiUrl(config.apiUrl)}/api/v1/extension/coupons?${queryParams}`,
        {
          headers: { Authorization: `Bearer ${config.apiToken}` },
        },
      );
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : data?.coupons || [];
        if (list.length > 0) {
          activeStoreCoupons = list;

          // Se o produto não tinha cupom ainda, aplica o primeiro automaticamente
          if (!currentProduct.couponCode) {
            currentProduct.couponCode = activeStoreCoupons[0].code;
            if (activeStoreCoupons[0].discountValue) {
              currentProduct.couponValue = activeStoreCoupons[0].discountValue;
            }
          }
        }
      }
    } catch {}

    renderCouponSection();
  }

  function renderCouponSection() {
    if (!pCouponSection) return;

    if (!currentProduct || (!currentProduct.couponCode && activeStoreCoupons.length === 0)) {
      pCouponSection.classList.add('hidden');
      return;
    }

    const currentCode = currentProduct.couponCode;
    const matched = activeStoreCoupons.find(
      (c) => c.code.toUpperCase() === (currentCode || '').toUpperCase(),
    );

    if (currentCode) {
      pCouponSection.classList.remove('hidden');
      pCouponBadge.textContent = currentCode;
      pCouponDesc.textContent =
        matched?.description ||
        matched?.terms ||
        (currentProduct.couponValue
          ? `Desconto de R$ ${currentProduct.couponValue.toFixed(2)}`
          : 'Cupom aplicado à mensagem');
    } else {
      pCouponBadge.textContent = 'Nenhum';
      pCouponDesc.textContent = 'Nenhum cupom selecionado';
    }

    if (activeStoreCoupons.length > 0) {
      pCouponSelect.innerHTML = '';
      const optNone = document.createElement('option');
      optNone.value = '';
      optNone.textContent = '— Sem cupom —';
      pCouponSelect.appendChild(optNone);

      for (const c of activeStoreCoupons) {
        const opt = document.createElement('option');
        opt.value = c.code;
        const discountLabel = c.discountValue ? ` (-R$ ${c.discountValue.toFixed(2)})` : '';
        const titleText = c.description || c.advertiserName || '';
        opt.textContent = `🎟️ ${c.code}${discountLabel}${titleText ? ` — ${titleText}` : ''}`.slice(
          0,
          48,
        );
        if (currentCode && c.code.toUpperCase() === currentCode.toUpperCase()) {
          opt.selected = true;
        }
        pCouponSelect.appendChild(opt);
      }
      pCouponSelect.classList.remove('hidden');
    } else {
      pCouponSelect.classList.add('hidden');
    }
  }

  pCouponSelect?.addEventListener('change', () => {
    const val = pCouponSelect.value;
    if (val) {
      const found = activeStoreCoupons.find((c) => c.code === val);
      currentProduct.couponCode = val;
      currentProduct.couponValue = found?.discountValue ?? null;
    } else {
      currentProduct.couponCode = null;
      currentProduct.couponValue = null;
    }
    renderCouponSection();
    renderProductPreview(currentProduct);
  });

  btnRemoveCoupon?.addEventListener('click', () => {
    currentProduct.couponCode = null;
    currentProduct.couponValue = null;
    pCouponSection.classList.add('hidden');
    renderProductPreview(currentProduct);
  });

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
      imgEl.onerror = () => {
        imgEl.classList.add('hidden');
      };
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

  function buildCapturePayload(product, target, batchPosition) {
    return {
      url: product.url,
      marketplaceKind: product.marketplaceKind,
      ...(product.affiliateUrl || currentAwinTrackingLink
        ? { affiliateUrl: product.affiliateUrl || currentAwinTrackingLink }
        : {}),
      ...(product.title ? { title: product.title } : {}),
      ...(product.price !== null && product.price !== undefined ? { price: product.price } : {}),
      ...(product.originalPrice ? { originalPrice: product.originalPrice } : {}),
      ...(product.discountPct ? { discountPct: product.discountPct } : {}),
      ...(product.images && product.images.length > 0 ? { images: product.images } : {}),
      ...(product.shipping && product.shipping !== 'UNKNOWN' ? { shipping: product.shipping } : {}),
      ...(product.couponCode ? { couponCode: product.couponCode } : {}),
      ...(product.couponValue ? { couponValue: product.couponValue } : {}),
      ...(target.kind === 'rule' ? { automationRuleId: target.id } : {}),
      ...(target.kind === 'batch'
        ? { batchId: target.id, ...(batchPosition ? { batchPosition } : {}) }
        : {}),
    };
  }

  // Enviar todos os produtos da página para o destino selecionado
  btnCaptureAll.addEventListener('click', async () => {
    if (!currentProduct || currentTabId === null) return;
    const marketplaceKind = currentProduct.marketplaceKind;
    const target = parseTarget(captureTarget.value);
    const name = findTargetName(captureTarget.value) ?? '';
    const destino =
      target.kind === 'batch'
        ? `o lote "${name}"`
        : target.kind === 'rule'
          ? `a automação "${name}"`
          : 'a Fila de Triagem';

    btnCaptureAll.disabled = true;
    captureAllStatus.className = 'msg';
    captureAllStatus.style.whiteSpace = 'pre-line';
    captureAllStatus.textContent = 'Lendo os produtos da página...';

    let items = [];
    try {
      const res = await chrome.tabs.sendMessage(currentTabId, { action: 'EXTRACT_PRODUCTS' });
      items = ((res && res.items) || []).filter((it) => it.title && it.price > 0);
    } catch {
      captureAllStatus.textContent = '❌ Não foi possível ler os produtos desta página';
      captureAllStatus.className = 'msg msg-error';
      btnCaptureAll.disabled = false;
      return;
    }

    if (items.length === 0) {
      captureAllStatus.textContent = 'Nenhum produto com título e preço foi encontrado na página.';
      btnCaptureAll.disabled = false;
      return;
    }
    if (!window.confirm(`Enviar ${items.length} produto(s) para ${destino}?`)) {
      captureAllStatus.textContent = '';
      btnCaptureAll.disabled = false;
      return;
    }

    const queue = items;
    let sent = 0;
    let failed = 0;
    let abortReason = '';
    for (let i = 0; i < queue.length; i++) {
      captureAllStatus.textContent = `Enviando ${i + 1}/${queue.length}...`;
      try {
        const res = await fetch(`${normalizeApiUrl(config.apiUrl)}/api/v1/extension/capture`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiToken}`,
          },
          body: JSON.stringify(
            buildCapturePayload({ ...queue[i], marketplaceKind }, target, 'random'),
          ),
        });
        if (res.ok) {
          sent++;
          continue;
        }
        failed++;
        const err = await res.json().catch(() => null);
        if (err?.error?.code === 'BATCH_INACTIVE' || res.status === 404) {
          abortReason = err?.error?.message || 'Destino indisponível';
          void loadCaptureTargets();
          break;
        }
      } catch {
        failed++;
      }
    }

    const notSent = queue.length - sent - failed;
    const lines = [`✅ ${sent} enviado(s) para ${destino}`];
    if (failed) lines.push(`❌ ${failed} falharam`);
    if (abortReason) lines.push(`Envio interrompido: ${abortReason} (${notSent} não enviados)`);
    captureAllStatus.textContent = lines.join('\n');
    captureAllStatus.className = failed ? 'msg msg-error' : 'msg msg-success';
    btnCaptureAll.disabled = false;
  });

  // Capturar oferta da aba ativa
  btnCapture.addEventListener('click', async () => {
    if (!currentProduct) return;
    btnCapture.disabled = true;
    captureStatus.textContent = 'Enviando oferta para o Afilados...';
    captureStatus.className = 'msg';

    const target = parseTarget(captureTarget.value);
    const payload = buildCapturePayload(currentProduct, target);

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
            ? `✅ Adicionado ao lote "${name}"!`
            : `✅ Adicionado ao lote "${name}" (pausado): sai primeiro quando for retomado.`;
        } else {
          const destino = target.kind === 'rule' ? `automação "${name}"` : 'Fila de Triagem';
          captureStatus.textContent = `✅ Oferta adicionada em ${destino}!`;
        }
        captureStatus.className = 'msg msg-success';
        btnCapture.textContent = '✓ Adicionado';
        void loadCaptureTargets();
      } else {
        const err = await res.json().catch(() => null);
        captureStatus.textContent = `❌ ${err?.error?.message || 'Falha ao capturar oferta'}`;
        captureStatus.className = 'msg msg-error';
        btnCapture.disabled = false;
        if (err?.error?.code === 'BATCH_INACTIVE' || res.status === 404) void loadCaptureTargets();
      }
    } catch {
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

  await syncAwinPartners();
  inspectCurrentTab();
  if (isAuthed) {
    renderMlSession();
  }
});
