'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiTokens } from '@/lib/queries';
import { apiFetch } from '@/lib/api';
import type { ApiToken } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Key,
  Plus,
  Trash2,
  Check,
  Copy,
  Sparkles,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';

export default function ExtensaoConfigPage() {
  const queryClient = useQueryClient();
  const { data: tokens = [], isLoading } = useApiTokens();

  const [tokenName, setTokenName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenName.trim()) return;

    setIsCreating(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<ApiToken & { token: string }>('/api-tokens', {
        method: 'POST',
        body: JSON.stringify({ name: tokenName.trim() }),
      });
      setNewlyCreatedToken(res.token);
      setTokenName('');
      await queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao gerar token');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeToken = async (id: string) => {
    if (!confirm('Deseja realmente revogar este token? A extensão deixará de funcionar com ele.')) return;
    try {
      await apiFetch(`/api-tokens/${id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao revogar token');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <Sparkles className="w-7 h-7 text-emerald-500" />
          Extensão Chrome — Afilados Connect
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Capture ofertas em 1 clique diretamente nas páginas de produto do Mercado Livre, Amazon, Magalu e Shopee.
        </p>
      </div>

      {/* Alerta de Token Criado */}
      {newlyCreatedToken && (
        <Card className="border-emerald-500/50 bg-emerald-950/20 text-emerald-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-emerald-400">
              <Check className="w-5 h-5" /> Token Gerado com Sucesso!
            </CardTitle>
            <CardDescription className="text-emerald-300/80">
              Copie seu token agora. Por motivos de segurança, ele não será exibido novamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 p-3 bg-slate-950 rounded-md border border-emerald-500/40 text-emerald-300 font-mono text-xs break-all">
                {newlyCreatedToken}
              </code>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
                onClick={() => copyToClipboard(newlyCreatedToken)}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado!' : 'Copiar'}
              </Button>
            </div>
            <p className="text-xs text-emerald-400/70">
              Cole este token no campo &quot;Token de API&quot; no popup da extensão instalada no seu navegador.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Grid: Gerar Token + Instruções de Instalação */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Formulário Novo Token */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-white">
              <Key className="w-5 h-5 text-emerald-400" />
              Gerar Chave de Acesso
            </CardTitle>
            <CardDescription>
              Crie uma chave para vincular a extensão à sua conta Afilados.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateToken} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token-name" className="text-slate-300">
                  Nome do Dispositivo / Identificador
                </Label>
                <Input
                  id="token-name"
                  placeholder="Ex: Meu Chrome no MacBook, PC Trabalho"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>

              {errorMsg && (
                <div className="text-xs text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> {errorMsg}
                </div>
              )}

              <Button
                type="submit"
                disabled={isCreating || !tokenName.trim()}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white gap-2 font-medium"
              >
                <Plus className="w-4 h-4" />
                {isCreating ? 'Gerando...' : 'Gerar Chave de Acesso'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Como Instalar */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-white">
              <ExternalLink className="w-5 h-5 text-sky-400" />
              Como Instalar a Extensão
            </CardTitle>
            <CardDescription>
              Instalação rápida no Chrome, Edge, Brave ou navegadores Chromium.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-slate-300">
            <div className="flex gap-2.5 items-start">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center font-bold text-[10px]">1</span>
              <div>
                Abra a página de extensões no seu navegador acessando <code className="text-sky-300 bg-slate-950 px-1 py-0.5 rounded">chrome://extensions</code>.
              </div>
            </div>
            <div className="flex gap-2.5 items-start">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center font-bold text-[10px]">2</span>
              <div>
                Ative a chave <strong>&quot;Modo do desenvolvedor&quot;</strong> no canto superior direito.
              </div>
            </div>
            <div className="flex gap-2.5 items-start">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center font-bold text-[10px]">3</span>
              <div>
                Clique em <strong>&quot;Carregar sem compactação&quot;</strong> e selecione a pasta <code className="text-emerald-400 bg-slate-950 px-1 py-0.5 rounded">apps/extension</code> do projeto.
              </div>
            </div>
            <div className="flex gap-2.5 items-start">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center font-bold text-[10px]">4</span>
              <div>
                Abra o popup do <strong>Afilados Connect</strong> e cole a Chave de Acesso gerada ao lado.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabela de Tokens Ativos */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-base text-white">Chaves de Acesso Ativas</CardTitle>
          <CardDescription>
            Tokens com permissão de ingestão de ofertas vinculados à sua conta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-slate-400 py-4 text-center">Carregando chaves...</div>
          ) : tokens.length === 0 ? (
            <div className="text-sm text-slate-500 py-6 text-center">
              Nenhuma chave de acesso ativa. Gere uma chave acima para conectar a extensão.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Nome</TableHead>
                  <TableHead className="text-slate-400">Identificador</TableHead>
                  <TableHead className="text-slate-400">Criado em</TableHead>
                  <TableHead className="text-slate-400">Último Uso</TableHead>
                  <TableHead className="text-right text-slate-400">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((t) => (
                  <TableRow key={t.id} className="border-slate-800/60 hover:bg-slate-800/30">
                    <TableCell className="font-medium text-slate-200">{t.name}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-slate-950 px-2 py-0.5 rounded text-slate-400">
                        ••••••••{t.tokenHint}
                      </code>
                    </TableCell>
                    <TableCell className="text-slate-400 text-xs">
                      {new Date(t.createdAt).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-slate-400 text-xs">
                      {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString('pt-BR') : 'Nunca usado'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 h-8 px-2"
                        onClick={() => handleRevokeToken(t.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
