import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiSettingsForm } from '@/components/settings/ai-settings-form';
import type { AiSettings, AiSettingsPatch } from '@/lib/types';

const value: AiSettings = {
  enabled: false, baseUrl: 'https://vps.exemplo.com/v1', model: 'combo',
  hasApiKey: true, apiKeyHint: '••••1234',
  extraInstructions: '', tone: 'empolgado', emojiLevel: 'medio', maxChars: 140, temperature: 0.9,
};
const noTest = vi.fn(async (_draft?: AiSettingsPatch) => ({ cta: 'x', latencyMs: 1 }));

describe('AiSettingsForm', () => {
  it('mostra os valores atuais e a máscara da chave no placeholder (nunca a chave)', () => {
    render(<AiSettingsForm value={value} onSave={vi.fn()} onTest={noTest} />);
    expect((screen.getByLabelText(/base url/i) as HTMLInputElement).value).toBe('https://vps.exemplo.com/v1');
    expect((screen.getByLabelText(/modelo/i) as HTMLInputElement).value).toBe('combo');
    const key = screen.getByLabelText(/api key/i) as HTMLInputElement;
    expect(key.type).toBe('password');
    expect(key.value).toBe('');
    expect(key.placeholder).toBe('••••1234');
  });
  it('sem alterações não chama onSave', () => {
    const onSave = vi.fn();
    render(<AiSettingsForm value={value} onSave={onSave} onTest={noTest} />);
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSave).not.toHaveBeenCalled();
  });
  it('envia só os campos alterados (apiKey vazia fica de fora)', () => {
    const onSave = vi.fn();
    render(<AiSettingsForm value={value} onSave={onSave} onTest={noTest} />);
    fireEvent.change(screen.getByLabelText(/modelo/i), { target: { value: 'novo-combo' } });
    fireEvent.click(screen.getByRole('switch', { name: /ativar cta com ia/i }));
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSave).toHaveBeenCalledWith({ model: 'novo-combo', enabled: true });
  });
  it('inclui apiKey só quando digitada', () => {
    const onSave = vi.fn();
    render(<AiSettingsForm value={value} onSave={onSave} onTest={noTest} />);
    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'sk-nova' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSave).toHaveBeenCalledWith({ apiKey: 'sk-nova' });
  });
  it('opções avançadas: tom, emojis, maxChars, temperature, instruções extras', () => {
    const onSave = vi.fn();
    render(<AiSettingsForm value={value} onSave={onSave} onTest={noTest} />);
    fireEvent.change(screen.getByLabelText(/tom/i), { target: { value: 'urgente' } });
    fireEvent.change(screen.getByLabelText(/emojis/i), { target: { value: 'muitos' } });
    fireEvent.change(screen.getByLabelText(/máx.*caracteres/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/temperature/i), { target: { value: '1.2' } });
    fireEvent.change(screen.getByLabelText(/instruções extras/i), { target: { value: 'Fale como gamer' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSave).toHaveBeenCalledWith({
      tone: 'urgente', emojiLevel: 'muitos', maxChars: 100, temperature: 1.2, extraInstructions: 'Fale como gamer',
    });
  });
  it('Testar envia o rascunho do formulário e mostra o CTA e a latência', async () => {
    const onTest = vi.fn(async (_draft: AiSettingsPatch) => ({ cta: 'Nossaaa! Que fone! 🔥', latencyMs: 812 }));
    render(<AiSettingsForm value={value} onSave={vi.fn()} onTest={onTest} />);
    fireEvent.change(screen.getByLabelText(/modelo/i), { target: { value: 'rascunho' } });
    fireEvent.click(screen.getByRole('button', { name: /testar/i }));
    expect(await screen.findByText(/Nossaaa! Que fone! 🔥/)).toBeTruthy();
    expect(screen.getByText(/812/)).toBeTruthy();
    expect(onTest).toHaveBeenCalledWith(expect.objectContaining({ model: 'rascunho', baseUrl: value.baseUrl }));
    expect(onTest.mock.calls[0]![0]).not.toHaveProperty('apiKey');
  });
  it('Testar mostra a mensagem de erro', async () => {
    const onTest = vi.fn(async (_draft: AiSettingsPatch) => {
      throw new Error('IA respondeu HTTP 401');
    });
    render(<AiSettingsForm value={value} onSave={vi.fn()} onTest={onTest} />);
    fireEvent.click(screen.getByRole('button', { name: /testar/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/HTTP 401/));
  });
});
