import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsForm } from '@/components/settings/settings-form';

const value = {
  window: { startTime: '07:30', endTime: '23:30', timezone: 'America/Sao_Paulo', enabled: true },
  queueLimit: 500,
  globalRateLimitPerMin: 6,
  subIdPattern: '{yyyyMMdd}-{batchId}',
};

describe('SettingsForm', () => {
  it('envia só os campos alterados', () => {
    const onSave = vi.fn();
    render(<SettingsForm value={value} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/limite da fila/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/^fim$/i), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSave).toHaveBeenCalledWith({ queueLimit: 100, window: { endTime: '22:00' } });
  });
  it('sem alterações não chama onSave', () => {
    const onSave = vi.fn();
    render(<SettingsForm value={value} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
