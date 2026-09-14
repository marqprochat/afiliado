import type { Job } from 'bullmq';
import type { WaCommandJob } from '@afilados/shared';
import type { WaSessionManager } from '../wa/session-manager';

export function processWaCommand(manager: WaSessionManager) {
  return async (job: Job<WaCommandJob>) => manager.handle(job);
}
