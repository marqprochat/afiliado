import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/components/ui/select', () => import('./select-mock'));
import { FilterBar } from '@/components/metrics/filter-bar';
import { KpiCards } from '@/components/metrics/kpi-cards';
import { MetricsSection } from '@/components/metrics/metrics-section';
import { parseMetricsFilters } from '@/lib/metrics-filters';
import {
  formatDateBR,
  formatDayLabel,
  formatInt,
  formatPct,
  formatSigned,
} from '@/lib/metrics-format';
import { overviewFixture } from './metrics-fixtures';

const ok = <T,>(data: T) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const pending = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };

describe('formatação', () => {
  it('usa o padrão pt-BR', () => {
    expect(formatInt(1234)).toBe('1.234');
    expect(formatSigned(30)).toBe('+30');
    expect(formatSigned(-2)).toBe('-2');
    expect(formatPct(40)).toBe('40%');
    expect(formatPct(33.3)).toBe('33,3%');
    expect(formatDayLabel('2026-10-13')).toBe('13/10');
    expect(formatDateBR('2026-10-01T12:00:00.000Z')).toBe('01/10/2026');
  });
});

describe('MetricsSection', () => {
  it('mostra esqueleto enquanto carrega', () => {
    render(
      <MetricsSection id="x" title="Envios" query={pending} isEmpty={false} emptyMessage="vazio">
        <p>conteúdo</p>
      </MetricsSection>,
    );
    expect(screen.getByTestId('x-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
  });

  it('mostra card de erro com Tentar novamente', () => {
    const refetch = vi.fn();
    render(
      <MetricsSection
        id="x"
        title="Envios"
        query={{ data: undefined, isPending: false, isError: true, refetch }}
        isEmpty={false}
        emptyMessage="vazio"
      >
        <p>conteúdo</p>
      </MetricsSection>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar envios.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Tentar novamente' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('mostra o estado vazio explicativo', () => {
    render(
      <MetricsSection
        id="x"
        title="Envios"
        query={ok({})}
        isEmpty
        emptyMessage="Nenhum envio no período."
      >
        <p>conteúdo</p>
      </MetricsSection>,
    );
    expect(screen.getByText('Nenhum envio no período.')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
  });

  it('mostra o conteúdo com dados', () => {
    render(
      <MetricsSection id="x" title="Envios" query={ok({})} isEmpty={false} emptyMessage="vazio">
        <p>conteúdo</p>
      </MetricsSection>,
    );
    expect(screen.getByRole('heading', { name: 'Envios' })).toBeInTheDocument();
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });
});

describe('KpiCards', () => {
  it('renderiza os 7 KPIs com variação', () => {
    render(<KpiCards query={ok(overviewFixture)} />);
    expect(screen.getByTestId('kpi-members')).toHaveTextContent('1.234');
    expect(screen.getByTestId('kpi-net')).toHaveTextContent('+30');
    expect(screen.getByTestId('kpi-successRate')).toHaveTextContent('95,5%');
    for (const label of [
      'Membros totais',
      'Entradas',
      'Saídas',
      'Saldo líquido',
      'Total de envios',
      'Taxa de sucesso',
      'Cliques em links',
    ]) {
      expect(screen.getByRole('group', { name: label })).toBeInTheDocument();
    }
    const joins = within(screen.getByRole('group', { name: 'Entradas' }));
    expect(joins.getByText(/\+100%/)).toHaveAttribute('data-tone', 'good');
    const leaves = within(screen.getByRole('group', { name: 'Saídas' }));
    expect(leaves.getByText(/\+100%/)).toHaveAttribute('data-tone', 'bad');
    const clicks = within(screen.getByRole('group', { name: 'Cliques em links' }));
    expect(clicks.getByText('sem base anterior')).toBeInTheDocument();
  });
});

describe('FilterBar', () => {
  const filters = parseMetricsFilters(new URLSearchParams(''), new Date('2026-10-13T15:00:00Z'));
  const setup = () => {
    const handlers = { onPeriod: vi.fn(), onCustom: vi.fn(), onGroup: vi.fn() };
    render(
      <FilterBar filters={filters} groupOptions={overviewFixture.groupOptions} {...handlers} />,
    );
    return handlers;
  };

  it('marca o período atual e troca de período', () => {
    const h = setup();
    expect(screen.getByRole('button', { name: '30 dias' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));
    expect(h.onPeriod).toHaveBeenCalledWith('7d');
  });

  it('filtra por grupo e volta para todos', () => {
    const h = setup();
    expect(screen.getByRole('combobox', { name: 'Grupo' })).toHaveTextContent('Todos os grupos');
    fireEvent.click(screen.getByRole('option', { name: 'Grupo 1' }));
    expect(h.onGroup).toHaveBeenLastCalledWith('g1@g.us');
    fireEvent.click(screen.getByRole('option', { name: 'Todos os grupos' }));
    expect(h.onGroup).toHaveBeenLastCalledWith(null);
  });

  it('aplica intervalo personalizado', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Personalizado' }));
    fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-10-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(h.onCustom).toHaveBeenCalledWith('2026-10-01', '2026-10-10');
  });
});
