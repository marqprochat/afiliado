import { describe, it, expect } from 'vitest';
import { formatBRL, statusTone } from '@/lib/format';

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
});
