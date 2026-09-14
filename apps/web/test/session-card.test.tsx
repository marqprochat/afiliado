import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionCard } from '@/components/whatsapp/session-card';
import type { WaSession } from '@/lib/types';

const base: WaSession = {
  id: 's1',
  label: 'Chip 1',
  phone: null,
  status: 'DISCONNECTED',
  lastQr: null,
  pairCode: null,
  lastSeenAt: null,
  createdAt: '2026-09-14T00:00:00Z',
};
const noop = {
  onConnect: vi.fn(),
  onDisconnect: vi.fn(),
  onLogout: vi.fn(),
  onDelete: vi.fn(),
  onSync: vi.fn(),
};

describe('SessionCard', () => {
  it('desconectada: oferece conectar por QR e por código', () => {
    render(<SessionCard session={base} {...noop} />);
    fireEvent.click(screen.getByRole('button', { name: /conectar \(qr\)/i }));
    expect(noop.onConnect).toHaveBeenCalledWith('s1', { mode: 'qr' });
    expect(screen.getByRole('button', { name: /conectar \(código\)/i })).toBeInTheDocument();
  });
  it('NEEDS_QR renderiza o QR', () => {
    render(<SessionCard session={{ ...base, status: 'NEEDS_QR', lastQr: '2@abc' }} {...noop} />);
    expect(screen.getByTestId('qr-code')).toBeInTheDocument();
  });
  it('pair code em destaque', () => {
    render(
      <SessionCard session={{ ...base, status: 'NEEDS_QR', pairCode: 'ABCD-1234' }} {...noop} />,
    );
    expect(screen.getByText('ABCD-1234')).toBeInTheDocument();
  });
  it('conectada: sincronizar, desconectar, sair', () => {
    render(
      <SessionCard session={{ ...base, status: 'CONNECTED', phone: '5511999999999' }} {...noop} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /sincronizar grupos/i }));
    expect(noop.onSync).toHaveBeenCalledWith('s1');
    expect(screen.getByText(/5511999999999/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /desconectar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sair da conta/i })).toBeInTheDocument();
  });
});
