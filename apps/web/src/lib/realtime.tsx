'use client';
import { createContext, useContext, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeEvent } from '@afilados/shared';
import { WS_URL } from './api';

type Handler = (e: RealtimeEvent) => void;

export function createRealtimeClient(
  url: string,
  onEvent: Handler,
  WS: typeof WebSocket = WebSocket,
) {
  let stopped = false;
  let attempt = 0;
  let ws: WebSocket | null = null;
  const open = () => {
    if (stopped) return;
    ws = new WS(url);
    ws.onopen = () => {
      attempt = 0;
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(String(m.data)) as RealtimeEvent);
      } catch {
        /* mensagem inválida: ignora */
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      const delay = Math.min(30_000, 1_000 * 2 ** attempt++);
      setTimeout(open, delay);
    };
  };
  open();
  return {
    stop() {
      stopped = true;
      ws?.close();
    },
  };
}

const Ctx = createContext<{ subscribe: (h: Handler) => () => void } | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const handlers = useRef(new Set<Handler>());
  useEffect(() => {
    const client = createRealtimeClient(WS_URL, (e) => {
      if (e.type.startsWith('wa.')) {
        void qc.invalidateQueries({ queryKey: ['wa'] });
        void qc.invalidateQueries({ queryKey: ['overview'] });
      }
      if (e.type.startsWith('batch.')) {
        void qc.invalidateQueries({ queryKey: ['batches'] });
        void qc.invalidateQueries({ queryKey: ['queue'] });
        void qc.invalidateQueries({ queryKey: ['overview'] });
      }
      handlers.current.forEach((h) => h(e));
    });
    return () => client.stop();
  }, [qc]);
  const subscribe = (h: Handler) => {
    handlers.current.add(h);
    return () => {
      handlers.current.delete(h);
    };
  };
  return <Ctx.Provider value={{ subscribe }}>{children}</Ctx.Provider>;
}

export function useRealtime(handler: Handler) {
  const ctx = useContext(Ctx);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => ctx?.subscribe((e) => ref.current(e)), [ctx]);
}
