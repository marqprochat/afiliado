import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { TemplateEditor } from '@/components/templates/template-editor';

describe('TemplateEditor', () => {
  it('insere variável no corpo e chama preview com debounce', async () => {
    vi.useFakeTimers();
    const preview = vi.fn(async (b: string) => `PREVIEW:${b}`);
    render(<TemplateEditor onSave={vi.fn()} preview={preview} />);
    fireEvent.click(screen.getByRole('button', { name: '{titulo}' }));
    expect((screen.getByLabelText(/corpo/i) as HTMLTextAreaElement).value).toContain('{titulo}');
    await act(async () => {
      vi.advanceTimersByTime(450);
    });
    expect(preview).toHaveBeenCalledWith(expect.stringContaining('{titulo}'));
    vi.useRealTimers();
  });
  it('salva nome, corpo e isDefault', () => {
    const onSave = vi.fn();
    render(
      <TemplateEditor
        onSave={onSave}
        preview={async () => ''}
        initial={{ id: 't', name: 'A', body: '{link}', isDefault: false }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Novo' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSave).toHaveBeenCalledWith({ name: 'Novo', body: '{link}', isDefault: false, kind: 'PRODUCT' });
  });
});

describe('TemplateEditor — cupom', () => {
  it('mostra as variáveis de cupom e não as de produto', () => {
    render(
      <TemplateEditor
        initial={{ id: 't', name: 'C', body: '{codigo}', isDefault: false, kind: 'COUPON' }}
        kind="COUPON"
        preview={async () => ''}
        onSave={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: '{codigo}' })).toBeDefined();
    expect(screen.queryByRole('button', { name: '{titulo}' })).toBeNull();
  });

  it('prévia usa o cupom escolhido', async () => {
    const preview = vi.fn(async () => 'PROMO10');
    render(
      <TemplateEditor
        initial={{ id: 't', name: 'C', body: '{codigo}', isDefault: false, kind: 'COUPON' }}
        kind="COUPON"
        coupons={[{ id: 'c1', code: 'PROMO10' }]}
        preview={preview}
        onSave={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Pré-visualizar com o cupom'), { target: { value: 'c1' } });
    await waitFor(() => expect(preview).toHaveBeenCalledWith('{codigo}', 'c1'));
  });

  it('onSave inclui o kind', () => {
    const onSave = vi.fn();
    render(
      <TemplateEditor
        initial={{ id: 't', name: 'C', body: '{codigo}', isDefault: false, kind: 'COUPON' }}
        kind="COUPON"
        preview={async () => ''}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onSave).toHaveBeenCalledWith({ name: 'C', body: '{codigo}', isDefault: false, kind: 'COUPON' });
  });
});

describe('TemplateEditor — {cta}', () => {
  it('lista {cta} e explica que depende da IA em Configurações > IA (produto)', () => {
    render(<TemplateEditor onSave={vi.fn()} preview={async () => ''} />);
    expect(screen.getByRole('button', { name: '{cta}' })).toBeTruthy();
    const link = screen.getByRole('link', { name: /configurações › ia/i });
    expect(link.getAttribute('href')).toBe('/config/ia');
    expect(screen.getByText(/só é gerado com a ia ativa/i)).toBeTruthy();
  });
  it('não mostra a dica no template de cupom', () => {
    render(
      <TemplateEditor
        initial={{ id: 't', name: 'C', body: '{codigo}', isDefault: false, kind: 'COUPON' }}
        kind="COUPON"
        preview={async () => ''}
        onSave={() => {}}
      />,
    );
    expect(screen.queryByText(/só é gerado com a ia ativa/i)).toBeNull();
  });
});
