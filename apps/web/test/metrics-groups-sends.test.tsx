import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GroupsSection } from '@/components/metrics/groups-section';
import { SendsSection } from '@/components/metrics/sends-section';
import { groupsFixture, sendsFixture } from './metrics-fixtures';

const ok = <T,>(data: T) => ({ data, isPending: false, isError: false, refetch: vi.fn() });
const firstColumn = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]!.textContent);

describe('GroupsSection', () => {
  it('avisa a data inicial da coleta', () => {
    render(<GroupsSection query={ok(groupsFixture)} />);
    expect(
      screen.getByText('Histórico de movimentação disponível a partir de 01/10/2026'),
    ).toBeInTheDocument();
    expect(screen.getByText('Evolução de membros')).toBeInTheDocument();
    expect(screen.getByText('Entradas x saídas por dia')).toBeInTheDocument();
  });

  it('tabela ordenável por coluna', () => {
    render(<GroupsSection query={ok(groupsFixture)} />);
    expect(firstColumn()).toEqual(['Alfa', 'Beta']);
    fireEvent.click(screen.getByRole('button', { name: 'Saídas' }));
    expect(firstColumn()).toEqual(['Beta', 'Alfa']);
    expect(screen.getByRole('columnheader', { name: 'Saídas' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Saídas' }));
    expect(firstColumn()).toEqual(['Alfa', 'Beta']);
  });

  it('estado vazio e coleta ainda não iniciada', () => {
    render(
      <GroupsSection
        query={ok({
          trackingSince: null,
          totals: { members: 0, joins: 0, leaves: 0, net: 0 },
          series: [],
          groups: [],
        })}
      />,
    );
    expect(
      screen.getByText('A coleta do histórico de movimentação ainda não começou.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Nenhum grupo monitorado com movimentação no período/),
    ).toBeInTheDocument();
  });
});

describe('SendsSection', () => {
  it('resumo, heatmap e principais erros', () => {
    render(<SendsSection query={ok(sendsFixture)} />);
    expect(screen.getByText(/80% de sucesso/)).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(168);
    expect(screen.getByLabelText('Qua 23h: 2 envio(s)')).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
    expect(screen.getByText('Envios por dia')).toBeInTheDocument();
    expect(screen.getByText('Envios por hora do dia')).toBeInTheDocument();
  });

  it('estado vazio', () => {
    render(
      <SendsSection
        query={ok({ ...sendsFixture, totals: { total: 0, sent: 0, failed: 0, successRate: 0 } })}
      />,
    );
    expect(screen.getByText('Nenhum envio no período.')).toBeInTheDocument();
  });
});
