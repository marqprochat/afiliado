'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

// Retorno do OAuth do Mercado Livre (redirect_uri = https://<domínio>/callbackml). Rota pública
// (ver middleware.ts): o usuário chega aqui vindo do Mercado Livre e a página conclui a conexão
// chamando a API do painel com a sessão dele. Usa fetch direto (não apiFetch): em 401 o apiFetch
// redirecionaria para /login e o código da URL se perderia.

type Phase = 'reading' | 'connecting' | 'done' | 'needs-login' | 'error' | 'no-code';

const CALLBACK_URL = '/api/v1/marketplaces/mercadolivre/oauth/callback';
const BACK_URL = '/marketplaces?open=MERCADOLIVRE';

export default function CallbackMlPage() {
  const [phase, setPhase] = useState<Phase>('reading');
  const [message, setMessage] = useState('');
  const [href, setHref] = useState('');
  const [copied, setCopied] = useState(false);
  const started = useRef(false);
  const params = useRef<{ code: string; state: string } | null>(null);

  const connect = useCallback(async () => {
    const p = params.current;
    if (!p) return;
    setPhase('connecting');
    try {
      const res = await fetch(CALLBACK_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(p),
      });
      if (res.ok) {
        setPhase('done');
        setTimeout(() => window.location.assign(BACK_URL), 1500);
        return;
      }
      if (res.status === 401) {
        setPhase('needs-login');
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setMessage(data?.error?.message ?? `Falha ao conectar (HTTP ${res.status})`);
      setPhase('error');
    } catch {
      setMessage('Não foi possível falar com o servidor. Tente novamente.');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    // O state é de uso único: o React em modo estrito roda este efeito duas vezes em desenvolvimento.
    if (started.current) return;
    started.current = true;
    setHref(window.location.href);
    const search = new URL(window.location.href).searchParams;
    const error = search.get('error');
    const code = search.get('code');
    const state = search.get('state');
    if (error) {
      setMessage(`O Mercado Livre devolveu um erro: ${error}`);
      setPhase('error');
    } else if (code && state) {
      params.current = { code, state };
      void connect();
    } else {
      setPhase('no-code');
    }
  }, [connect]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // sem permissão de área de transferência: o usuário copia a caixa à mão
    }
  }

  const hasCode = params.current !== null;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-surface p-8 shadow-xl">
        <h1 className="mb-3 text-2xl font-bold">Conexão com o Mercado Livre</h1>

        {(phase === 'reading' || phase === 'connecting') && (
          <p className="text-sm text-muted-foreground">Concluindo a conexão…</p>
        )}

        {phase === 'done' && (
          <p className="text-sm text-emerald-500">
            Conectado! Voltando para as configurações do Mercado Livre…
          </p>
        )}

        {phase === 'needs-login' && (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Você não está logado no painel neste navegador. Entre no painel em outra aba e depois
              clique em “Tentar de novo”. O código de autorização continua válido por alguns minutos.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => void connect()}>Tentar de novo</Button>
              <a href="/login" target="_blank" rel="noreferrer" className="self-center text-sm underline">
                Abrir o painel
              </a>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <p className="mb-4 text-sm text-red-500">{message}</p>
            <a href={BACK_URL} className="text-sm underline">
              Voltar às configurações e tentar de novo
            </a>
          </>
        )}

        {phase === 'no-code' && (
          <p className="text-sm text-muted-foreground">
            Nenhum código de autorização na URL. Para conectar, abra as configurações do Mercado Livre
            no painel e use “Conectar API oficial”.
          </p>
        )}

        {hasCode && (phase === 'error' || phase === 'needs-login') && (
          <details className="mt-5 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">
              Uso manual (scripts): copiar o endereço desta página
            </summary>
            <textarea
              readOnly
              value={href}
              rows={4}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-2 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs"
            />
            <Button type="button" size="sm" variant="outline" className="mt-2" onClick={copy}>
              {copied ? 'Copiado!' : 'Copiar endereço'}
            </Button>
            <p className="mt-2">Este código é de uso único e só serve com o segredo do seu app. Não o compartilhe.</p>
          </details>
        )}
      </div>
    </main>
  );
}
