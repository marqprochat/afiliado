import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
    expect(onSave).toHaveBeenCalledWith({ name: 'Novo', body: '{link}', isDefault: false });
  });
});
