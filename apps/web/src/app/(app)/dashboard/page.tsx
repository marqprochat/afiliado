import { Suspense } from 'react';
import { DashboardClient } from '@/components/metrics/dashboard-client';

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
      <DashboardClient />
    </Suspense>
  );
}
