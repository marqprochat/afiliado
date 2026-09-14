import { describe, it, expect, vi } from 'vitest';
import { createRealtimeClient } from '@/lib/realtime';

class FakeWS {
  static instances: FakeWS[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe('createRealtimeClient', () => {
  it('entrega eventos parseados e reconecta ao fechar', () => {
    vi.useFakeTimers();
    FakeWS.instances = [];
    const onEvent = vi.fn();
    const client = createRealtimeClient('ws://x', onEvent, FakeWS as unknown as typeof WebSocket);
    expect(FakeWS.instances).toHaveLength(1);
    const ws = FakeWS.instances[0]!;
    ws.onopen?.();
    ws.onmessage?.({
      data: JSON.stringify({ type: 'wa.status', sessionId: 's', status: 'CONNECTED' }),
    });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'wa.status',
      sessionId: 's',
      status: 'CONNECTED',
    });
    ws.onmessage?.({ data: 'lixo' });
    expect(onEvent).toHaveBeenCalledTimes(1);
    ws.onclose?.();
    vi.advanceTimersByTime(1000);
    expect(FakeWS.instances).toHaveLength(2);
    client.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.instances).toHaveLength(2);
    vi.useRealTimers();
  });
});
