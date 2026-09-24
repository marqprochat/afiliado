import { describe, it, expect } from 'vitest';
import { formatBRL, statusTone, translateMirrorReason } from '@/lib/format';

describe('format', () => {
  it('formatBRL', () => {
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50');
    expect(formatBRL(null)).toBe('—');
  });
  it('statusTone', () => {
    expect(statusTone('CONNECTED')).toBe('ok');
    expect(statusTone('OK')).toBe('ok');
    expect(statusTone('NEEDS_QR')).toBe('warn');
    expect(statusTone('CONNECTING')).toBe('warn');
    expect(statusTone('ERROR')).toBe('error');
    expect(statusTone('LOGGED_OUT')).toBe('error');
    expect(statusTone('UNCONFIGURED')).toBe('muted');
  });
  it('translateMirrorReason: códigos conhecidos', () => {
    expect(translateMirrorReason('no-links')).toBe('Sem links');
    expect(translateMirrorReason('short-link-unresolved')).toBe('Link encurtado não abriu');
    expect(translateMirrorReason('duplicate')).toBe('Duplicado');
    expect(translateMirrorReason('template->clone')).toBe('Enviado como cópia');
    expect(translateMirrorReason('WA_NOT_CONNECTED')).toBe('WhatsApp desconectado');
  });
  it('translateMirrorReason: unsupported-store com uma loja', () => {
    expect(translateMirrorReason('unsupported-store:AMAZON')).toBe('Sem credencial: Amazon');
  });
  it('translateMirrorReason: unsupported-store com várias lojas', () => {
    expect(translateMirrorReason('unsupported-store:AMAZON,MERCADOLIVRE')).toBe(
      'Sem credencial: Amazon, Mercado Livre',
    );
  });
  it('translateMirrorReason: combina múltiplos motivos separados por ;', () => {
    expect(translateMirrorReason('template->clone;unsupported-store:AMAZON')).toBe(
      'Enviado como cópia, Sem credencial: Amazon',
    );
  });
  it('translateMirrorReason: código não mapeado passa intacto', () => {
    expect(translateMirrorReason('Connection Timed Out unexpectedly')).toBe(
      'Connection Timed Out unexpectedly',
    );
  });
  it('translateMirrorReason: null/undefined vira null', () => {
    expect(translateMirrorReason(null)).toBeNull();
    expect(translateMirrorReason(undefined)).toBeNull();
  });
});
