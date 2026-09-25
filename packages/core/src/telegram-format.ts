const CODE_BLOCK_RE = /```([\s\S]*?)```/g;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const URL_RE = /(https?:\/\/\S+)/g;
const BOLD_RE = /\*([^*\n]+)\*/g;
const ITALIC_RE = /_([^_\n]+)_/g;
const STRIKE_RE = /~([^~\n]+)~/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Converte texto com marcação estilo WhatsApp (*negrito*, _itálico_, ~riscado~,
 * `código`, ```bloco```) para HTML aceito pelo Telegram (parse_mode: 'HTML').
 * URLs são protegidas da conversão para não quebrar com `_` no meio do link.
 */
export function whatsappToTelegramHtml(text: string): string {
  const placeholders: string[] = [];
  const hold = (html: string) => {
    placeholders.push(html);
    return `\u0000${placeholders.length - 1}\u0000`;
  };

  let out = text
    .replace(CODE_BLOCK_RE, (_m, inner: string) => hold(`<pre>${escapeHtml(inner)}</pre>`))
    .replace(INLINE_CODE_RE, (_m, inner: string) => hold(`<code>${escapeHtml(inner)}</code>`))
    .replace(URL_RE, (url: string) => hold(escapeHtml(url)));

  out = escapeHtml(out);
  out = out
    .replace(BOLD_RE, (_m, inner: string) => `<b>${inner}</b>`)
    .replace(ITALIC_RE, (_m, inner: string) => `<i>${inner}</i>`)
    .replace(STRIKE_RE, (_m, inner: string) => `<s>${inner}</s>`);

  return out.replace(/\u0000(\d+)\u0000/g, (_m, idx: string) => placeholders[Number(idx)] ?? '');
}
