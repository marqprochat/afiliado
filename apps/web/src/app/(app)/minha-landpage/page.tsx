'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  ExternalLink,
  Copy,
  Check,
  Save,
  Globe,
  Palette,
  FileText,
  TrendingUp,
  Share2,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Upload,
  Link as LinkIcon,
  Trash2,
  Image as ImageIcon,
  FileImage,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';

const THEME_OPTIONS = [
  { id: 'red', name: 'Vermelho Fogo', border: 'border-red-500', bg: 'bg-red-500', glow: 'shadow-red-500/30' },
  { id: 'emerald', name: 'Verde Esmeralda', border: 'border-emerald-500', bg: 'bg-emerald-500', glow: 'shadow-emerald-500/30' },
  { id: 'cyan', name: 'Ciano Cyber', border: 'border-cyan-400', bg: 'bg-cyan-400', glow: 'shadow-cyan-400/30' },
  { id: 'blue', name: 'Azul Royal', border: 'border-blue-500', bg: 'bg-blue-500', glow: 'shadow-blue-500/30' },
  { id: 'violet', name: 'Roxo Elétrico', border: 'border-purple-500', bg: 'bg-purple-500', glow: 'shadow-purple-500/30' },
  { id: 'amber', name: 'Âmbar Dourado', border: 'border-amber-400', bg: 'bg-amber-400', glow: 'shadow-amber-400/30' },
  { id: 'rose', name: 'Rosa Neon', border: 'border-rose-500', bg: 'bg-rose-500', glow: 'shadow-rose-500/30' },
] as const;

/** Otimiza fotos grandes redimensionando proporcionalmente para no máximo 900x900px */
function processImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('O arquivo selecionado não é uma imagem válida.'));
      return;
    }

    if (file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Falha ao ler o arquivo SVG.'));
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 900;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_DIM) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        // Gera JPEG otimizado de alta qualidade
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        resolve(dataUrl);
      };
      img.onerror = () => resolve(e.target?.result as string);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Erro ao processar imagem.'));
    reader.readAsDataURL(file);
  });
}

