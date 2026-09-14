import { isWithinOperatingWindow, nextWindowOpen, type OperatingWindow } from './window';

export interface BatchSchedule {
  runAt: Date[];
  estimatedEndAt: Date | null;
}

export function scheduleBatch(
  count: number,
  intervalMin: number,
  window: OperatingWindow,
  startAt: Date,
): BatchSchedule {
  const runAt: Date[] = [];
  let cursor = nextWindowOpen(startAt, window);
  for (let i = 0; i < count; i++) {
    if (!isWithinOperatingWindow(cursor, window)) cursor = nextWindowOpen(cursor, window);
    runAt.push(cursor);
    cursor = new Date(cursor.getTime() + intervalMin * 60_000);
  }
  return { runAt, estimatedEndAt: runAt.at(-1) ?? null };
}
