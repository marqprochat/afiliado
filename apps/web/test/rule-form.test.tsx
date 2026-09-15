import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MirrorRuleForm } from '@/components/mirror/rule-form';

const sessions = [
  {
    id: 's1',
    label: 'Chip 1',
    phone: '5511999999999',
    status: 'CONNECTED' as const,
    lastQr: null,
    pairCode: null,
    lastSeenAt: null,
    createdAt: '',
  },
];

const groups = [
  {
    id: 'g1',
    jid: 'g1@g.us',
    name: 'Origem Grupo',
    kind: 'GROUP' as const,
    botIsAdmin: false,
    memberCount: 50,
  },
  {
    id: 'g2',
    jid: 'g2@g.us',
    name: 'Destino Grupo',
    kind: 'GROUP' as const,
    botIsAdmin: true,
    memberCount: 200,
  },
];

const templates = [{ id: 't1', name: 'Padrão', body: '{{link}}', isDefault: true }];

describe('MirrorRuleForm', () => {
  it('submete regra preenchida com sucesso', async () => {
    const onSubmit = vi.fn(async () => {});
    const onSessionChange = vi.fn();
    render(
      <MirrorRuleForm
        sessions={sessions}
        groups={groups}
        templates={templates}
        selectedSessionId="s1"
        onSessionChange={onSessionChange}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText(/nome do monitoramento/i), {
      target: { value: 'Espelhar Promoções' },
    });

    // Marcar Origem g1 e Destino g2
    const checkboxes = screen.getAllByRole('checkbox');
    // checkbox 0 = g1 origem, checkbox 1 = g2 origem, checkbox 2 = g1 destino, checkbox 3 = g2 destino
    fireEvent.click(checkboxes[0]!); // g1 como origem
    fireEvent.click(checkboxes[3]!); // g2 como destino

    const submitBtn = screen.getByRole('button', { name: /adicionar monitoramento/i });
    expect(submitBtn).not.toBeDisabled();

    fireEvent.click(submitBtn);

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Espelhar Promoções',
      sessionId: 's1',
      sourceJids: ['g1@g.us'],
      targetJids: ['g2@g.us'],
      mode: 'CLONE',
      mediaMode: 'PREVIEW',
      templateId: undefined,
      dedupHours: 12,
      enabled: true,
    });
  });

  it('desabilita envio se não houver origens ou destinos', () => {
    render(
      <MirrorRuleForm
        sessions={sessions}
        groups={groups}
        templates={templates}
        selectedSessionId="s1"
        onSessionChange={vi.fn()}
        onSubmit={vi.fn(async () => {})}
      />,
    );
    expect(screen.getByRole('button', { name: /adicionar monitoramento/i })).toBeDisabled();
  });
});
