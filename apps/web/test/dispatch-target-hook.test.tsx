import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, renderHook, act } from '@testing-library/react';
import { EMPTY_TARGET, useDispatchTarget, type DispatchTarget } from '@/lib/dispatch-target';

const KEY = 'afilados:dispatch-target:cupons';

function Child({ update }: { update: (p: Partial<DispatchTarget>) => void }) {
  // efeitos de filho rodam antes dos do pai: simula o picker com cache quente
  useEffect(() => {
    update({ sessionId: 's2' });
  }, [update]);
  return null;
}
function Parent() {
  const { target, update } = useDispatchTarget('cupons');
  return (
    <>
      <Child update={update} />
      <span data-testid="t">{JSON.stringify(target)}</span>
    </>
  );
}

describe('useDispatchTarget', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('update chamado antes do load preserva o valor lembrado', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ sessionId: 's1', templateId: 'tc', groupJids: ['g1@g.us'], telegramChatIds: ['-1'], intervalMin: 25 }),
    );
    const { getByTestId } = render(<Parent />);
    const shown = JSON.parse(getByTestId('t').textContent!);
    expect(shown).toEqual({ sessionId: 's2', templateId: 'tc', groupJids: ['g1@g.us'], telegramChatIds: ['-1'], intervalMin: 25 });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(shown);
  });

  it('com storage vazio persiste o patch e um novo mount lê de volta', () => {
    const first = renderHook(() => useDispatchTarget('cupons'));
    act(() => first.result.current.update({ intervalMin: 30, groupJids: ['a@g.us'] }));
    first.unmount();
    const second = renderHook(() => useDispatchTarget('cupons'));
    expect(second.result.current.target).toEqual({ ...EMPTY_TARGET, intervalMin: 30, groupJids: ['a@g.us'] });
  });

  it('getItem lançando erro não quebra e devolve EMPTY_TARGET', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useDispatchTarget('cupons'));
    expect(result.current.target).toEqual(EMPTY_TARGET);
  });
});
