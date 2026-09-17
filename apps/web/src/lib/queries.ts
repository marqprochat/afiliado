'use client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import type {
  AutomationQueueItem,
  AutomationRule,
  BatchDetail,
  BatchSummary,
  MarketplaceConnection,
  Me,
  MirrorLog,
  MirrorRule,
  MirrorStats,
  Overview,
  QueueResponse,
  Settings,
  Template,
  WaGroup,
  WaSession,
  ApiToken,
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
export const useMirrorRules = () =>
  useQuery({
    queryKey: ['mirror', 'rules'],
    queryFn: () => apiFetch<MirrorRule[]>('/mirror/rules'),
  });
export const useMirrorLogs = (params?: { ruleId?: string; status?: string; limit?: number }) => {
  const qs = new URLSearchParams();
  if (params?.ruleId) qs.set('ruleId', params.ruleId);
  if (params?.status) qs.set('status', params.status);
  if (params?.limit) qs.set('limit', String(params.limit));
  const queryStr = qs.toString();
  return useQuery({
    queryKey: ['mirror', 'logs', params],
    queryFn: () => apiFetch<MirrorLog[]>(`/mirror/logs${queryStr ? `?${queryStr}` : ''}`),
    refetchInterval: 10_000,
  });
};
export const useMirrorStats = () =>
  useQuery({
    queryKey: ['mirror', 'stats'],
    queryFn: () => apiFetch<MirrorStats>('/mirror/stats'),
    refetchInterval: 15_000,
  });

export const useApiTokens = () =>
  useQuery({
    queryKey: ['api-tokens'],
    queryFn: async () => {
      const res = await apiFetch<{ tokens: ApiToken[] }>('/api-tokens');
      return res.tokens;
    },
  });

export const useAutomationRules = () =>
  useQuery({
    queryKey: ['automations'],
    queryFn: () => apiFetch<AutomationRule[]>('/automations'),
    refetchInterval: 15_000,
  });
export const useAutomationQueue = (ruleId: string | null) =>
  useQuery({
    queryKey: ['automations', ruleId, 'queue'],
    enabled: !!ruleId,
    queryFn: () => apiFetch<AutomationQueueItem[]>(`/automations/${ruleId}/queue`),
  });
