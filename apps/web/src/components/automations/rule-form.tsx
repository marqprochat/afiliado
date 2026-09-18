'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useSessions, useGroups, useTemplates } from '@/lib/queries';
import type { AutomationRule } from '@/lib/types';
import type { MarketplaceKind } from '@afilados/shared';

const ALL_MARKETS: { key: MarketplaceKind; label: string }[] = [
  { key: 'SHOPEE', label: 'Shopee' },
  { key: 'MERCADOLIVRE', label: 'Mercado Livre' },
  { key: 'AMAZON', label: 'Amazon' },
  { key: 'MAGALU', label: 'Magalu' },
];

export function RuleForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [marketplaces, setMarketplaces] = useState<MarketplaceKind[]>(['SHOPEE']);
  const [keywords, setKeywords] = useState('');
  const [blockedKeywords, setBlockedKeywords] = useState('');
  const [minDiscountPct, setMinDiscountPct] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [intervalMin, setIntervalMin] = useState(60);
  const [maxOffersPerDay, setMaxOffersPerDay] = useState(20);
  const [sessionId, setSessionId] = useState('');
  const [groupJids, setGroupJids] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState('');

  function toggleMarketplace(kind: MarketplaceKind) {
    setMarketplaces((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  }

  const { data: sessions } = useSessions();
  const { data: groups } = useGroups(sessionId || null);
  const { data: templates } = useTemplates();

  const create = useApiMutation(
    () =>
      apiFetch<AutomationRule>('/automations', {
        method: 'POST',
        json: {
          name,
          marketplaces,
          keywords: keywords
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
          blockedKeywords: blockedKeywords
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
          minDiscountPct: minDiscountPct ? Number(minDiscountPct) : undefined,
          maxPrice: maxPrice ? Number(maxPrice) : undefined,
          intervalMin,
          maxOffersPerDay,
          sessionId,
          groupJids,
          templateId,
        },
      }),
    { invalidate: [['automations']], success: 'Automação criada', onSuccess: onCreated },
  );

  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Nome da automação (ex: Eletrônicos até R$300)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <div className="flex gap-2">
        {ALL_MARKETS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => toggleMarketplace(m.key)}
            className={
              marketplaces.includes(m.key)
                ? 'rounded bg-orange-100 px-2 py-1 text-sm'
                : 'rounded bg-gray-100 px-2 py-1 text-sm text-gray-500'
            }
          >
            {m.label}
          </button>
        ))}
      </div>
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Keywords obrigatórias (separadas por vírgula)"
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        required
      />
      <input
        className="w-full rounded border px-3 py-2"
        placeholder="Keywords bloqueadas (opcional)"
        value={blockedKeywords}
        onChange={(e) => setBlockedKeywords(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          className="rounded border px-3 py-2"
          placeholder="Desconto mín. (%)"
          value={minDiscountPct}
          onChange={(e) => setMinDiscountPct(e.target.value)}
        />
        <input
          type="number"
          className="rounded border px-3 py-2"
          placeholder="Preço máx. (R$)"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">
          Intervalo (min)
          <input
            type="number"
            className="w-full rounded border px-3 py-2"
            value={intervalMin}
            onChange={(e) => setIntervalMin(Number(e.target.value))}
            min={5}
          />
        </label>
        <label className="text-sm">
          Limite/dia
          <input
            type="number"
            className="w-full rounded border px-3 py-2"
            value={maxOffersPerDay}
            onChange={(e) => setMaxOffersPerDay(Number(e.target.value))}
            min={1}
          />
        </label>
      </div>
      <select
        className="w-full rounded border px-3 py-2"
        value={sessionId}
        onChange={(e) => setSessionId(e.target.value)}
        required
      >
        <option value="">Sessão WhatsApp…</option>
        {sessions?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <select
        multiple
        className="w-full rounded border px-3 py-2"
        value={groupJids}
        onChange={(e) => setGroupJids(Array.from(e.target.selectedOptions).map((o) => o.value))}
        required
      >
        {groups?.map((g) => (
          <option key={g.jid} value={g.jid}>
            {g.name}
          </option>
        ))}
      </select>
      <select
        className="w-full rounded border px-3 py-2"
        value={templateId}
        onChange={(e) => setTemplateId(e.target.value)}
        required
      >
        <option value="">Template…</option>
        {templates?.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={create.isPending || marketplaces.length === 0}>
        Criar automação
      </Button>
    </form>
  );
}
