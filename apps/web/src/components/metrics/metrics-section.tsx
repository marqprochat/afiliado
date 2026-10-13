'use client';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export interface PanelQuery<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

export function MetricsSection<T>({
  id,
  title,
  query,
  isEmpty,
  emptyMessage,
  notice,
  children,
}: {
  id: string;
  title: string;
  query: PanelQuery<T>;
  isEmpty: boolean;
  emptyMessage: string;
  notice?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {title}
      </h2>
      {notice}
      {query.isPending ? (
        <div data-testid={`${id}-skeleton`} aria-busy="true" className="space-y-2">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <span>Não foi possível carregar {title.toLowerCase()}.</span>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : isEmpty ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        children
      )}
    </section>
  );
}
