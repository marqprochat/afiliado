import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AutomationSection } from '@/components/metrics/automation-section';
import { ClicksSection } from '@/components/metrics/clicks-section';
import { ProductsSection } from '@/components/metrics/products-section';
import { automationFixture, clicksFixture, productsFixture } from './metrics-fixtures';

const ok = <T,>(data: T) => ({ data, isPending: false, isError: false, refetch: vi.fn() });

describe('ProductsSection', () => {
  it('top produtos e divisão por marketplace', () => {
    render(<ProductsSection query={ok(productsFixture)} />);
    expect(screen.getByText('Fone Bluetooth')).toBeInTheDocument();
    expect(screen.getByText('Shopee: 5')).toBeInTheDocument();
    expect(screen.getByText('Amazon: 2')).toBeInTheDocument();
  });
  it('estado vazio', () => {
    render(<ProductsSection query={ok({ top: [], byMarketplace: [] })} />);
    expect(screen.getByText('Nenhum produto enviado no período.')).toBeInTheDocument();
  });
});

describe('ClicksSection', () => {
  it('total e detalhamento por link', () => {
    render(<ClicksSection query={ok(clicksFixture)} />);
    expect(screen.getByText('7 cliques no período')).toBeInTheDocument();
    expect(screen.getByText('/g/ofertas')).toBeInTheDocument();
    expect(screen.getByText('Ofertas')).toBeInTheDocument();
  });
  it('estado vazio', () => {
    render(<ClicksSection query={ok({ total: 0, daily: [], byLink: [] })} />);
    expect(screen.getByText('Nenhum clique nos links de grupos no período.')).toBeInTheDocument();
  });
});

describe('AutomationSection', () => {
  it('resumo de espelhamento, automações e cupons', () => {
    render(<AutomationSection query={ok(automationFixture)} />);
    expect(
      within(screen.getByRole('group', { name: 'Espelhamento' })).getByTestId('auto-mirrored'),
    ).toHaveTextContent('8');
    expect(
      within(screen.getByRole('group', { name: 'Automações' })).getByTestId('auto-dispatched'),
    ).toHaveTextContent('5');
    expect(
      within(screen.getByRole('group', { name: 'Cupons' })).getByTestId('auto-propagated'),
    ).toHaveTextContent('6');
  });
  it('estado vazio', () => {
    render(
      <AutomationSection
        query={ok({
          mirror: { captured: 0, mirrored: 0, discarded: 0, errors: 0 },
          automation: { discovered: 0, dispatched: 0, skipped: 0, errors: 0 },
          coupons: { validated: 0, propagated: 0 },
          daily: [],
        })}
      />,
    );
    expect(
      screen.getByText('Nenhuma atividade de espelhamento, automação ou cupons no período.'),
    ).toBeInTheDocument();
  });
});
