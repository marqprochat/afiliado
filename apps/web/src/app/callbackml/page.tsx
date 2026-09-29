'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

// Retorno do OAuth do Mercado Livre (redirect_uri = https://<domínio>/callbackml). Rota pública
// (ver middleware.ts): o usuário chega aqui vindo do Mercado Livre, sem sessão do painel. Por
// enquanto só mostra o que veio na URL para ser colado no script scripts/ml-api-probe.mjs — a
// leitura acontece só no navegador, nada é enviado ou gravado.
export default function CallbackMlPage() {
  const [href, setHref] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setHref(window.location.href);
  }, []);

  const params = href ? new URL(href).searchParams : null;
  const code = params?.get('code') ?? null;
  const error = params?.get('error') ?? null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // sem permissão de área de transferência: o usuário copia a caixa abaixo à mão
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-surface p-8 shadow-xl">
        <h1 className="mb-1 text-2xl font-bold">Retorno do Mercado Livre</h1>
        {!href ? (
          <p className="text-sm text-muted-foreground">Lendo o retorno…</p>
        ) : error ? (
          <>
            <p className="mb-3 text-sm text-red-500">O Mercado Livre devolveu um erro: {error}</p>
            <p className="text-sm text-muted-foreground">Refaça a autorização a partir do script.</p>
          </>
        ) : code ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Autorização recebida. Copie o endereço completo desta página e cole no terminal onde o
              script está aguardando.
            </p>
            <textarea
              readOnly
              value={href}
              rows={4}
              onFocus={(e) => e.currentTarget.select()}
              className="mb-4 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs"
            />
            <Button onClick={copy}>{copied ? 'Copiado!' : 'Copiar endereço'}</Button>
            <p className="mt-4 text-xs text-muted-foreground">
              Este código é de uso único e só serve com o segredo do seu app. Não o compartilhe.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum código de autorização na URL. Comece o processo pelo script{' '}
            <code>scripts/ml-api-probe.mjs</code>.
          </p>
        )}
      </div>
    </main>
  );
}
