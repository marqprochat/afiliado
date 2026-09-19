'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { useApiMutation } from '@/lib/mutations';
import { useTelegramBots, useTelegramChats } from '@/lib/queries';
import type { TelegramBot } from '@/lib/types';

function BotCard({ bot }: { bot: TelegramBot }) {
  const [open, setOpen] = useState(false);
  const { data: chats } = useTelegramChats(open ? bot.id : null);

  const check = useApiMutation(
    () => apiFetch(`/telegram/bots/${bot.id}/check`, { method: 'POST' }),
    { invalidate: [['telegram']], success: 'Verificado' },
  );
  const remove = useApiMutation(
    () => apiFetch(`/telegram/bots/${bot.id}`, { method: 'DELETE' }),
    { invalidate: [['telegram']], success: 'Bot removido' },
  );

  const statusVariant =
    bot.status === 'OK' ? 'default' : bot.status === 'ERROR' ? 'destructive' : 'secondary';

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{bot.label}</p>
            <p className="truncate text-xs text-muted-foreground">
              {bot.username ? `@${bot.username}` : 'sem username'}
            </p>
          </div>
        </button>
        <Badge variant={statusVariant}>{bot.status}</Badge>
        <Button size="sm" variant="outline" disabled={check.isPending} onClick={() => check.mutate(undefined)}>
          Testar
        </Button>
        <Button
          size="icon-sm"
          variant="destructive"
          aria-label="Remover bot"
          disabled={remove.isPending}
          onClick={() => {
            if (confirm(`Remover o bot "${bot.label}"? Automações que usam os chats dele param de enviar.`)) {
              remove.mutate(undefined);
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {open && (
        <div className="space-y-2 border-t border-border p-3 pt-3">
          {bot.lastError && <p className="text-xs text-red-400">Último erro: {bot.lastError}</p>}
          <p className="text-xs text-muted-foreground">
            Grupos e canais aparecem aqui automaticamente assim que você adicionar este bot
            neles como administrador — não existe um botão de "sincronizar", o Telegram não tem
            como listar isso sob demanda.
          </p>
          <ul className="space-y-1">
            {chats?.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-2 py-1 text-sm"
              >
                <span>{c.title}</span>
                {c.botIsAdmin ? (
                  <Badge className="bg-brand/20 text-brand">Admin</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">membro</span>
                )}
              </li>
            ))}
            {chats?.length === 0 && (
              <li className="text-sm text-muted-foreground">
                Nenhum grupo/canal encontrado ainda.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function TelegramPage() {
  const { data: bots } = useTelegramBots();
  const [label, setLabel] = useState('');
  const [token, setToken] = useState('');

  const create = useApiMutation(
    () => apiFetch('/telegram/bots', { method: 'POST', json: { label, token } }),
    {
      invalidate: [['telegram']],
      success: 'Bot conectado',
      onSuccess: () => {
        setLabel('');
        setToken('');
      },
    },
  );

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Telegram</h1>
        <p className="text-sm text-muted-foreground">
          Conecte um bot (crie um em{' '}
          <span className="font-mono">@BotFather</span>) para enviar ofertas também em grupos e
          canais do Telegram.
        </p>
      </div>

      <form
        className="space-y-3 rounded-lg border border-border bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim() && token.trim()) create.mutate(undefined);
        }}
      >
        <div>
          <Label htmlFor="tg-label">Nome (só para identificar aqui)</Label>
          <Input
            id="tg-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1"
            placeholder="Ex.: Bot de Ofertas"
          />
        </div>
        <div>
          <Label htmlFor="tg-token">Token do bot (do @BotFather)</Label>
          <Input
            id="tg-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mt-1 font-mono"
            placeholder="123456789:AAExemploDeTokenDoBotFather"
          />
        </div>
        <Button
          type="submit"
          disabled={!label.trim() || !token.trim() || create.isPending}
          className="bg-brand text-white hover:bg-brand/90"
        >
          {create.isPending ? 'Conectando…' : 'Conectar bot'}
        </Button>
      </form>

      <div className="space-y-2">
        {bots?.map((b) => (
          <BotCard key={b.id} bot={b} />
        ))}
        {bots?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum bot conectado ainda.</p>
        )}
      </div>
    </div>
  );
}