export default function MinhaLandpagePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'geral' | 'hero' | 'stats' | 'redes' | 'secoes'>('geral');

  // Controle de upload vs URL
  const [imageMode, setImageMode] = useState<'upload' | 'url'>('upload');
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    slug: '',
    enabled: true,
    title: '',
    authorName: '',
    authorBadge: 'RADAR VIP · 24H',
    authorBio: '',
    authorImage: '',
    logoText: '',
    themeColor: 'red',
    headline: '',
    subheadline: '',
    ctaButtonText: 'QUERO ENTRAR NOS GRUPOS VIP',
    stat1Value: '+10K',
    stat1Label: 'Membros VIP',
    stat2Value: 'R$ 500K+',
    stat2Label: 'Economia Gerada',
    stat3Value: '100%',
    stat3Label: 'Links Verificados',
    stat4Value: '24/7',
    stat4Label: 'Radar Ativo',
    youtubeUrl: '',
    instagramUrl: '',
    telegramUrl: '',
    showBenefits: true,
    showAuthority: true,
    showCategories: true,
    showFaq: true,
  });

  useEffect(() => {
    async function loadData() {
      try {
        const res = await apiFetch<{ ok: boolean; data: any }>('/affiliate-landing');
        if (res.ok && res.data) {
          const d = res.data;
          const currentImg = d.authorImage || '';
          setFormData({
            slug: d.slug || '',
            enabled: d.enabled ?? true,
            title: d.title || '',
            authorName: d.authorName || '',
            authorBadge: d.authorBadge || 'RADAR VIP · 24H',
            authorBio: d.authorBio || '',
            authorImage: currentImg,
            logoText: d.logoText || '',
            themeColor: d.themeColor || 'red',
            headline: d.headline || '',
            subheadline: d.subheadline || '',
            ctaButtonText: d.ctaButtonText || 'QUERO ENTRAR NOS GRUPOS VIP',
            stat1Value: d.stat1Value || '+10K',
            stat1Label: d.stat1Label || 'Membros VIP',
            stat2Value: d.stat2Value || 'R$ 500K+',
            stat2Label: d.stat2Label || 'Economia Gerada',
            stat3Value: d.stat3Value || '100%',
            stat3Label: d.stat3Label || 'Links Verificados',
            stat4Value: d.stat4Value || '24/7',
            stat4Label: d.stat4Label || 'Radar Ativo',
            youtubeUrl: d.youtubeUrl || '',
            instagramUrl: d.instagramUrl || '',
            telegramUrl: d.telegramUrl || '',
            showBenefits: d.showBenefits ?? true,
            showAuthority: d.showAuthority ?? true,
            showCategories: d.showCategories ?? true,
            showFaq: d.showFaq ?? true,
          });

          // Se a imagem cadastrada for URL externa (http), inicia no modo URL; senão, modo upload
          if (currentImg.startsWith('http://') || currentImg.startsWith('https://')) {
            setImageMode('url');
          } else {
            setImageMode('upload');
          }
        }
      } catch (err) {
        toast.error('Erro ao carregar dados da sua landing page');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/lp/${formData.slug}` : `/lp/${formData.slug}`;

  const handleCopyLink = async () => {
    if (!formData.slug) return;
    const ok = await copyToClipboard(publicUrl);
    if (ok) {
      setCopied(true);
      toast.success('Link copiado para a área de transferência!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleFileSelect = async (file?: File) => {
    if (!file) return;
    setIsProcessingImage(true);
    try {
      const dataUrl = await processImageFile(file);
      setFormData((prev) => ({ ...prev, authorImage: dataUrl }));
      toast.success('Foto carregada e otimizada com sucesso!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao processar imagem');
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleRemoveImage = () => {
    setFormData((prev) => ({ ...prev, authorImage: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
    toast.info('Imagem removida. A página usará o emblema padrão com suas iniciais.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.slug.trim()) {
      toast.error('Informe um slug para a URL da página');
      return;
    }
    if (!formData.authorName.trim()) {
      toast.error('Informe o nome do canal/autor');
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: any }>('/affiliate-landing', {
        method: 'PUT',
        json: formData,
      });
      if (res.ok) {
        toast.success('Landing page salva com sucesso!');
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar landing page');
    } finally {
      setSaving(false);
    }
  };

  const initials = (formData.authorName || 'VIP')
    .replace(/[^a-zA-ZÀ-ÿ0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'VIP';

  const isImageBase64 = formData.authorImage?.startsWith('data:');
  const isImageHttp = formData.authorImage?.startsWith('http://') || formData.authorImage?.startsWith('https://');

  if (loading) {
    return (
      <div className="p-8 text-center text-muted-foreground animate-pulse">
        Carregando configurações da landing page...
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-brand/10 text-brand text-xs font-mono font-bold uppercase tracking-wider mb-2">
            <Globe className="w-3.5 h-3.5" />
            <span>PÁGINA PÚBLICA DE DIVULGAÇÃO</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight">Minha Landing Page</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure sua página personalizada para captação de membros nos seus grupos de ofertas.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => window.open(`/lp/${formData.slug}`, '_blank')}
            className="flex items-center gap-2"
            disabled={!formData.slug}
          >
            <ExternalLink className="w-4 h-4" />
            <span>Visualizar</span>
          </Button>

          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Salvando...' : 'Salvar Alterações'}</span>
          </Button>
        </div>
      </div>

      {/* URL Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-[#0d121f] to-slate-900 border border-border shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${formData.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            {formData.enabled ? 'Página Publicada e Ativa' : 'Página Pausada'}
          </span>
          <div className="text-sm sm:text-base font-mono font-bold text-white break-all">
            {publicUrl}
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <Button
            type="button"
            variant="secondary"
            onClick={handleCopyLink}
            className="flex items-center gap-2 w-full md:w-auto text-xs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copiado!' : 'Copiar Link'}</span>
          </Button>
        </div>
      </div>

      {/* Navegação por Abas */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('geral')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
            activeTab === 'geral' ? 'bg-brand/15 text-brand border border-brand/30' : 'text-muted-foreground hover:bg-surface-2'
          }`}
        >
          <Palette className="w-4 h-4" />
          <span>Marca & Identidade</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('hero')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
            activeTab === 'hero' ? 'bg-brand/15 text-brand border border-brand/30' : 'text-muted-foreground hover:bg-surface-2'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Chamada & Textos</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('stats')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
            activeTab === 'stats' ? 'bg-brand/15 text-brand border border-brand/30' : 'text-muted-foreground hover:bg-surface-2'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>Números & Prova Social</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('redes')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
            activeTab === 'redes' ? 'bg-brand/15 text-brand border border-brand/30' : 'text-muted-foreground hover:bg-surface-2'
          }`}
        >
          <Share2 className="w-4 h-4" />
          <span>Redes Sociais</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('secoes')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
            activeTab === 'secoes' ? 'bg-brand/15 text-brand border border-brand/30' : 'text-muted-foreground hover:bg-surface-2'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Seções da Página</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ABA: MARCA & IDENTIDADE */}
        {activeTab === 'geral' && (
          <div className="space-y-6 p-6 rounded-2xl bg-surface border border-border">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Palette className="w-5 h-5 text-brand" />
              <span>Identidade Visual & Imagem</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="slug" className="font-semibold">
                  Slug da URL pública *
                </Label>
                <div className="flex items-center">
                  <span className="px-3 py-2 bg-surface-2 border border-r-0 border-border text-xs text-muted-foreground rounded-l-md font-mono">
                    /lp/
                  </span>
                  <Input
                    id="slug"
                    value={formData.slug}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                      })
                    }
                    placeholder="meu-canal"
                    className="rounded-l-none font-mono"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Apenas letras minúsculas, números e traços. Ex: <code>radar-promos</code>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="authorName" className="font-semibold">
                  Nome do Autor / Canal / Marca *
                </Label>
                <Input
                  id="authorName"
                  value={formData.authorName}
                  onChange={(e) => setFormData({ ...formData, authorName: e.target.value })}
                  placeholder="Ex: Pedro Promos ou Canal Tech"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="logoText" className="font-semibold">
                  Texto do Logotipo (Barra Superior)
                </Label>
                <Input
                  id="logoText"
                  value={formData.logoText}
                  onChange={(e) => setFormData({ ...formData, logoText: e.target.value })}
                  placeholder="Ex: PEDRO PROMOS"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="authorBadge" className="font-semibold">
                  Selo de Autoridade (Acima da Foto)
                </Label>
                <Input
                  id="authorBadge"
                  value={formData.authorBadge}
                  onChange={(e) => setFormData({ ...formData, authorBadge: e.target.value })}
                  placeholder="Ex: RADAR VIP · VERIFICADO"
                />
              </div>

              {/* SEÇÃO DE IMAGEM: UPLOAD OU URL */}
              <div className="space-y-3 md:col-span-2 pt-2 border-t border-border">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <Label className="font-semibold text-base flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-brand" />
                      <span>Foto do Criador / Logo da Comunidade</span>
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Você pode enviar um arquivo do seu computador/celular ou colar um link direto de imagem.
                    </p>
                  </div>

                  {/* Seletor de Modo: Upload vs URL */}
                  <div className="inline-flex rounded-lg bg-surface-2 p-1 border border-border text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setImageMode('upload')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                        imageMode === 'upload'
                          ? 'bg-background text-foreground shadow-sm font-bold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload de Arquivo</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageMode('url')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                        imageMode === 'url'
                          ? 'bg-background text-foreground shadow-sm font-bold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <LinkIcon className="w-3.5 h-3.5" />
                      <span>Inserir Link (URL)</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start mt-2">
                  {/* Coluna de Input (Upload ou URL) */}
                  <div className="lg:col-span-8 space-y-3">
                    {imageMode === 'upload' ? (
                      <div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              handleFileSelect(e.target.files[0]);
                            }
                          }}
                        />

                        <div
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragging(true);
                          }}
                          onDragLeave={() => setIsDragging(false)}
                          onDrop={handleDrop}
                          onClick={() => fileInputRef.current?.click()}
                          className={`relative border-2 border-dashed rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                            isDragging
                              ? 'border-brand bg-brand/10 scale-[1.01]'
                              : 'border-border/80 hover:border-brand/60 bg-surface-2/40 hover:bg-surface-2/70'
                          }`}
                        >
                          <div className="w-12 h-12 rounded-2xl bg-brand/15 text-brand flex items-center justify-center mb-3 shadow-inner">
                            {isProcessingImage ? (
                              <RefreshCw className="w-6 h-6 animate-spin" />
                            ) : (
                              <Upload className="w-6 h-6" />
                            )}
                          </div>

                          <span className="text-sm font-bold text-foreground mb-1">
                            {isProcessingImage
                              ? 'Processando e otimizando imagem...'
                              : 'Clique para escolher ou arraste uma foto aqui'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Formatos aceitos: JPG, PNG, WebP, SVG (Otimização automática de resolução)
                          </span>

                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="mt-4 pointer-events-none text-xs"
                          >
                            Selecionar do Computador / Celular
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 p-4 rounded-xl border border-border bg-surface-2/30">
                        <Label htmlFor="authorImageInput" className="text-xs font-semibold">
                          Cole a URL da Imagem (HTTPS)
                        </Label>
                        <Input
                          id="authorImageInput"
                          value={formData.authorImage}
                          onChange={(e) => setFormData({ ...formData, authorImage: e.target.value })}
                          placeholder="https://exemplo.com/minha-foto.jpg"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Certifique-se de que o link termine em formato de imagem válido ou seja acessível publicamente.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Coluna de Preview Visual em Tempo Real */}
                  <div className="lg:col-span-4 p-4 rounded-2xl border border-border bg-surface-2/60 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-bold uppercase text-muted-foreground">
                        Pré-visualização
                      </span>
                      {formData.authorImage && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                          {isImageBase64 ? 'ARQUIVO UPLOAD' : isImageHttp ? 'URL EXTERNA' : 'IMAGEM ATIVA'}
                        </span>
                      )}
                    </div>

                    <div className="relative rounded-xl overflow-hidden border-2 border-white/10 bg-[#0e121a] aspect-[4/5] flex items-center justify-center shadow-lg group">
                      {formData.authorImage ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={formData.authorImage}
                            alt="Preview da foto do autor"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              toast.error('Erro ao carregar a imagem do preview. Verifique o link ou envie outro arquivo.');
                            }}
                          />
                          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black via-black/60 to-transparent" />
                          <div className="absolute bottom-2 left-2 right-2 text-[11px] font-mono font-bold text-white truncate">
                            {formData.authorName || 'Afiliado VIP'}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center p-4 text-center">
                          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-600 to-rose-600 flex items-center justify-center text-white text-xl font-black shadow-lg mb-2">
                            {initials}
                          </div>
                          <span className="text-xs font-bold text-slate-300">
                            {formData.authorName || 'Sem foto cadastrada'}
                          </span>
                          <span className="text-[10px] text-muted-foreground mt-0.5">
                            Emblema padrão com iniciais
                          </span>
                        </div>
                      )}
                    </div>

                    {formData.authorImage && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={handleRemoveImage}
                        className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remover Foto</span>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Seletor de Cores */}
            <div className="pt-4 border-t border-border space-y-3">
              <Label className="font-semibold">Cor de Destaque / Tema Visual</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                {THEME_OPTIONS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setFormData({ ...formData, themeColor: t.id })}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border text-center transition ${
                      formData.themeColor === t.id
                        ? `${t.border} bg-surface-2 shadow-lg ${t.glow} ring-2 ring-offset-2 ring-offset-background`
                        : 'border-border/60 hover:border-border bg-surface'
                    }`}
                  >
                    <span className={`w-6 h-6 rounded-full ${t.bg} shadow-md`} />
                    <span className="text-[11px] font-bold">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ABA: CHAMADA & TEXTOS */}
        {activeTab === 'hero' && (
          <div className="space-y-6 p-6 rounded-2xl bg-surface border border-border">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <FileText className="w-5 h-5 text-brand" />
              <span>Dobra Principal (Hero & Títulos)</span>
            </h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title" className="font-semibold">
                  Título da Aba (SEO & Compartilhamento WhatsApp)
                </Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder={`Grupos VIP de Ofertas e Cupons do ${formData.authorName || 'Afiliado'}`}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="headline" className="font-semibold">
                  Headline de Impacto (Título Principal)
                </Label>
                <Textarea
                  id="headline"
                  rows={2}
                  value={formData.headline}
                  onChange={(e) => setFormData({ ...formData, headline: e.target.value })}
                  placeholder="RECEBA OFERTAS SECRETAS, BUGS DE PREÇO E CUPONS REAIS"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="subheadline" className="font-semibold">
                  Subheadline (Texto Explicativo)
                </Label>
                <Textarea
                  id="subheadline"
                  rows={3}
                  value={formData.subheadline}
                  onChange={(e) => setFormData({ ...formData, subheadline: e.target.value })}
                  placeholder="Pare de pagar caro! Acompanhe em tempo real o radar da nossa equipe garimpando descontos históricos e cupons das grandes lojas."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ctaButtonText" className="font-semibold">
                  Texto do Botão de Entrada
                </Label>
                <Input
                  id="ctaButtonText"
                  value={formData.ctaButtonText}
                  onChange={(e) => setFormData({ ...formData, ctaButtonText: e.target.value })}
                  placeholder="QUERO ENTRAR NOS GRUPOS VIP"
                />
              </div>
            </div>
          </div>
        )}

        {/* ABA: NÚMEROS & PROVA SOCIAL */}
        {activeTab === 'stats' && (
          <div className="space-y-6 p-6 rounded-2xl bg-surface border border-border">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-brand" />
              <span>Números de Autoridade & Prova Social</span>
            </h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="authorBio" className="font-semibold">
                  Mini Biografia / Descrição de Autoridade
                </Label>
                <Textarea
                  id="authorBio"
                  rows={4}
                  value={formData.authorBio}
                  onChange={(e) => setFormData({ ...formData, authorBio: e.target.value })}
                  placeholder="Conte um pouco sobre sua trajetória, seu canal ou o compromisso da sua comunidade em encontrar ofertas de verdade sem golpes."
                />
              </div>

              <div className="pt-4 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-border space-y-2">
                  <span className="text-xs font-mono font-bold text-muted-foreground uppercase">Card 1</span>
                  <Input
                    value={formData.stat1Value}
                    onChange={(e) => setFormData({ ...formData, stat1Value: e.target.value })}
                    placeholder="+10K"
                    className="font-black text-lg"
                  />
                  <Input
                    value={formData.stat1Label}
                    onChange={(e) => setFormData({ ...formData, stat1Label: e.target.value })}
                    placeholder="Membros VIP"
                    className="text-xs text-muted-foreground"
                  />
                </div>

                <div className="p-4 rounded-xl border border-border space-y-2">
                  <span className="text-xs font-mono font-bold text-muted-foreground uppercase">Card 2</span>
                  <Input
                    value={formData.stat2Value}
                    onChange={(e) => setFormData({ ...formData, stat2Value: e.target.value })}
                    placeholder="R$ 500K+"
                    className="font-black text-lg text-emerald-400"
                  />
                  <Input
                    value={formData.stat2Label}
                    onChange={(e) => setFormData({ ...formData, stat2Label: e.target.value })}
                    placeholder="Economia Gerada"
                    className="text-xs text-muted-foreground"
                  />
                </div>

                <div className="p-4 rounded-xl border border-border space-y-2">
                  <span className="text-xs font-mono font-bold text-muted-foreground uppercase">Card 3</span>
                  <Input
                    value={formData.stat3Value}
                    onChange={(e) => setFormData({ ...formData, stat3Value: e.target.value })}
                    placeholder="100%"
                    className="font-black text-lg text-brand"
                  />
                  <Input
                    value={formData.stat3Label}
                    onChange={(e) => setFormData({ ...formData, stat3Label: e.target.value })}
                    placeholder="Links Verificados"
                    className="text-xs text-muted-foreground"
                  />
                </div>

                <div className="p-4 rounded-xl border border-border space-y-2">
                  <span className="text-xs font-mono font-bold text-muted-foreground uppercase">Card 4</span>
                  <Input
                    value={formData.stat4Value}
                    onChange={(e) => setFormData({ ...formData, stat4Value: e.target.value })}
                    placeholder="24/7"
                    className="font-black text-lg text-cyan-400"
                  />
                  <Input
                    value={formData.stat4Label}
                    onChange={(e) => setFormData({ ...formData, stat4Label: e.target.value })}
                    placeholder="Radar Ativo"
                    className="text-xs text-muted-foreground"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ABA: REDES SOCIAIS */}
        {activeTab === 'redes' && (
          <div className="space-y-6 p-6 rounded-2xl bg-surface border border-border">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Share2 className="w-5 h-5 text-brand" />
              <span>Redes Sociais & Canais Externos</span>
            </h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="instagramUrl" className="font-semibold">
                  Perfil no Instagram (opcional)
                </Label>
                <Input
                  id="instagramUrl"
                  value={formData.instagramUrl}
                  onChange={(e) => setFormData({ ...formData, instagramUrl: e.target.value })}
                  placeholder="https://instagram.com/seu_perfil"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="youtubeUrl" className="font-semibold">
                  Canal no YouTube (opcional)
                </Label>
                <Input
                  id="youtubeUrl"
                  value={formData.youtubeUrl}
                  onChange={(e) => setFormData({ ...formData, youtubeUrl: e.target.value })}
                  placeholder="https://youtube.com/@seu_canal"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="telegramUrl" className="font-semibold">
                  Canal no Telegram (opcional)
                </Label>
                <Input
                  id="telegramUrl"
                  value={formData.telegramUrl}
                  onChange={(e) => setFormData({ ...formData, telegramUrl: e.target.value })}
                  placeholder="https://t.me/seu_canal"
                />
              </div>
            </div>
          </div>
        )}

        {/* ABA: SEÇÕES DA PÁGINA */}
        {activeTab === 'secoes' && (
          <div className="space-y-6 p-6 rounded-2xl bg-surface border border-border">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Sliders className="w-5 h-5 text-brand" />
              <span>Controle de Visibilidade & Status</span>
            </h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl border border-border">
                <div className="space-y-0.5">
                  <span className="text-sm font-bold">Página Ativa e Publicada</span>
                  <p className="text-xs text-muted-foreground">
                    Quando desativada, os visitantes receberão um aviso de página temporariamente pausada.
                  </p>
                </div>
                <Switch
                  checked={formData.enabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-border">
                <div className="space-y-0.5">
                  <span className="text-sm font-bold">Seção "Para quem é a nossa comunidade?"</span>
                  <p className="text-xs text-muted-foreground">
                    Cards explicativos sobre menores preços reais, cupons secretos e segurança.
                  </p>
                </div>
                <Switch
                  checked={formData.showBenefits}
                  onCheckedChange={(checked) => setFormData({ ...formData, showBenefits: checked })}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-border">
                <div className="space-y-0.5">
                  <span className="text-sm font-bold">Seção de Autoridade & Métricas</span>
                  <p className="text-xs text-muted-foreground">
                    Exibe sua biografia e os 4 números de autoridade configurados.
                  </p>
                </div>
                <Switch
                  checked={formData.showAuthority}
                  onCheckedChange={(checked) => setFormData({ ...formData, showAuthority: checked })}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-border">
                <div className="space-y-0.5">
                  <span className="text-sm font-bold">Seção "Matriz de Categorias"</span>
                  <p className="text-xs text-muted-foreground">
                    Smartphones, Notebooks, Casa Inteligente, Áudio e Cupons.
                  </p>
                </div>
                <Switch
                  checked={formData.showCategories}
                  onCheckedChange={(checked) => setFormData({ ...formData, showCategories: checked })}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-border">
                <div className="space-y-0.5">
                  <span className="text-sm font-bold">Seção de Dúvidas Frequentes (FAQ)</span>
                  <p className="text-xs text-muted-foreground">
                    Respostas sobre gratuidade dos grupos, segurança dos links e funcionamento.
                  </p>
                </div>
                <Switch
                  checked={formData.showFaq}
                  onCheckedChange={(checked) => setFormData({ ...formData, showFaq: checked })}
                />
              </div>
            </div>
          </div>
        )}

        {/* Rodapé de Ações */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold px-8 py-3"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Salvando alterações...' : 'Salvar Landing Page'}</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
