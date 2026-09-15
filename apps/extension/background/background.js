// Background Service Worker para sincronização de sessão

chrome.runtime.onInstalled.addListener(() => {
  console.log('Afilados Connect instalado com sucesso.');
});

// Listener de cookies para sincronização automática de sessão de afiliados
if (chrome.cookies) {
  chrome.cookies.onChanged.addListener(async (changeInfo) => {
    const domain = changeInfo.cookie.domain;
    if (domain.includes('mercadolivre.com.br') && !changeInfo.removed) {
      // Sincroniza se configurado
      const saved = await chrome.storage.local.get(['apiUrl', 'apiToken']);
      if (!saved.apiToken) return;

      try {
        const mlCookies = await chrome.cookies.getAll({ domain: 'mercadolivre.com.br' });
        const cookieMap = {};
        for (const c of mlCookies) {
          cookieMap[c.name] = c.value;
        }

        await fetch(`${saved.apiUrl || 'http://localhost:3001'}/api/v1/extension/session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${saved.apiToken}`,
          },
          body: JSON.stringify({
            marketplaceKind: 'MERCADOLIVRE',
            cookies: cookieMap,
          }),
        });
      } catch (e) {
        // Silencioso em background
      }
    }
  });
}
