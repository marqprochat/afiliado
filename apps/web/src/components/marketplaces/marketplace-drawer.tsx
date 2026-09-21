'use client';
import { useEffect, useRef, useState } from 'react';
import type { MarketplaceKind } from '@afilados/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusPill } from '@/components/app-shell/status-pill';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { formatDateTime } from '@/lib/format';
import type { MarketplaceConnection } from '@/lib/types';
import { MARKETPLACE_CONFIGS, type MarketplaceFieldKey } from './marketplace-config';

export interface MarketplaceSubmitPayload {
  fields: Partial<Record<MarketplaceFieldKey, string>>;
  cookie: string;
}

export interface MarketplaceFeedback {
  message: string;
  ok: boolean;
}

function initialFieldValue(key: MarketplaceFieldKey, connection?: MarketplaceConnection): string {
  switch (key) {
    case 'appId':
      return connection?.appId ?? '';
    case 'affiliateTag':
      return connection?.affiliateTag ?? '';
    case 'mattWord':
      return connection?.mattWord ?? '';
    case 'mattTool':
      return connection?.mattTool ?? '';
    case 'amazonClientId':
      return connection?.amazonClientId ?? '';
    case 'secret':
    case 'amazonClientSecret':
      return '';
  }
}

function sessionStatus(kind: MarketplaceKind, connection?: MarketplaceConnection) {
  if (!connection) return null;
  const syncedAt =
    kind === 'MERCADOLIVRE'
      ? connection.mlSessionSyncedAt
      : kind === 'AMAZON'
        ? connection.amazonSessionSyncedAt
        : kind === 'MAGALU'
          ? connection.magaluSessionSyncedAt
          : null;
  const source =
    kind === 'MERCADOLIVRE'
      ? connection.mlSessionSource
      : kind === 'AMAZON'
        ? connection.amazonSessionSource
        : kind === 'MAGALU'
          ? connection.magaluSessionSource
          : null;
  if (!syncedAt) return null;
  return { syncedAt, source };
}

