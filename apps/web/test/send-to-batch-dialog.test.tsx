import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SendToBatchDialog } from '@/components/queue/send-to-batch-dialog';
import type { BatchSummary } from '@/lib/types';

describe('SendToBatchDialog', () => {
  const makeBatch = (
    id: string,
    name: string,
    status: BatchSummary['status'],
    total = 10,
    sent = 2,
    errors = 0,
  ): BatchSummary => ({
    id,
    name,
    status,
    intervalMin: 5,
    mediaMode: 'IMAGE',
    shuffled: false,
    groupJids: ['g1@g.us'],
    telegramChatIds: [],
    estimatedEndAt: null,
    createdAt: '2026-10-02T10:00:00.000Z',
    total,
    sent,
    errors,
  });

  const batches: BatchSummary[] = [
    makeBatch('b1', 'Lote Rodando', 'RUNNING', 10, 4, 0), // pending: 6
    makeBatch('b2', 'Lote Concluído', 'DONE', 5, 5, 0), // pending: 0
    makeBatch('b3', 'Lote Cancelado', 'CANCELLED', 8, 0, 0),
  ];

  it('no passo 1 lista apenas lotes elegíveis (sem CANCELLED) e mostra status e pendentes', () => {
    render(
      <SendToBatchDialog
        open={true}
        onOpenChange={vi.fn()}
        batches={batches}
        count={3}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('Lote Rodando')).toBeInTheDocument();
    expect(screen.getByText('Lote Concluído')).toBeInTheDocument();
    expect(screen.queryByText('Lote Cancelado')).not.toBeInTheDocument();

    expect(screen.getByText(/6 pendente\(s\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /avançar|continuar/i })).toBeDisabled();
  });

  it('mostra aviso quando não há lotes disponíveis', () => {
    render(
      <SendToBatchDialog
        open={true}
        onOpenChange={vi.fn()}
        batches={[makeBatch('b3', 'Lote Cancelado', 'CANCELLED')]}
        count={2}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(/Nenhum lote disponível/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /avançar|continuar/i })).toBeDisabled();
  });

  it('avança para o passo 2 ao selecionar um lote e mostra resumo', () => {
    render(
      <SendToBatchDialog
        open={true}
        onOpenChange={vi.fn()}
        batches={batches}
        count={3}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Lote Rodando/i));
    const nextBtn = screen.getByRole('button', { name: /avançar|continuar/i });
    expect(nextBtn).toBeEnabled();
    fireEvent.click(nextBtn);

    expect(screen.getByText(/Enviar 3 produto\(s\) para «Lote Rodando»/i)).toBeInTheDocument();
    // Lote RUNNING não deve ter aviso de reativação de lote concluído
    expect(screen.queryByText(/reativado e voltará a rodar/i)).not.toBeInTheDocument();
  });

  it('mostra aviso de reativação no passo 2 apenas para lotes com status DONE', () => {
    render(
      <SendToBatchDialog
        open={true}
        onOpenChange={vi.fn()}
        batches={batches}
        count={2}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Lote Concluído/i));
    fireEvent.click(screen.getByRole('button', { name: /avançar|continuar/i }));

    expect(screen.getByText(/Enviar 2 produto\(s\) para «Lote Concluído»/i)).toBeInTheDocument();
    expect(screen.getByText(/será reativado e voltará a rodar/i)).toBeInTheDocument();
  });

  it('usa posição padrão "fim da fila" (end) e permite escolher outra', () => {
    const onConfirm = vi.fn();
    render(
      <SendToBatchDialog
        open={true}
        onOpenChange={vi.fn()}
        batches={batches}
        count={4}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Lote Rodando/i));
    fireEvent.click(screen.getByRole('button', { name: /avançar|continuar/i }));

    const radioEnd = screen.getByRole('radio', { name: /fim da fila/i });
    expect(radioEnd).toBeChecked();

    const radioStart = screen.getByRole('radio', { name: /começo da fila|início da fila/i });
    fireEvent.click(radioStart);
    expect(radioStart).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /confirmar|enviar/i }));
    expect(onConfirm).toHaveBeenCalledWith({
      batchId: 'b1',
      position: 'start',
    });
  });

  it('permite escolher a opção embaralhar (shuffle)', () => {
    const onConfirm = vi.fn();
    render(
      <SendToBatchDialog
        open={true}
        onOpenChange={vi.fn()}
        batches={batches}
        count={2}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Lote Rodando/i));
    fireEvent.click(screen.getByRole('button', { name: /avançar|continuar/i }));

    const radioShuffle = screen.getByRole('radio', { name: /embaralhar/i });
    fireEvent.click(radioShuffle);
    expect(radioShuffle).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /confirmar|enviar/i }));
    expect(onConfirm).toHaveBeenCalledWith({
      batchId: 'b1',
      position: 'shuffle',
    });
  });

  it('botão Voltar no passo 2 retorna ao passo 1 preservando a escolha do lote', () => {
    render(
      <SendToBatchDialog
        open={true}
        onOpenChange={vi.fn()}
        batches={batches}
        count={3}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Lote Concluído/i));
    fireEvent.click(screen.getByRole('button', { name: /avançar|continuar/i }));

    expect(screen.getByText(/Enviar 3 produto\(s\) para «Lote Concluído»/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /voltar/i }));

    expect(screen.getByText('Lote Rodando')).toBeInTheDocument();
    expect(screen.getByLabelText(/Lote Concluído/i)).toBeChecked();
  });

  it('desabilita botão Confirmar quando submitting = true', () => {
    render(
      <SendToBatchDialog
        open={true}
        onOpenChange={vi.fn()}
        batches={batches}
        count={3}
        onConfirm={vi.fn()}
        submitting={true}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Lote Rodando/i));
    fireEvent.click(screen.getByRole('button', { name: /avançar|continuar/i }));

    expect(screen.getByRole('button', { name: /enviando|confirmar/i })).toBeDisabled();
  });
});
