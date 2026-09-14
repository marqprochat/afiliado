import type { WebSocket } from 'ws';
import { REDIS_EVENTS_CHANNEL, type RealtimeEvent } from '@afilados/shared';
import { getRedis } from './redis';

export class EventHub {
  private sockets = new Map<string, Set<WebSocket>>();
  private sub = getRedis().duplicate();

  async start() {
    await this.sub.subscribe(REDIS_EVENTS_CHANNEL);
    this.sub.on('message', (_ch, raw) => {
      try {
        const { tenantId, event } = JSON.parse(raw) as { tenantId: string; event: RealtimeEvent };
        this.deliver(tenantId, event);
      } catch {
        /* payload inválido: ignora */
      }
    });
  }

  async stop() {
    await this.sub.quit();
  }

  addSocket(tenantId: string, ws: WebSocket) {
    if (!this.sockets.has(tenantId)) this.sockets.set(tenantId, new Set());
    this.sockets.get(tenantId)!.add(ws);
    ws.on('close', () => this.removeSocket(tenantId, ws));
  }

  removeSocket(tenantId: string, ws: WebSocket) {
    this.sockets.get(tenantId)?.delete(ws);
  }

  /** Publica no Redis (chega a todos os processos da API, inclusive este). */
  async publish(tenantId: string, event: RealtimeEvent) {
    await getRedis().publish(REDIS_EVENTS_CHANNEL, JSON.stringify({ tenantId, event }));
  }

  private deliver(tenantId: string, event: RealtimeEvent) {
    const data = JSON.stringify(event);
    for (const ws of this.sockets.get(tenantId) ?? []) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }
}
