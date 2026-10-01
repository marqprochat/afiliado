'use client';
import { useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import type { DispatchTarget } from '@/lib/dispatch-target';
import { useGroups, useSessions, useTelegramAllChats, useTemplates } from '@/lib/queries';

const PREFIX = { GROUP: '[GRUPO]', COMMUNITY: '[COMUNIDADE]', CHANNEL: '[CANAL]' } as const;
const selectCls = 'mt-1 h-9 w-full rounded-md border border-input bg-surface-2 px-2 text-sm';

function toggle(list: string[], value: string, on: boolean) {
  const set = new Set(list);
  if (on) set.add(value);
  else set.delete(value);
  return [...set];
}

export function DispatchTargetPicker({
  value,
  onChange,
  templateKind,
}: {
  value: DispatchTarget;
  onChange: (patch: Partial<DispatchTarget>) => void;
  /** `null` esconde o seletor de template (envio manual). */
  templateKind: 'COUPON' | null;
}) {
  const { data: sessions } = useSessions();
  const { data: groups } = useGroups(value.sessionId || null);
  const { data: chats } = useTelegramAllChats();
  const { data: templates } = useTemplates(templateKind ?? undefined);

  const connected = useMemo(
    () => (sessions ?? []).filter((s) => s.status === 'CONNECTED'),
    [sessions],
  );
  const adminGroups = useMemo(() => (groups ?? []).filter((g) => g.botIsAdmin), [groups]);

  // Sessão padrão: a 1ª conectada (ou a lembrada, se ainda existir e estiver conectada).
  useEffect(() => {
    if (!sessions) return;
    if (!connected.some((s) => s.id === value.sessionId) && connected[0]) {
      onChange({ sessionId: connected[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, value.sessionId]);

  // Template padrão: o marcado como padrão do tipo, senão o 1º.
  useEffect(() => {
    if (!templateKind || !templates) return;
    if (!templates.some((t) => t.id === value.templateId) && templates.length > 0) {
      const pick = templates.find((t) => t.isDefault) ?? templates[0]!;
      onChange({ templateId: pick.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, templateKind, value.templateId]);

  // Remove da seleção grupos que não existem mais na sessão.
  useEffect(() => {
    if (!groups) return;
    const known = new Set(groups.map((g) => g.jid));
    const pruned = value.groupJids.filter((j) => known.has(j));
    if (pruned.length !== value.groupJids.length) onChange({ groupJids: pruned });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="dt-session">Sessão WhatsApp</Label>
          <select
            id="dt-session"
            value={value.sessionId}
            onChange={(e) => onChange({ sessionId: e.target.value, groupJids: [] })}
            className={selectCls}
          >
            {(sessions ?? []).map((s) => (
              <option key={s.id} value={s.id} disabled={s.status !== 'CONNECTED'}>
                {s.status === 'CONNECTED' ? s.label : `${s.label} (${s.status})`}
              </option>
            ))}
          </select>
        </div>
        {templateKind && (
          <div>
            <Label htmlFor="dt-template">Template</Label>
            <select
              id="dt-template"
              value={value.templateId}
              onChange={(e) => onChange({ templateId: e.target.value })}
              className={selectCls}
            >
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <Label>Grupos ({value.groupJids.length})</Label>
        <div className="mt-1 max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {adminGroups.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {(groups ?? []).length === 0
                ? 'Nenhum grupo — sincronize em Configurações → WhatsApp.'
                : 'Nenhum grupo em que este número é administrador.'}
            </p>
          )}
          {adminGroups.map((g) => (
            <label key={g.jid} className="flex items-center gap-2 text-sm">
              <NativeCheckbox
                checked={value.groupJids.includes(g.jid)}
                onChange={(e) =>
                  onChange({ groupJids: toggle(value.groupJids, g.jid, e.target.checked) })
                }
                aria-label={`${PREFIX[g.kind]} ${g.name}`}
              />
              <span className="text-xs text-muted-foreground">{PREFIX[g.kind]}</span> {g.name}
            </label>
          ))}
        </div>
      </div>

      {(chats?.length ?? 0) > 0 && (
        <div>
          <Label>Chats do Telegram (opcional, {value.telegramChatIds.length})</Label>
          <div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {chats?.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <NativeCheckbox
                  checked={value.telegramChatIds.includes(c.chatId)}
                  onChange={(e) =>
                    onChange({
                      telegramChatIds: toggle(value.telegramChatIds, c.chatId, e.target.checked),
                    })
                  }
                  aria-label={c.title}
                />
                {c.title}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-[220px]">
        <Label htmlFor="dt-interval">Intervalo na fila (min)</Label>
        <Input
          id="dt-interval"
          type="number"
          min={1}
          value={value.intervalMin}
          onChange={(e) => onChange({ intervalMin: Math.max(1, Number(e.target.value) || 1) })}
        />
      </div>
    </div>
  );
}
