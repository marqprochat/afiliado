'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface DispatchTarget {
  sessionId: string;
  templateId: string;
  groupJids: string[];
  telegramChatIds: string[];
  intervalMin: number;
}

export const EMPTY_TARGET: DispatchTarget = {
  sessionId: '',
  templateId: '',
  groupJids: [],
  telegramChatIds: [],
  intervalMin: 10,
};

const KEY = 'afilados:dispatch-target';

export function loadDispatchTarget(scope: string): Partial<DispatchTarget> {
  try {
    const raw = localStorage.getItem(`${KEY}:${scope}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<DispatchTarget>;
    return {
      ...(typeof parsed.sessionId === 'string' ? { sessionId: parsed.sessionId } : {}),
      ...(typeof parsed.templateId === 'string' ? { templateId: parsed.templateId } : {}),
      ...(Array.isArray(parsed.groupJids) ? { groupJids: parsed.groupJids.map(String) } : {}),
      ...(Array.isArray(parsed.telegramChatIds)
        ? { telegramChatIds: parsed.telegramChatIds.map(String) }
        : {}),
      ...(typeof parsed.intervalMin === 'number' && parsed.intervalMin >= 1
        ? { intervalMin: parsed.intervalMin }
        : {}),
    };
  } catch {
    return {};
  }
}

export function saveDispatchTarget(scope: string, target: DispatchTarget) {
  try {
    localStorage.setItem(`${KEY}:${scope}`, JSON.stringify(target));
  } catch {
    // armazenamento indisponível: a escolha só não fica lembrada
  }
}

/** Estado do destino com a última escolha lembrada por `scope` (ex.: 'cupons', 'manual'). */
export function useDispatchTarget(scope: string) {
  const [target, setTarget] = useState<DispatchTarget>(EMPTY_TARGET);
  const ref = useRef(target);

  useEffect(() => {
    const next = { ...ref.current, ...loadDispatchTarget(scope) };
    ref.current = next;
    setTarget(next);
  }, [scope]);

  const update = useCallback(
    (patch: Partial<DispatchTarget>) => {
      const next = { ...ref.current, ...patch };
      ref.current = next;
      setTarget(next);
      saveDispatchTarget(scope, next);
    },
    [scope],
  );

  return { target, update };
}
