import { DateTime } from 'luxon';

export interface OperatingWindow {
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  timezone: string; // IANA
  enabled: boolean;
}

function toMinutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

function localMinutes(now: Date, tz: string): number {
  const d = DateTime.fromJSDate(now, { zone: tz });
  return d.hour * 60 + d.minute + d.second / 60;
}

export function isWithinOperatingWindow(now: Date, w: OperatingWindow): boolean {
  if (!w.enabled) return true;
  const cur = localMinutes(now, w.timezone);
  const start = toMinutes(w.startTime);
  const end = toMinutes(w.endTime);
  if (start <= end) return cur >= start && cur < end;
  // cruza meia-noite
  return cur >= start || cur < end;
}

export function nextWindowOpen(now: Date, w: OperatingWindow): Date {
  if (isWithinOperatingWindow(now, w)) return now;
  const d = DateTime.fromJSDate(now, { zone: w.timezone });
  const [h = '0', m = '0'] = w.startTime.split(':');
  let open = d.set({ hour: Number(h), minute: Number(m), second: 0, millisecond: 0 });
  if (open <= d) open = open.plus({ days: 1 });
  return open.toJSDate();
}
