import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BatchForm } from '@/components/queue/batch-form';

const settings = {
  window: { startTime: '00:00', endTime: '23:59', timezone: 'America/Sao_Paulo', enabled: true },
  queueLimit: 500,
  globalRateLimitPerMin: 6,
  subIdPattern: 'x',
};
const sessions = [
  {
    id: 's1',
    label: 'Chip 1',
    phone: '55',
    status: 'CONNECTED' as const,
    lastQr: null,
    pairCode: null,
    lastSeenAt: null,
    createdAt: '',
  },
  {
    id: 's2',
    label: 'Chip 2',
    phone: null,
    status: 'DISCONNECTED' as const,
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
    name: 'Ofertas',
    kind: 'GROUP' as const,
    botIsAdmin: true,
    memberCount: 10,
  },
  {
    id: 'g2',
    jid: 'g2@newsletter',
    name: 'Canal',
    kind: 'CHANNEL' as const,
    botIsAdmin: true,
    memberCount: 0,
  },
];
const templates = [{ id: 't1', name: 'Padrão', body: '{link}', isDefault: true }];

describe('BatchForm', () => {
  it('cria lote com grupos marcados e mostra previsão', () => {
    const onCreate = vi.fn();
    render(
      <BatchForm
        sessions={sessions}
        groups={groups}
        templates={templates}
        settings={settings}
        selectedCount={3}
        onCreate={onCreate}
      />,
    );
    fireEvent.change(screen.getByLabelText(/nome do lote/i), { target: { value: 'Lote 1' } });
    fireEvent.click(screen.getByLabelText(/\[GRUPO\] Ofertas/));
    fireEvent.change(screen.getByLabelText(/intervalo/i), { target: { value: '10' } });
    expect(screen.getByText(/previsão de término/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /criar lote/i }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Lote 1',
        sessionId: 's1',
        templateId: 't1',
        groupJids: ['g1@g.us'],
        intervalMin: 10,
        mediaMode: 'IMAGE',
        shuffled: false,
      }),
    );
  });
  it('desabilita criar sem grupos ou sem itens', () => {
    render(
      <BatchForm
        sessions={sessions}
        groups={groups}
        templates={templates}
        settings={settings}
        selectedCount={0}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /criar lote/i })).toBeDisabled();
  });
});
