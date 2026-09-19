'use client';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useSessions, useGroups, useTelegramAllChats, useTemplates } from '@/lib/queries';
import type { AutomationRule } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { MarketplaceKind } from '@afilados/shared';

const ALL_MARKETS: { key: MarketplaceKind; label: string }[] = [
  { key: 'SHOPEE', label: 'Shopee' },
  { key: 'MERCADOLIVRE', label: 'Mercado Livre' },
  { key: 'AMAZON', label: 'Amazon' },
  { key: 'MAGALU', label: 'Magalu' },
];

const selectCls = 'mt-1 h-9 w-full rounded-md border border-input bg-surface-2 px-2 text-sm';

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
  const [groupJids, setGroupJids] = useState<Set<string>>(new Set());
  const [telegramChatIds, setTelegramChatIds] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState('');

  function toggleMarketplace(kind: MarketplaceKind) {
    setMarketplaces((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  }

  const { data: sessions } = useSessions();
  const { data: groups } = useGroups(sessionId || null);
  const { data: templates } = useTemplates();
  const { data: telegramChats } = useTelegramAllChats();
  const adminGroups = useMemo(() => groups?.filter((g) => g.botIsAdmin) ?? [], [groups]);

  const canCreate =
    !!name.trim() &&
    marketplaces.length > 0 &&
    !!keywords.trim() &&
    !!sessionId &&
    groupJids.size > 0 &&
    !!templateId;

  const create = useApiMutation(
    () =>
      apiFetch<AutomationRule>('/automations', {
        method: 'POST',
        json: {
          name: name.trim(),
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
          groupJids: [...groupJids],
          telegramChatIds: [...telegramChatIds],
          templateId,
        },
      }),
    { invalidate: [['automations']], success: 'Automação criada', onSuccess: onCreated },
  );

  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canCreate) create.mutate();
      }}
    >
      <h2 className="font-semibold">Nova automação</h2>

      <div>
        <Label htmlFor="rname">Nome da automação</Label>
        <Input
          id="rname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Eletrônicos até R$300"
          required
        />
      </div>

      <div>
        <Label>Marketplaces</Label>
        <div className="mt-1 flex flex-wrap gap-2">
          {ALL_MARKETS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => toggleMarketplace(m.key)}
              className={cn(
                'rounded-md border px-2.5 py-1 text-sm transition-colors',
                marketplaces.includes(m.key)
                  ? 'border-brand bg-brand text-white'
                  : 'border-border bg-surface-2 text-muted-foreground hover:text-foreground',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        {(marketplaces.includes('MERCADOLIVRE') || marketplaces.includes('MAGALU')) && (
          <p className="mt-1 text-xs text-muted-foreground">
            Mercado Livre e Magalu requerem sessão sincronizada em Marketplaces (extensão para ML,
            colagem manual para Magalu) — sem isso, a regra não encontrará produtos nesses
            marketplaces.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="rkeywords">Keywords obrigatórias</Label>
          <Input
            id="rkeywords"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="fone, carregador"
            required
          />
        </div>
        <div>
          <Label htmlFor="rblocked">Keywords bloqueadas</Label>
          <Input
            id="rblocked"
            value={blockedKeywords}
            onChange={(e) => setBlockedKeywords(e.target.value)}
            placeholder="usado, recondicionado"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="rdiscount">Desconto mín. (%)</Label>
          <Input
            id="rdiscount"
            type="number"
            value={minDiscountPct}
            onChange={(e) => setMinDiscountPct(e.target.value)}
            placeholder="sem mínimo"
          />
        </div>
        <div>
          <Label htmlFor="rmaxprice">Preço máx. (R$)</Label>
          <Input
            id="rmaxprice"
            type="number"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="sem máximo"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="rinterval">Intervalo (min)</Label>
          <Input
            id="rinterval"
            type="number"
            min={5}
            value={intervalMin}
            onChange={(e) => setIntervalMin(Number(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="rlimit">Limite/dia</Label>
          <Input
            id="rlimit"
            type="number"
            min={1}
            value={maxOffersPerDay}
            onChange={(e) => setMaxOffersPerDay(Number(e.target.value))}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="rsession">Sessão WhatsApp</Label>
        <select
          id="rsession"
          value={sessionId}
          onChange={(e) => {
            setSessionId(e.target.value);
            setGroupJids(new Set());
          }}
          className={selectCls}
          required
        >
          <option value="">Selecione…</option>
          {sessions?.map((s) => (
            <option key={s.id} value={s.id} disabled={s.status !== 'CONNECTED'}>
              {s.label} {s.status !== 'CONNECTED' ? `(${s.status})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label>Grupos de destino ({groupJids.size})</Label>
        <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-surface-2 p-2">
          {!sessionId && (
            <p className="text-xs text-muted-foreground">Selecione uma sessão WhatsApp primeiro.</p>
          )}
          {sessionId && groups?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhum grupo — sincronize em Configurações → WhatsApp.
            </p>
          )}
          {sessionId && (groups?.length ?? 0) > 0 && adminGroups.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhum grupo em que este número é administrador.
            </p>
          )}
          {adminGroups.map((g) => (
            <label key={g.jid} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer rounded border-border accent-brand"
                checked={groupJids.has(g.jid)}
                onChange={(e) => {
                  const next = new Set(groupJids);
                  if (e.target.checked) next.add(g.jid);
                  else next.delete(g.jid);
                  setGroupJids(next);
                }}
              />
              {g.name}
            </label>
          ))}
        </div>
      </div>

      {(telegramChats?.length ?? 0) > 0 && (
        <div>
          <Label>Chats do Telegram (opcional, {telegramChatIds.size} selecionado(s))</Label>
          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-surface-2 p-2">
            {telegramChats?.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer rounded border-border accent-brand"
                  checked={telegramChatIds.has(c.chatId)}
                  onChange={(e) => {
                    const next = new Set(telegramChatIds);
                    if (e.target.checked) next.add(c.chatId);
                    else next.delete(c.chatId);
                    setTelegramChatIds(next);
                  }}
                />
                {c.title}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="rtemplate">Template</Label>
        <select
          id="rtemplate"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className={selectCls}
          required
        >
          <option value="">Selecione…</option>
          {templates?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.isDefault ? ' (padrão)' : ''}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" className="w-full" disabled={!canCreate || create.isPending}>
        Criar automação
      </Button>
    </form>
  );
}
