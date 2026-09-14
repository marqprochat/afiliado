import { statusTone } from '@/lib/format';
import { cn } from '@/lib/utils';

const TONE = {
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  muted: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
  error: 'bg-red-500/15 text-red-300 border-red-500/40',
};

export function StatusPill({
  label,
  status,
  title,
}: {
  label: string;
  status: string;
  title?: string;
}) {
  const tone = statusTone(status);
  return (
    <span
      data-tone={tone}
      title={title ?? status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONE[tone],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