export function MarketplaceDrawer({
  kind,
  connection,
  open,
  onOpenChange,
  onSubmit,
  pending,
  feedback,
}: {
  kind: MarketplaceKind;
  connection?: MarketplaceConnection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: MarketplaceSubmitPayload) => Promise<void>;
  pending: boolean;
  feedback: MarketplaceFeedback | null;
}) {
  const config = MARKETPLACE_CONFIGS[kind];
  const [values, setValues] = useState<Record<string, string>>({});
  const [cookie, setCookie] = useState('');
  // Validação local (não depende de round-trip com o servidor) — some assim que o drawer
  // reabre ou o usuário tenta enviar de novo.
  const [validationError, setValidationError] = useState<string | null>(null);
  // Rastreia para qual `kind` já inicializamos os campos com dados de `connection` nesta
  // sessão de abertura do drawer. Isso permite reagir a `connection` chegando depois (a
  // query de marketplaces pode ainda estar carregando quando `?open=<kind>` já abre o
  // drawer) sem resetar valores que o usuário já digitou em refetches subsequentes em
  // segundo plano — só inicializamos uma vez por abertura.
  const initializedKindRef = useRef<MarketplaceKind | null>(null);

  // Reseta cookie e campos imediatamente quando o drawer abre (ou troca de kind), antes de
  // sabermos se `connection` já está disponível.
  useEffect(() => {
    if (!open) {
      initializedKindRef.current = null;
      return;
    }
    if (initializedKindRef.current === kind) return;
    setValues({});
    setCookie('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  // Preenche os campos com os dados reais assim que `connection` estiver disponível — pode
  // chegar em um render posterior ao efeito acima, se a query ainda estava em andamento.
  useEffect(() => {
    if (!open) return;
    if (initializedKindRef.current === kind) return;
    if (connection === undefined) return;
    initializedKindRef.current = kind;
    const initial: Record<string, string> = {};
    for (const field of config.fields) initial[field.key] = initialFieldValue(field.key, connection);
    setValues(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, connection]);

  const session = sessionStatus(kind, connection);
  const status = connection?.status ?? 'UNCONFIGURED';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    const fields: Partial<Record<MarketplaceFieldKey, string>> = {};
    for (const field of config.fields) {
      const value = values[field.key]?.trim();
      if (value) fields[field.key] = value;
    }
    // Amazon: Client ID e Client Secret da Creators API são salvos como par — a API só
    // substitui `amazonApi` quando os dois chegam juntos, senão preserva o que já estava
    // salvo. Enviar só um dos dois é um no-op silencioso no campo preenchido, então bloqueia
    // aqui com uma mensagem clara em vez de deixar o usuário achar que salvou.
    if (kind === 'AMAZON') {
      const hasClientId = Boolean(fields.amazonClientId);
      const hasClientSecret = Boolean(fields.amazonClientSecret);
      if (hasClientId !== hasClientSecret) {
        setValidationError(
          'Informe Client ID e Client Secret da Creators API juntos (ou deixe os dois em branco para manter o que já está salvo).',
        );
        return;
      }
    }
    await onSubmit({ fields, cookie: cookie.trim() });
  }

  const displayedFeedback = validationError ? { message: validationError, ok: false } : feedback;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <div className="flex items-center justify-between gap-2">
            <DrawerTitle>{config.label}</DrawerTitle>
            <StatusPill label={status} status={status} />
          </div>
          <DrawerDescription>{config.description}</DrawerDescription>
          <a
            href={config.platformUrl}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-xs text-brand underline"
          >
            Abrir plataforma
          </a>
        </DrawerHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4">
          {config.fields.map((field) => (
            <div key={field.key}>
              <Label htmlFor={`mkt-${field.key}`}>
                {field.label}
                {field.required && <span className="text-red-400"> *</span>}
              </Label>
              <Input
                id={`mkt-${field.key}`}
                type={field.type}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                placeholder={
                  field.key === 'secret'
                    ? connection?.hasSecret
                      ? '•••• (já salvo)'
                      : ''
                    : field.key === 'amazonClientSecret'
                      ? connection?.hasAmazonApiSecret
                        ? '•••• (já salvo)'
                        : ''
                      : field.placeholder
                }
                className="mt-1"
              />
              {field.helpContent && (
                <details className="mt-1.5 text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">
                    {field.helpTitle ?? 'Ajuda'}
                  </summary>
                  <p className="mt-1">{field.helpContent}</p>
                </details>
              )}
            </div>
          ))}

          {config.supportsSession && (
            <div className="rounded-lg border border-border bg-surface-2 p-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Sessão logada (opcional)</p>
                {session ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600">
                    Sincronizada em {formatDateTime(session.syncedAt)} (
                    {session.source === 'manual' ? 'manual' : 'extensão'})
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    Não sincronizada
                  </span>
                )}
              </div>
              <Label htmlFor="mkt-cookie">
                Cole aqui o valor do cookie{' '}
                {config.sessionCookieName ? `"${config.sessionCookieName}"` : ''} ou a string
                completa...
              </Label>
              <Textarea
                id="mkt-cookie"
                aria-label="Cookie de sessão"
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                placeholder="Ex: nome=valor; outro=valor"
                className="mt-1"
              />
              {config.sessionHelpContent && (
                <details className="mt-1.5 text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">
                    {config.sessionHelpTitle ?? 'Como exportar o cookie?'}
                  </summary>
                  <p className="mt-1">{config.sessionHelpContent}</p>
                </details>
              )}
              {config.extensionUrl && (
                <p className="mt-2 text-xs">
                  Ou instale a{' '}
                  <a href={config.extensionUrl} className="text-brand underline">
                    extensão Afilados Connect
                  </a>{' '}
                  para sincronizar automaticamente.
                </p>
              )}
            </div>
          )}

          {displayedFeedback && (
            <p className={`text-xs ${displayedFeedback.ok ? 'text-emerald-500' : 'text-red-400'}`}>
              {displayedFeedback.message}
            </p>
          )}

          <DrawerFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Testando e salvando...' : 'Testar e Salvar'}
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
