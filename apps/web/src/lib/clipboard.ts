/**
 * Utilitário seguro para cópia de texto para a área de transferência.
 * Funciona tanto em ambientes HTTPS quanto em HTTP (como IPs locais tipo 192.168.x.x),
 * onde `navigator.clipboard` é desativado por padrão pelos navegadores.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  // 1. Tenta API moderna do Clipboard (ativa em HTTPS ou localhost)
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Ignora e segue para o fallback abaixo
  }

  // 2. Fallback robusto via document.execCommand (funciona em HTTP sem certificado)
  try {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    }
  } catch (err) {
    console.error('Falha ao copiar para clipboard:', err);
  }

  return false;
}
