'use client';
import { useState, useEffect, useRef } from 'react';
import { Check, AlertCircle, Link2, Sparkles, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { GroupLinkPreview } from './group-link-preview';
import { useGroups, useSessions, useSlugAvailability } from '@/lib/queries';
import { useApiMutation } from '@/lib/mutations';
import { apiFetch } from '@/lib/api';
import type { GroupLink, GroupTextPosition } from '@/lib/types';

interface GroupLinkFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editItem?: GroupLink | null;
  onSuccess?: () => void;
}

const selectCls =
  'h-9 w-full rounded-md border border-input bg-surface-2 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-brand';

export function GroupLinkFormDialog({
  open,
  onOpenChange,
  editItem,
  onSuccess,
}: GroupLinkFormDialogProps) {
  const { data: sessions = [] } = useSessions();
  const connectedSessions = sessions.filter((s) => s.status === 'CONNECTED');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sessionId, setSessionId] = useState('');
  const [slug, setSlug] = useState('');
  const [label, setLabel] = useState('');
  const [baseName, setBaseName] = useState('');
  const [customText, setCustomText] = useState('');
  const [textPosition, setTextPosition] = useState<GroupTextPosition>('PREFIX');
  const [numberPrefix, setNumberPrefix] = useState('#');
  const [startNumber, setStartNumber] = useState(1);
  const [memberLimit, setMemberLimit] = useState(1000);
  const [rotateMargin, setRotateMargin] = useState(20);
  const [maxRotationsPerHour, setMaxRotationsPerHour] = useState(3);
  const [groupDescription, setGroupDescription] = useState('');
  const [announceOnly, setAnnounceOnly] = useState(false);
  const [seedParticipantsText, setSeedParticipantsText] = useState('');
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [groupImageBase64, setGroupImageBase64] = useState<string | null>(null);
  const [adoptionMode, setAdoptionMode] = useState<'create' | 'adopt'>('create');
  const [initialGroupJid, setInitialGroupJid] = useState('');

  const { data: sessionGroups = [] } = useGroups(sessionId || null);
  const { data: slugCheck, isLoading: isCheckingSlug } = useSlugAvailability(!editItem ? slug : '');

  useEffect(() => {
    if (editItem) {
      setSessionId(editItem.sessionId);
      setSlug(editItem.slug);
      setLabel(editItem.label);
      setBaseName(editItem.baseName);
      setCustomText(editItem.customText || '');
      setTextPosition(editItem.textPosition || 'PREFIX');
      setNumberPrefix(editItem.numberPrefix || '#');
      setStartNumber(editItem.startNumber || 1);
      setMemberLimit(editItem.memberLimit || 1000);
      setRotateMargin(editItem.rotateMargin || 20);
      setMaxRotationsPerHour(editItem.maxRotationsPerHour || 3);
      setGroupDescription(editItem.groupDescription || '');
      setAnnounceOnly(editItem.announceOnly || false);
      setSeedParticipantsText(editItem.seedParticipants?.join('\n') || '');
      setFallbackUrl(editItem.fallbackUrl || '');
      setGroupImageBase64(editItem.groupImageBase64 || null);
    } else {
      setSessionId(connectedSessions[0]?.id || sessions[0]?.id || '');
      setSlug('');
      setLabel('');
      setBaseName('');
      setCustomText('');
      setTextPosition('PREFIX');
      setNumberPrefix('#');
      setStartNumber(1);
      setMemberLimit(1000);
      setRotateMargin(20);
      setMaxRotationsPerHour(3);
      setGroupDescription('');
      setAnnounceOnly(false);
      setSeedParticipantsText('');
      setFallbackUrl('');
      setGroupImageBase64(null);
      setAdoptionMode('create');
      setInitialGroupJid('');
    }
  }, [editItem, open]);

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Selecione uma imagem válida (JPEG, PNG ou WebP).');
      return;
    }

    if (file.size > 350 * 1024) {
      alert('A imagem é muito grande. Escolha uma foto de até 300KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setGroupImageBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setGroupImageBase64(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const createMutation = useApiMutation(
    (payload: Record<string, unknown>) =>
      apiFetch('/group-links', {
        method: 'POST',
        json: payload,
      }),
    {
      invalidate: [['group-links']],
      success: 'Link Fixo criado com sucesso!',
      onSuccess: () => {
        onOpenChange(false);
        onSuccess?.();
      },
    },
  );

  const updateMutation = useApiMutation(
    (payload: Record<string, unknown>) =>
      apiFetch(`/group-links/${editItem?.id}`, {
        method: 'PATCH',
        json: payload,
      }),
    {
      invalidate: [['group-links']],
      success: 'Configurações atualizadas com sucesso!',
      onSuccess: () => {
        onOpenChange(false);
        onSuccess?.();
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const seedParticipants = seedParticipantsText
      .split(/[\n,]/)
      .map((p) => p.trim().replace(/\D/g, ''))
      .filter((p) => p.length >= 10);

    if (editItem) {
      updateMutation.mutate({
        label,
        baseName,
        customText,
        textPosition,
        numberPrefix,
        memberLimit,
        rotateMargin,
        maxRotationsPerHour,
        groupDescription: groupDescription.trim() || null,
        announceOnly,
        seedParticipants,
        groupImageBase64: groupImageBase64 || null,
        fallbackUrl: fallbackUrl.trim() || null,
      });
    } else {
      createMutation.mutate({
        sessionId,
        slug: slug.trim().toLowerCase(),
        label,
        baseName,
        customText,
        textPosition,
        numberPrefix,
        startNumber,
        memberLimit,
        rotateMargin,
        maxRotationsPerHour,
        groupDescription: groupDescription.trim() || null,
        announceOnly,
        seedParticipants,
        groupImageBase64: groupImageBase64 || undefined,
        fallbackUrl: fallbackUrl.trim() || null,
        initialGroupJid: adoptionMode === 'adopt' && initialGroupJid ? initialGroupJid : undefined,
      });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const rotateAtThreshold = Math.max(1, memberLimit - rotateMargin);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl md:max-w-3xl lg:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Link2 className="h-5 w-5 text-brand" />
            {editItem ? 'Editar Link Fixo de Grupos' : 'Novo Link Fixo de Grupos'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Seção 1: Identificação & Conexão */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {!editItem && (
              <div className="lg:col-span-1">
                <Label htmlFor="gl-session">Sessão do WhatsApp *</Label>
                <select
                  id="gl-session"
                  className={`${selectCls} mt-1`}
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  required
                >
                  <option value="">Selecione uma sessão conectada…</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} ({s.phone ?? s.status})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={!editItem ? 'lg:col-span-1' : 'md:col-span-1'}>
              <Label htmlFor="gl-label">Identificação / Rótulo *</Label>
              <Input
                id="gl-label"
                className="mt-1"
                placeholder="Ex.: Ofertas Black Friday"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
              />
            </div>

            <div className={!editItem ? 'lg:col-span-1' : 'md:col-span-1'}>
              <Label htmlFor="gl-slug">Slug do Link Público *</Label>
              <div className="relative mt-1">
                <Input
                  id="gl-slug"
                  placeholder="ex: ofertas-vip"
                  value={slug}
                  disabled={!!editItem}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  required
                  className={
                    !editItem && slug.length >= 3
                      ? slugCheck?.available
                        ? 'border-emerald-500 pr-8'
                        : 'border-red-500 pr-8'
                      : ''
                  }
                />
                {!editItem && slug.length >= 3 && (
                  <div className="absolute right-2.5 top-2.5">
                    {isCheckingSlug ? (
                      <span className="text-xs text-muted-foreground">...</span>
                    ) : slugCheck?.available ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    )}
                  </div>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                URL final: <code>/g/{slug || 'seu-slug'}</code>
              </div>
            </div>
          </div>

          {/* Seção 2: Identidade Visual e Formatação do Nome */}
          <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-brand" />
              Identidade Visual & Padrão de Nome dos Grupos
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Upload de Foto de Perfil */}
              <div className="lg:col-span-4 rounded-lg border border-border bg-surface-2 p-3.5 flex flex-col items-center text-center">
                <Label className="text-xs font-medium text-muted-foreground mb-2">
                  Foto de Perfil dos Grupos
                </Label>
                <div className="relative mb-3">
                  {groupImageBase64 ? (
                    <img
                      src={groupImageBase64}
                      alt="Foto de perfil"
                      className="h-20 w-20 rounded-full object-cover border-2 border-brand ring-2 ring-brand/20 shadow-sm"
                    />
                  ) : (
                    <div className="h-20 w-20 rounded-full bg-surface border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-7 w-7 text-muted-foreground/60 mb-0.5" />
                      <span className="text-[10px]">Sem foto</span>
                    </div>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleImageFileChange}
                />

                <div className="flex gap-2 w-full justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs flex items-center gap-1"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {groupImageBase64 ? 'Alterar' : 'Escolher Foto'}
                  </Button>
                  {groupImageBase64 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 px-2"
                      onClick={handleRemoveImage}
                      title="Remover foto"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground mt-1.5">
                  JPEG, PNG ou WebP (máx. 300KB)
                </span>
              </div>

              {/* Parâmetros do Nome */}
              <div className="lg:col-span-8 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="gl-basename">Nome Base *</Label>
                    <Input
                      id="gl-basename"
                      className="mt-1"
                      placeholder="Ex.: Achadinhos VIP"
                      value={baseName}
                      onChange={(e) => setBaseName(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="gl-customtext">Texto Programável (opcional)</Label>
                    <Input
                      id="gl-customtext"
                      className="mt-1"
                      placeholder="Ex.: 🔥 OFERTAS 🔥"
                      value={customText}
                      onChange={(e) => setCustomText(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="gl-position">Posição do Texto</Label>
                    <select
                      id="gl-position"
                      className={`${selectCls} mt-1`}
                      value={textPosition}
                      onChange={(e) => setTextPosition(e.target.value as GroupTextPosition)}
                    >
                      <option value="PREFIX">PREFIXO (Início)</option>
                      <option value="SUFFIX">SUFIXO (Fim)</option>
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="gl-numprefix">Prefixo do Número</Label>
                    <Input
                      id="gl-numprefix"
                      className="mt-1"
                      placeholder="#"
                      value={numberPrefix}
                      onChange={(e) => setNumberPrefix(e.target.value)}
                    />
                  </div>

                  {!editItem && (
                    <div>
                      <Label htmlFor="gl-startnum">Número Inicial</Label>
                      <Input
                        id="gl-startnum"
                        type="number"
                        min={1}
                        className="mt-1"
                        value={startNumber}
                        onChange={(e) => setStartNumber(Number(e.target.value))}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Prévia ao vivo */}
            <GroupLinkPreview
              baseName={baseName}
              customText={customText}
              textPosition={textPosition}
              numberPrefix={numberPrefix}
              number={startNumber}
              groupImageBase64={groupImageBase64}
            />
          </div>

          {/* Seção 3: Capacidade e Rotação Automática */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="gl-limit">Limite de Membros</Label>
              <Input
                id="gl-limit"
                type="number"
                min={10}
                max={1024}
                className="mt-1"
                value={memberLimit}
                onChange={(e) => setMemberLimit(Number(e.target.value))}
                required
              />
            </div>

            <div>
              <Label htmlFor="gl-margin">Margem de Rotação</Label>
              <Input
                id="gl-margin"
                type="number"
                min={1}
                max={100}
                className="mt-1"
                value={rotateMargin}
                onChange={(e) => setRotateMargin(Number(e.target.value))}
                required
              />
              <div className="text-[11px] text-muted-foreground mt-1">
                Rotaciona em: <strong className="text-foreground">{rotateAtThreshold}</strong>{' '}
                membros
              </div>
            </div>

            <div className="sm:col-span-2 md:col-span-1">
              <Label htmlFor="gl-maxrate">Máx Rotações / Hora</Label>
              <Input
                id="gl-maxrate"
                type="number"
                min={1}
                max={60}
                className="mt-1"
                value={maxRotationsPerHour}
                onChange={(e) => setMaxRotationsPerHour(Number(e.target.value))}
                required
              />
            </div>
          </div>

          {/* Seção 4: Modo de Inicialização (só na criação) */}
          {!editItem && (
            <div className="rounded-lg border border-border bg-surface-2 p-3.5 space-y-2">
              <Label className="text-sm font-semibold">Grupo Inicial (#1)</Label>
              <div className="flex flex-wrap gap-4 text-sm mt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="adoptionMode"
                    value="create"
                    checked={adoptionMode === 'create'}
                    onChange={() => setAdoptionMode('create')}
                  />
                  <span>Criar Novo Grupo Automaticamente</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="adoptionMode"
                    value="adopt"
                    checked={adoptionMode === 'adopt'}
                    onChange={() => setAdoptionMode('adopt')}
                  />
                  <span>Adotar Grupo Existente</span>
                </label>
              </div>

              {adoptionMode === 'adopt' && (
                <div className="mt-2 pt-2 border-t border-border">
                  <Label htmlFor="gl-adopt-jid">Selecione o Grupo do WhatsApp</Label>
                  <select
                    id="gl-adopt-jid"
                    className={`${selectCls} mt-1`}
                    value={initialGroupJid}
                    onChange={(e) => setInitialGroupJid(e.target.value)}
                    required={adoptionMode === 'adopt'}
                  >
                    <option value="">Selecione um grupo da sessão…</option>
                    {sessionGroups.map((g) => (
                      <option key={g.jid} value={g.jid}>
                        {g.name} ({g.memberCount} membros)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Seção 5: Configurações Avançadas */}
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="gl-announce">Somente Administradores Enviam Mensagens</Label>
                <div className="text-xs text-muted-foreground">
                  Configura o grupo automaticamente no modo de avisos (anúncios)
                </div>
              </div>
              <Switch id="gl-announce" checked={announceOnly} onCheckedChange={setAnnounceOnly} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <Label htmlFor="gl-desc">Descrição Automática do Grupo</Label>
                <Textarea
                  id="gl-desc"
                  className="mt-1"
                  rows={2}
                  placeholder="Regras do grupo, links de redes sociais, etc."
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="gl-fallback">URL de Fallback (opcional)</Label>
                <Input
                  id="gl-fallback"
                  type="url"
                  className="mt-1"
                  placeholder="https://meusite.com/canal-indisponivel"
                  value={fallbackUrl}
                  onChange={(e) => setFallbackUrl(e.target.value)}
                />
                <div className="text-[11px] text-muted-foreground mt-1">
                  Redireciona para esta URL se não houver grupos abertos no momento.
                </div>
              </div>

              <div>
                <Label htmlFor="gl-seed">Participantes Iniciais / Sementes (opcional)</Label>
                <Textarea
                  id="gl-seed"
                  className="mt-1"
                  rows={2}
                  placeholder="5511999999999 (um por linha ou separados por vírgula)"
                  value={seedParticipantsText}
                  onChange={(e) => setSeedParticipantsText(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Salvando...' : editItem ? 'Salvar Alterações' : 'Criar Link Fixo'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
