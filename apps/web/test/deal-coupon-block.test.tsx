import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DealCouponBlock } from '@/components/deals/deal-coupon-block';

vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }));
import { copyToClipboard } from '@/lib/clipboard';

beforeEach(() => vi.clearAllMocks());

describe('DealCouponBlock', () => {
  it('mostra código e descrição e copia o código', async () => {
    render(
      <DealCouponBlock
        coupons={[
          {
            code: 'FONE10',
            description: 'Cupom desta oferta',
            discountLabel: 'R$ 10,00 OFF',
            expiresAt: null,
          },
        ]}
      />,
    );
    expect(screen.getByText('Cupom disponível')).toBeTruthy();
    expect(screen.getByText('FONE10')).toBeTruthy();
    expect(screen.getByText('Cupom desta oferta')).toBeTruthy();
    expect(screen.getByText('R$ 10,00 OFF')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /copiar cupom fone10/i }));
    expect(copyToClipboard).toHaveBeenCalledWith('FONE10');
    expect(await screen.findByText('Copiado!')).toBeTruthy();
  });

  it('sem cupom, não renderiza nada', () => {
    const { container } = render(<DealCouponBlock coupons={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
