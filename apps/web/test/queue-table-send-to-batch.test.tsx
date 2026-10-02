import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueueTable } from '@/components/queue/queue-table';
import type { QueueResponse } from '@/lib/types';

describe('QueueTable - Enviar para lote', () => {
  const makeQueueData = (selected = false): QueueResponse => ({
    count: 2,
    limit: 500,
    items: [
      {
        id: 'q1',
        productId: 'p1',
        selected,
        status: 'PENDING',
        addedAt: '2026-10-02T10:00:00.000Z',
        product: {
          id: 'p1',
          source: 'SHOPEE',
          externalId: 'ext-1',
          title: 'Produto 1',
          price: 50,
          originalPrice: null,
          discountPct: null,
          salesCount: null,
          commissionPct: null,
          images: [],
          shipping: 'UNKNOWN',
          flashSaleEndsAt: null,
          couponCode: null,
          originalUrl: 'https://shopee.com.br/1',
          shopId: null,
          shopName: null,
        },
      },
    ],
  });

  it('renderiza o botão "Trazer selecionados para lote" desabilitado quando nada está selecionado', () => {
    const onSendToBatch = vi.fn();
    render(
      <QueueTable
        data={makeQueueData(false)}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onClearSent={vi.fn()}
        onSendToBatch={onSendToBatch}
      />,
    );

    const btn = screen.getByRole('button', { name: /trazer selecionados para lote/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it('habilita o botão quando há itens pendentes selecionados e chama onSendToBatch ao clicar', () => {
    const onSendToBatch = vi.fn();
    render(
      <QueueTable
        data={makeQueueData(true)}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onClearSent={vi.fn()}
        onSendToBatch={onSendToBatch}
      />,
    );

    const btn = screen.getByRole('button', { name: /trazer selecionados para lote/i });
    expect(btn).toBeEnabled();

    fireEvent.click(btn);
    expect(onSendToBatch).toHaveBeenCalledTimes(1);
  });
});
