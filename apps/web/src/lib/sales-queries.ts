'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AffiliateSaleStatus,
  AwinWebhookInfo,
  SalesList,
  SalesSummary,
} from '@afilados/shared';
import { apiFetch } from './api';

export interface SalesRange {
  from: string;
  to: string;
}

const STALE = 60_000;

/** Últimos `days` dias até agora (ISO). */
export function lastDaysRange(days: number, now: Date = new Date()): SalesRange {
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: now.toISOString() };
}

export function useSalesSummary(range: SalesRange) {
  const qs = new URLSearchParams({ from: range.from, to: range.to }).toString();
  return useQuery({
    queryKey: ['sales', 'summary', qs],
    queryFn: () => apiFetch<SalesSummary>(`/sales/summary?${qs}`),
    staleTime: STALE,
  });
}

export function useSalesList(range: SalesRange, page: number, status?: AffiliateSaleStatus) {
  const params = new URLSearchParams({ from: range.from, to: range.to, page: String(page) });
  if (status) params.set('status', status);
  const qs = params.toString();
  return useQuery({
    queryKey: ['sales', 'list', qs],
    queryFn: () => apiFetch<SalesList>(`/sales?${qs}`),
    staleTime: STALE,
  });
}

export function useAwinWebhook() {
  return useQuery({
    queryKey: ['sales', 'awin-webhook'],
    queryFn: () => apiFetch<AwinWebhookInfo>('/sales/awin-webhook'),
    staleTime: Infinity,
    retry: false,
  });
}

export function useRotateAwinWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<AwinWebhookInfo>('/sales/awin-webhook/rotate', { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(['sales', 'awin-webhook'], data),
  });
}
