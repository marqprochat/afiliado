'use client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import type {
  BatchDetail,
  BatchSummary,
  MarketplaceConnection,
  Me,
  Overview,
  QueueResponse,
  Settings,
  Template,
  WaGroup,
  WaSession,
} from './types';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/me') });
export const useOverview = () =>
  useQuery({
    queryKey: ['overview'],
    queryFn: () => apiFetch<Overview>('/overview'),
    refetchInterval: 15_000,
  });
export const useSettings = () =>
  useQuery({ queryKey: ['settings'], queryFn: () => apiFetch<Settings>('/settings') });
export const useSessions = () =>
  useQuery({ queryKey: ['wa', 'sessions'], queryFn: () => apiFetch<WaSession[]>('/wa/sessions') });
export const useGroups = (sessionId: string | null) =>
  useQuery({
    queryKey: ['wa', 'groups', sessionId],
    enabled: !!sessionId,
    queryFn: () => apiFetch<WaGroup[]>(`/wa/sessions/${sessionId}/groups`),
  });
export const useMarketplaces = () =>
  useQuery({
    queryKey: ['marketplaces'],
    queryFn: () => apiFetch<MarketplaceConnection[]>('/marketplaces'),
  });
export const useQueue = () =>
  useQuery({ queryKey: ['queue'], queryFn: () => apiFetch<QueueResponse>('/queue') });
export const useTemplates = () =>
  useQuery({ queryKey: ['templates'], queryFn: () => apiFetch<Template[]>('/templates') });
export const useBatches = () =>
  useQuery({
    queryKey: ['batches'],
    queryFn: () => apiFetch<BatchSummary[]>('/batches'),
    refetchInterval: 10_000,
  });
export const useBatch = (id: string | null) =>
  useQuery({
    queryKey: ['batches', id],
    enabled: !!id,
    queryFn: () => apiFetch<BatchDetail>(`/batches/${id}`),
  });
