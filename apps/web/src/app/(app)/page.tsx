'use client';
import { useOverview } from '@/lib/queries';

export default function OverviewPage() {
  const { data } = useOverview();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Visão Geral</h1>
      <pre className="mt-4 text-xs text-muted-foreground">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
