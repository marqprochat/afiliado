'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  ExternalLink,
  Copy,
  Check,
  Save,
  Globe,
  Palette,
  FileText,
  HelpCircle,
  Sliders,
  Upload,
  Link as LinkIcon,
  Trash2,
  Image as ImageIcon,
  RotateCcw,
  Sun,
  Moon,
  MessageCircle,
  Eye,
  Plus,
  Layers,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { apiFetch } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { AuraLandingView } from '@/components/aura-landing/AuraLandingView';
import type {
  ThemeColor,
  ThemeMode,
  ButtonColor,
  AuraNicheItem,
  AuraStepItem,
  AuraFaqItem,
} from '@afilados/shared';
import {
  AURA_DEFAULT_HERO_IMAGE,
  AURA_DEFAULT_NICHES,
  AURA_DEFAULT_STEPS,
  AURA_DEFAULT_FAQS,
  THEME_COLORS,
  BUTTON_COLORS,
} from '@afilados/shared';

const THEME_PRESETS: { id: ThemeColor; name: string; colorHex: string }[] = [
  { id: 'rose', name: 'Rosé Aura (Padrão)', colorHex: '#f43f5e' },
  { id: 'red', name: 'Vermelho Fogo', colorHex: '#ef4444' },
  { id: 'emerald', name: 'Verde Esmeralda', colorHex: '#10b981' },
  { id: 'cyan', name: 'Ciano Cyber', colorHex: '#06b6d4' },
  { id: 'blue', name: 'Azul Royal', colorHex: '#3b82f6' },
  { id: 'violet', name: 'Roxo Elétrico', colorHex: '#8b5cf6' },
  { id: 'amber', name: 'Âmbar Dourado', colorHex: '#f59e0b' },
];

const BUTTON_PRESETS: { id: ButtonColor; name: string; colorHex: string; desc: string }[] = [
  { id: 'emerald', name: 'Verde WhatsApp', colorHex: '#10b981', desc: 'Recomendado (Maior taxa de cliques)' },
  { id: 'theme', name: 'Mesma cor do tema', colorHex: '#64748b', desc: 'Harmoniza com a cor de destaque' },
  { id: 'rose', name: 'Rosé', colorHex: '#f43f5e', desc: 'Vibrante e delicado' },
  { id: 'red', name: 'Vermelho', colorHex: '#ef4444', desc: 'Alta urgência e impacto' },
  { id: 'blue', name: 'Azul', colorHex: '#3b82f6', desc: 'Moderno e profissional' },
  { id: 'violet', name: 'Roxo', colorHex: '#8b5cf6', desc: 'Exclusivo e premium' },
  { id: 'amber', name: 'Âmbar / Dourado', colorHex: '#f59e0b', desc: 'Destaque e calor' },
  { id: 'cyan', name: 'Ciano', colorHex: '#06b6d4', desc: 'Cyber e tech' },
  { id: 'dark', name: 'Dark / Preto', colorHex: '#171717', desc: 'Minimalista refinado' },
];

/** Otimiza fotos grandes redimensionando proporcionalmente para no máximo 1200x1200px */
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
        const MAX_DIM = 1200;
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
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
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
  const [activeTab, setActiveTab] = useState<'geral' | 'hero' | 'nichos' | 'comofunciona' | 'faq' | 'rodape' | 'preview'>('geral');

  // Imagem Hero
  const [heroImageMode, setHeroImageMode] = useState<'upload' | 'url'>('upload');
  const [isProcessingHero, setIsProcessingHero] = useState(false);
  const heroFileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    slug: '',
    enabled: true,
    title: 'Clube de Preços VIP · Grupos de Ofertas e Cupons no WhatsApp',
    authorName: 'Clube de Preços VIP',
    logoText: 'CLUBE DE PREÇOS VIP',
    themeColor: 'rose' as ThemeColor,
    themeMode: 'light' as ThemeMode,
    buttonColor: 'emerald' as ButtonColor,

    // Hero
    heroImage: AURA_DEFAULT_HERO_IMAGE,
    badgeText: 'Grupos de Preços & Ofertas VIP · 100% Gratuito',
    headline: 'Os melhores achadinhos e cupons secretos no seu WhatsApp',
    subheadline:
      'Rastreamos bugs de preço, descontos relâmpago e promoções exclusivas em grandes lojas. Escolha seu nicho abaixo e entre no grupo do WhatsApp!',
    floatingBadgeText: 'Garimpo Ao Vivo no WhatsApp · 4 Nichos Exclusivos',
    ctaButtonText: 'Entrar no Grupo do WhatsApp',
    reassuranceText:
      '100% Silencioso (sem conversas paralelas) · Apenas administradores postam · Gratuito para sempre',
    whatsappGeneralUrl: '',

    // Nichos
    showNiches: true,
    customNiches: AURA_DEFAULT_NICHES as AuraNicheItem[],

    // Como Funciona
    showHowItWorks: true,
    howItWorksTitle: 'Como funcionam os nossos grupos de preço',
    howItWorksSubtitle:
      'Economizar não precisa dar trabalho. Nós fazemos a busca exaustiva para você apenas aproveitar.',
    howItWorksSteps: AURA_DEFAULT_STEPS as AuraStepItem[],

    // FAQ
    showFaq: true,
    faqTitle: 'Tudo o que você precisa saber sobre os grupos',
    faqSubtitle: 'Respostas diretas e transparentes para você entrar com total tranquilidade.',
    faqItems: AURA_DEFAULT_FAQS as AuraFaqItem[],
    faqBannerTitle: 'Quer entrar no Grupo Geral com todos os nichos juntos?',
    faqBannerText:
      'Se você prefere receber todos os achadinhos em um único grupo, temos o Grupo Geral VIP no WhatsApp ativo.',
    faqBannerButtonText: 'Entrar no WhatsApp Geral',

    // Rodapé
    footerText:
      'A curadoria independente de promoções, cupons e achadinhos nos melhores e-commerces do Brasil.',

    // Redes Sociais
    instagramUrl: '',
    youtubeUrl: '',
    telegramUrl: '',
  });

  useEffect(() => {
    async function loadData() {
      try {
        const res = await apiFetch<{ ok: boolean; data: any }>('/affiliate-landing');
        if (res.ok && res.data) {
          const d = res.data;
          setFormData({
            slug: d.slug || '',
            enabled: d.enabled ?? true,
            title: d.title || 'Clube de Preços VIP · Grupos de Ofertas e Cupons no WhatsApp',
            authorName: d.authorName || 'Clube de Preços VIP',
            logoText: d.logoText || 'CLUBE DE PREÇOS VIP',
            themeColor: (d.themeColor as ThemeColor) || 'rose',
            themeMode: (d.themeMode as ThemeMode) || 'light',
            buttonColor: (d.buttonColor as ButtonColor) || 'emerald',

            heroImage: d.heroImage || AURA_DEFAULT_HERO_IMAGE,
            badgeText: d.badgeText || 'Grupos de Preços & Ofertas VIP · 100% Gratuito',
            headline: d.headline || 'Os melhores achadinhos e cupons secretos no seu WhatsApp',
            subheadline:
              d.subheadline ||
              'Rastreamos bugs de preço, descontos relâmpago e promoções exclusivas em grandes lojas. Escolha seu nicho abaixo e entre no grupo do WhatsApp!',
            floatingBadgeText: d.floatingBadgeText || 'Garimpo Ao Vivo no WhatsApp · 4 Nichos Exclusivos',
            ctaButtonText: d.ctaButtonText || 'Entrar no Grupo do WhatsApp',
            reassuranceText:
              d.reassuranceText ||
              '100% Silencioso (sem conversas paralelas) · Apenas administradores postam · Gratuito para sempre',
            whatsappGeneralUrl: d.whatsappGeneralUrl || '',

            showNiches: d.showNiches ?? true,
            customNiches: (Array.isArray(d.customNiches) && d.customNiches.length > 0)
              ? d.customNiches
              : AURA_DEFAULT_NICHES,

            showHowItWorks: d.showHowItWorks ?? true,
            howItWorksTitle: d.howItWorksTitle || 'Como funcionam os nossos grupos de preço',
            howItWorksSubtitle:
              d.howItWorksSubtitle ||
              'Economizar não precisa dar trabalho. Nós fazemos a busca exaustiva para você apenas aproveitar.',
            howItWorksSteps: (Array.isArray(d.howItWorksSteps) && d.howItWorksSteps.length > 0)
              ? d.howItWorksSteps
              : AURA_DEFAULT_STEPS,

            showFaq: d.showFaq ?? true,
            faqTitle: d.faqTitle || 'Tudo o que você precisa saber sobre os grupos',
            faqSubtitle:
              d.faqSubtitle ||
              'Respostas diretas e transparentes para você entrar com total tranquilidade.',
            faqItems: (Array.isArray(d.faqItems) && d.faqItems.length > 0)
              ? d.faqItems
              : AURA_DEFAULT_FAQS,
            faqBannerTitle:
              d.faqBannerTitle || 'Quer entrar no Grupo Geral com todos os nichos juntos?',
            faqBannerText:
              d.faqBannerText ||
              'Se você prefere receber todos os achadinhos em um único grupo, temos o Grupo Geral VIP no WhatsApp ativo.',
            faqBannerButtonText: d.faqBannerButtonText || 'Entrar no WhatsApp Geral',

            footerText:
              d.footerText ||
              'A curadoria independente de promoções, cupons e achadinhos nos melhores e-commerces do Brasil.',

            instagramUrl: d.instagramUrl || '',
            youtubeUrl: d.youtubeUrl || '',
            telegramUrl: d.telegramUrl || '',
          });

          if (d.heroImage?.startsWith('http://') || d.heroImage?.startsWith('https://')) {
            setHeroImageMode('url');
          } else {
            setHeroImageMode('upload');
          }
        }
      } catch (err) {
        toast.error('Erro ao carregar dados da landing page');
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

  const handleHeroFileSelect = async (file?: File) => {
    if (!file) return;
    setIsProcessingHero(true);
    try {
      const dataUrl = await processImageFile(file);
      setFormData((prev) => ({ ...prev, heroImage: dataUrl }));
      toast.success('Foto do Hero carregada e otimizada com sucesso!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao processar imagem');
    } finally {
      setIsProcessingHero(false);
    }
  };

  const handleResetHeroImage = () => {
    setFormData((prev) => ({ ...prev, heroImage: AURA_DEFAULT_HERO_IMAGE }));
    if (heroFileInputRef.current) heroFileInputRef.current.value = '';
    toast.info('Foto restaurada para a imagem padrão da Aura.');
  };

  const handleResetNiches = () => {
    setFormData((prev) => ({ ...prev, customNiches: AURA_DEFAULT_NICHES }));
    toast.success('Nichos restaurados para os 4 nichos originais do modelo Aura!');
  };

  const handleResetSteps = () => {
    setFormData((prev) => ({ ...prev, howItWorksSteps: AURA_DEFAULT_STEPS }));
    toast.success('Passos de "Como Funciona" restaurados!');
  };

  const handleResetFaqs = () => {
    setFormData((prev) => ({ ...prev, faqItems: AURA_DEFAULT_FAQS }));
    toast.success('Perguntas frequentes restauradas para o padrão Aura!');
  };

  const handleAddFaq = () => {
    setFormData((prev) => ({
      ...prev,
      faqItems: [
        ...prev.faqItems,
        {
          question: 'Nova pergunta frequente?',
          answer: 'Digite aqui a resposta explicativa para os membros.',
        },
      ],
    }));
  };

  const handleRemoveFaq = (idx: number) => {
    setFormData((prev) => ({
      ...prev,
      faqItems: prev.faqItems.filter((_, i) => i !== idx),
    }));
  };

  const handleFaqChange = (idx: number, field: 'question' | 'answer', value: string) => {
    setFormData((prev) => {
      const updated = [...prev.faqItems];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, faqItems: updated };
    });
  };

  const handleNicheChange = (idx: number, field: keyof AuraNicheItem, value: any) => {
    setFormData((prev) => {
      const updated = [...prev.customNiches];
      updated[idx] = { ...updated[idx], [field]: value };
      return { ...prev, customNiches: updated };
    });
  };

  const handleNicheTagsChange = (idx: number, tagsString: string) => {
    const tags = tagsString
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    handleNicheChange(idx, 'popularItems', tags);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.slug.trim()) {
      toast.error('Informe um slug para a URL da página');
      return;
    }
    if (!formData.authorName.trim()) {
      toast.error('Informe o nome da marca ou canal');
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

  if (loading) {
    return (
      <div className="p-12 text-center text-muted-foreground animate-pulse">
        Carregando configurações da landing page...
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-rose-500/10 text-rose-500 text-xs font-mono font-bold uppercase tracking-wider mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>MODELO AURA · CLUBE DE PREÇOS VIP</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight">Minha Landing Page</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure cada detalhe da sua página de captura com nichos em círculos, modo Dark/Light e cores personalizadas.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => window.open(`/lp/${formData.slug}`, '_blank')}
            className="flex items-center gap-2 text-xs"
            disabled={!formData.slug}
          >
            <ExternalLink className="w-4 h-4" />
            <span>Abrir no Ar</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => setActiveTab(activeTab === 'preview' ? 'geral' : 'preview')}
            className="flex items-center gap-2 text-xs"
          >
            <Eye className="w-4 h-4" />
            <span>{activeTab === 'preview' ? 'Voltar ao Editor' : 'Pré-visualizar'}</span>
          </Button>

          <Button
            onClick={() => handleSubmit()}
            disabled={saving}
            className="flex items-center gap-2 bg-gradient-to-r from-rose-600 via-pink-600 to-rose-500 hover:from-rose-500 hover:to-pink-500 text-white font-bold text-xs"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Salvando...' : 'Salvar Alterações'}</span>
          </Button>
        </div>
      </div>

      {/* URL Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-[#101420] to-slate-900 border border-border shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${formData.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-xs font-mono text-slate-300 font-semibold uppercase tracking-wider">
              {formData.enabled ? 'Página Publicada e Ativa' : 'Página Pausada'}
            </span>
          </div>
          <div className="text-sm sm:text-base font-mono font-bold text-white break-all">
            {publicUrl}
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700">
            <Label htmlFor="page-enabled-switch" className="text-xs font-medium text-slate-300 cursor-pointer">
              {formData.enabled ? 'Ativa' : 'Pausada'}
            </Label>
            <Switch
              id="page-enabled-switch"
              checked={formData.enabled}
              onCheckedChange={(c) => setFormData({ ...formData, enabled: c })}
            />
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={handleCopyLink}
            className="flex items-center gap-2 text-xs"
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
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
            activeTab === 'geral' ? 'bg-rose-500/15 text-rose-500 border border-rose-500/30' : 'text-muted-foreground hover:bg-surface-2'
          }`}
        >
          <Palette className="w-4 h-4" />
          <span>Marca & Cores (Dark/Light)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('hero')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
            activeTab === 'hero' ? 'bg-rose-500/15 text-rose-500 border border-rose-500/30' : 'text-muted-foreground hover:bg-surface-2'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Hero & Foto Principal</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('nichos')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
            activeTab === 'nichos' ? 'bg-rose-500/15 text-rose-500 border border-rose-500/30' : 'text-muted-foreground hover:bg-surface-2'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Grupos & Nichos</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('comofunciona')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
            activeTab === 'comofunciona' ? 'bg-rose-500/15 text-rose-500 border border-rose-500/30' : 'text-muted-foreground hover:bg-surface-2'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Como Funciona (3 Passos)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('faq')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
            activeTab === 'faq' ? 'bg-rose-500/15 text-rose-500 border border-rose-500/30' : 'text-muted-foreground hover:bg-surface-2'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          <span>Perguntas Frequentes (FAQ)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('rodape')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
            activeTab === 'rodape' ? 'bg-rose-500/15 text-rose-500 border border-rose-500/30' : 'text-muted-foreground hover:bg-surface-2'
          }`}
        >
          <Globe className="w-4 h-4" />
          <span>Rodapé</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('preview')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
            activeTab === 'preview' ? 'bg-brand/20 text-brand border border-brand/40' : 'text-muted-foreground hover:bg-surface-2'
          }`}
        >
          <Eye className="w-4 h-4" />
          <span>Pré-visualização Ao Vivo</span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* ABA 1: MARCA & CORES (DARK/LIGHT + BOTÕES)                     */}
      {/* ============================================================== */}
      {activeTab === 'geral' && (
        <div className="space-y-8 p-6 sm:p-8 rounded-3xl bg-surface border border-border shadow-sm">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Palette className="w-5 h-5 text-rose-500" />
              <span>Identidade, Modo Dark e Paleta de Cores</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Personalize o endereço da página, o modo de iluminação e as cores de destaque e botões.
            </p>
          </div>

          {/* MODO DA PÁGINA: CLARO OU ESCURO */}
          <div className="space-y-3">
            <Label className="text-sm font-bold flex items-center gap-2">
              <span>Modo da Página (Aparência)</span>
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div
                onClick={() => setFormData({ ...formData, themeMode: 'light' })}
                className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center gap-4 ${
                  formData.themeMode === 'light'
                    ? 'border-rose-500 bg-rose-500/5 shadow-md shadow-rose-500/10'
                    : 'border-border hover:border-muted-foreground/40 bg-surface-2'
                }`}
              >
                <div className="w-12 h-12 rounded-xl bg-white border border-rose-200 flex items-center justify-center text-rose-500 shadow-sm shrink-0">
                  <Sun className="w-6 h-6" />
                </div>
                <div>
                  <div className="font-bold text-sm flex items-center gap-2">
                    <span>Modo Claro (Light)</span>
                    {formData.themeMode === 'light' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500 text-white">
                        Ativo
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Fundo branco e rosé suave, visual clean idêntico ao modelo Aura de referência.
                  </p>
                </div>
              </div>

              <div
                onClick={() => setFormData({ ...formData, themeMode: 'dark' })}
                className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center gap-4 ${
                  formData.themeMode === 'dark'
                    ? 'border-rose-500 bg-rose-500/5 shadow-md shadow-rose-500/10'
                    : 'border-border hover:border-muted-foreground/40 bg-surface-2'
                }`}
              >
                <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-rose-400 shadow-sm shrink-0">
                  <Moon className="w-6 h-6" />
                </div>
                <div>
                  <div className="font-bold text-sm flex items-center gap-2">
                    <span>Modo Escuro (Dark)</span>
                    {formData.themeMode === 'dark' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500 text-white">
                        Ativo
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Fundo escuro profundo com efeitos neon, ideal para estética tech e economia de bateria.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* COR DE DESTAQUE (ACCENT) */}
          <div className="space-y-3">
            <Label className="text-sm font-bold">
              Cor de Destaque da Página (Acentos & Badges)
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
              {THEME_PRESETS.map((p) => {
                const isSelected = formData.themeColor === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setFormData({ ...formData, themeColor: p.id })}
                    className={`p-3 rounded-2xl border text-center transition-all flex flex-col items-center gap-2 cursor-pointer ${
                      isSelected
                        ? 'border-rose-500 ring-2 ring-rose-500/20 bg-rose-500/5'
                        : 'border-border hover:border-muted-foreground/40 bg-surface-2'
                    }`}
                  >
                    <div
                      className="w-7 h-7 rounded-full shadow-sm flex items-center justify-center text-white"
                      style={{ backgroundColor: p.colorHex }}
                    >
                      {isSelected && <Check className="w-4 h-4 stroke-[3]" />}
                    </div>
                    <span className="text-xs font-semibold leading-tight">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* COR DOS BOTÕES DE AÇÃO (CTA) */}
          <div className="space-y-3">
            <div>
              <Label className="text-sm font-bold flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-emerald-500" />
                <span>Cor dos Botões de Ação (CTA WhatsApp)</span>
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Escolha a cor que os botões de entrar no WhatsApp terão na sua landing page.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {BUTTON_PRESETS.map((bp) => {
                const isSelected = formData.buttonColor === bp.id;
                return (
                  <div
                    key={bp.id}
                    onClick={() => setFormData({ ...formData, buttonColor: bp.id })}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center gap-3 ${
                      isSelected
                        ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-500/5 shadow-xs'
                        : 'border-border hover:border-muted-foreground/40 bg-surface-2'
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-xl shadow-xs shrink-0 flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: bp.colorHex }}
                    >
                      {isSelected ? <Check className="w-4 h-4" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xs truncate">{bp.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{bp.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border">
            <div className="space-y-2">
              <Label htmlFor="slug" className="font-semibold text-xs">
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
                  className="rounded-l-none font-mono text-xs"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Exemplo: <code>clube-vip</code> gerará <code>/lp/clube-vip</code>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="authorName" className="font-semibold text-xs">
                Nome do Autor / Canal / Marca *
              </Label>
              <Input
                id="authorName"
                value={formData.authorName}
                onChange={(e) => setFormData({ ...formData, authorName: e.target.value })}
                placeholder="Ex: Clube de Preços VIP"
                className="text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="logoText" className="font-semibold text-xs">
                Texto do Logo (Navbar & Rodapé)
              </Label>
              <Input
                id="logoText"
                value={formData.logoText}
                onChange={(e) => setFormData({ ...formData, logoText: e.target.value })}
                placeholder="Ex: CLUBE DE PREÇOS VIP"
                className="text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="title" className="font-semibold text-xs">
                Título da Página (SEO / Aba do Navegador)
              </Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Ex: Clube de Preços VIP · Ofertas e Cupons no WhatsApp"
                className="text-xs"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="whatsappGeneralUrl" className="font-semibold text-xs flex items-center gap-1.5">
                <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
                <span>Link Geral do WhatsApp (Opcional - para o botão do topo e banner do rodapé)</span>
              </Label>
              <Input
                id="whatsappGeneralUrl"
                value={formData.whatsappGeneralUrl}
                onChange={(e) => setFormData({ ...formData, whatsappGeneralUrl: e.target.value })}
                placeholder="https://chat.whatsapp.com/invite/..."
                className="text-xs font-mono"
              />
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 2: HERO & FOTO PRINCIPAL                                   */}
      {/* ============================================================== */}
      {activeTab === 'hero' && (
        <div className="space-y-8 p-6 sm:p-8 rounded-3xl bg-surface border border-border shadow-sm">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <FileText className="w-5 h-5 text-rose-500" />
              <span>Dobra Principal (Hero Section)</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Personalize a foto principal de destaque, títulos chamativos e selos de garantia.
            </p>
          </div>

          {/* FOTO PRINCIPAL GRANDE */}
          <div className="space-y-4 p-5 rounded-2xl bg-surface-2 border border-border">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <Label className="text-sm font-bold flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-rose-500" />
                  <span>Foto Principal Grande do Hero</span>
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Esta foto emerge suavemente com efeito de luz difusa e máscara de fade idêntica ao modelo Aura.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleResetHeroImage}
                  className="text-xs flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Usar Foto Padrão da Aura</span>
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
              {/* Preview da foto */}
              <div className="md:col-span-4 flex justify-center">
                <div className="relative w-44 h-56 rounded-2xl overflow-hidden border border-border bg-slate-900/50 flex items-center justify-center shadow-lg group">
                  <img
                    src={formData.heroImage || AURA_DEFAULT_HERO_IMAGE}
                    alt="Preview Hero"
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute inset-0 bg-neutral-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
                    Preview do Hero
                  </div>
                </div>
              </div>

              {/* Controles de upload / url */}
              <div className="md:col-span-8 space-y-4">
                <div className="flex items-center gap-2 border-b border-border pb-2">
                  <button
                    type="button"
                    onClick={() => setHeroImageMode('upload')}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
                      heroImageMode === 'upload' ? 'bg-rose-500 text-white' : 'text-muted-foreground hover:bg-surface'
                    }`}
                  >
                    Upload do Computador
                  </button>
                  <button
                    type="button"
                    onClick={() => setHeroImageMode('url')}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition ${
                      heroImageMode === 'url' ? 'bg-rose-500 text-white' : 'text-muted-foreground hover:bg-surface'
                    }`}
                  >
                    Link de Imagem (URL)
                  </button>
                </div>

                {heroImageMode === 'upload' ? (
                  <div className="space-y-3">
                    <input
                      ref={heroFileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleHeroFileSelect(e.target.files?.[0])}
                    />
                    <div
                      onClick={() => heroFileInputRef.current?.click()}
                      className="border-2 border-dashed border-border hover:border-rose-500 rounded-2xl p-6 text-center cursor-pointer transition bg-surface hover:bg-rose-500/5"
                    >
                      <Upload className="w-8 h-8 text-rose-500 mx-auto mb-2" />
                      <div className="text-xs font-bold">
                        {isProcessingHero ? 'Otimizando foto...' : 'Clique para selecionar uma foto'}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        JPG, PNG ou WEBP. A imagem é comprimida automaticamente.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="hero-url" className="text-xs font-semibold">
                      URL direta da imagem
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="hero-url"
                        value={formData.heroImage}
                        onChange={(e) => setFormData({ ...formData, heroImage: e.target.value })}
                        placeholder="https://exemplo.com/foto.jpg"
                        className="text-xs font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* TEXTOS DO HERO */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="badgeText" className="text-xs font-semibold">
                Selo Superior (Badge do Hero)
              </Label>
              <Input
                id="badgeText"
                value={formData.badgeText}
                onChange={(e) => setFormData({ ...formData, badgeText: e.target.value })}
                placeholder="Ex: Grupos de Preços & Ofertas VIP · 100% Gratuito"
                className="text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="headline" className="text-xs font-semibold">
                Título Principal (Headline) *
              </Label>
              <Input
                id="headline"
                value={formData.headline}
                onChange={(e) => setFormData({ ...formData, headline: e.target.value })}
                placeholder="Ex: Os melhores achadinhos e cupons secretos no seu WhatsApp"
                className="text-xs font-bold"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subheadline" className="text-xs font-semibold">
                Subtítulo Explicativo (Subheadline)
              </Label>
              <Textarea
                id="subheadline"
                rows={3}
                value={formData.subheadline}
                onChange={(e) => setFormData({ ...formData, subheadline: e.target.value })}
                placeholder="Ex: Rastreamos bugs de preço, descontos relâmpago e promoções exclusivas em grandes lojas..."
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="floatingBadgeText" className="text-xs font-semibold">
                  Selo Flutuante sobre a Foto
                </Label>
                <Input
                  id="floatingBadgeText"
                  value={formData.floatingBadgeText}
                  onChange={(e) => setFormData({ ...formData, floatingBadgeText: e.target.value })}
                  placeholder="Ex: Garimpo Ao Vivo no WhatsApp · 4 Nichos Exclusivos"
                  className="text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ctaButtonText" className="text-xs font-semibold">
                  Texto do Botão de Entrada (CTA)
                </Label>
                <Input
                  id="ctaButtonText"
                  value={formData.ctaButtonText}
                  onChange={(e) => setFormData({ ...formData, ctaButtonText: e.target.value })}
                  placeholder="Ex: Entrar no Grupo do WhatsApp"
                  className="text-xs"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="reassuranceText" className="text-xs font-semibold">
                  Texto de Garantia / Reassurance (Abaixo do Botão)
                </Label>
                <Input
                  id="reassuranceText"
                  value={formData.reassuranceText}
                  onChange={(e) => setFormData({ ...formData, reassuranceText: e.target.value })}
                  placeholder="Ex: 100% Silencioso (sem conversas paralelas) · Apenas administradores postam · Gratuito para sempre"
                  className="text-xs"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 3: GRUPOS & NICHOS                                         */}
      {/* ============================================================== */}
      {activeTab === 'nichos' && (
        <div className="space-y-8 p-6 sm:p-8 rounded-3xl bg-surface border border-border shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Layers className="w-5 h-5 text-rose-500" />
                <span>Grupos de Nicho (Círculos & Cards)</span>
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Configure os nichos que aparecem tanto nos círculos clicáveis ao lado da foto quanto na grade completa.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 rounded-xl border border-border">
                <Label htmlFor="show-niches-switch" className="text-xs font-medium cursor-pointer">
                  Exibir Nichos na Página
                </Label>
                <Switch
                  id="show-niches-switch"
                  checked={formData.showNiches}
                  onCheckedChange={(c) => setFormData({ ...formData, showNiches: c })}
                />
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetNiches}
                className="text-xs flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restaurar 4 Nichos Aura</span>
              </Button>
            </div>
          </div>

          {/* LISTA DOS NICHOS */}
          <div className="space-y-6">
            {formData.customNiches.map((niche, idx) => (
              <div
                key={niche.id || idx}
                className="p-5 sm:p-6 rounded-2xl bg-surface-2 border border-border space-y-4"
              >
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-rose-400 shrink-0 shadow-xs">
                      <img
                        src={niche.image}
                        alt={niche.name}
                        className="w-full h-full object-cover object-top"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider">
                        Nicho #{niche.orderNumber || `0${idx + 1}`}
                      </span>
                      <div className="font-bold text-sm">{niche.name}</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Nome do Nicho</Label>
                    <Input
                      value={niche.name}
                      onChange={(e) => handleNicheChange(idx, 'name', e.target.value)}
                      placeholder="Ex: BELEZA, COSMÉTICOS E CUIDADO"
                      className="text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Categoria / Badge</Label>
                    <Input
                      value={niche.categoryBadge}
                      onChange={(e) => handleNicheChange(idx, 'categoryBadge', e.target.value)}
                      placeholder="Ex: Beleza & Cuidados"
                      className="text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">URL da Imagem Redonda</Label>
                    <Input
                      value={niche.image}
                      onChange={(e) => handleNicheChange(idx, 'image', e.target.value)}
                      placeholder="/assets/landing/niche-beleza.jpg"
                      className="text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2 md:col-span-3">
                    <Label className="text-xs font-semibold">Descrição Destacada do Grupo</Label>
                    <Textarea
                      rows={2}
                      value={niche.description}
                      onChange={(e) => handleNicheChange(idx, 'description', e.target.value)}
                      placeholder="Ex: Grupo para produtos indispensáveis para mulheres, de cosméticos até cuidados íntimos!"
                      className="text-xs"
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs font-semibold">
                      Itens Mais Postados com Desconto (Tags separadas por vírgula)
                    </Label>
                    <Input
                      value={niche.popularItems?.join(', ') || ''}
                      onChange={(e) => handleNicheTagsChange(idx, e.target.value)}
                      placeholder="Perfumes Importados, Skincare, Cuidados Íntimos"
                      className="text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Link Direto do WhatsApp (Opcional)</Label>
                    <Input
                      value={niche.whatsappLink || ''}
                      onChange={(e) => handleNicheChange(idx, 'whatsappLink', e.target.value)}
                      placeholder="https://chat.whatsapp.com/..."
                      className="text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 4: COMO FUNCIONA (3 PASSOS)                                */}
      {/* ============================================================== */}
      {activeTab === 'comofunciona' && (
        <div className="space-y-8 p-6 sm:p-8 rounded-3xl bg-surface border border-border shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Sliders className="w-5 h-5 text-rose-500" />
                <span>Seção: Como Funciona</span>
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Apresente aos visitantes os 3 passos simples de como funcionam os seus grupos.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 rounded-xl border border-border">
                <Label htmlFor="show-how-switch" className="text-xs font-medium cursor-pointer">
                  Exibir Seção
                </Label>
                <Switch
                  id="show-how-switch"
                  checked={formData.showHowItWorks}
                  onCheckedChange={(c) => setFormData({ ...formData, showHowItWorks: c })}
                />
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetSteps}
                className="text-xs flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restaurar Passos Aura</span>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="howTitle" className="text-xs font-semibold">
                Título da Seção
              </Label>
              <Input
                id="howTitle"
                value={formData.howItWorksTitle}
                onChange={(e) => setFormData({ ...formData, howItWorksTitle: e.target.value })}
                placeholder="Ex: Como funcionam os nossos grupos de preço"
                className="text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="howSubtitle" className="text-xs font-semibold">
                Subtítulo da Seção
              </Label>
              <Input
                id="howSubtitle"
                value={formData.howItWorksSubtitle}
                onChange={(e) => setFormData({ ...formData, howItWorksSubtitle: e.target.value })}
                placeholder="Ex: Economizar não precisa dar trabalho..."
                className="text-xs"
              />
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-border">
            <h3 className="text-sm font-bold">Os 3 Passos:</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {formData.howItWorksSteps.map((step, idx) => (
                <div key={idx} className="p-4 rounded-2xl bg-surface-2 border border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xl font-bold text-rose-500">
                      {step.number || `0${idx + 1}`}
                    </span>
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">
                      Passo {idx + 1}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Título</Label>
                    <Input
                      value={step.title}
                      onChange={(e) => {
                        const updated = [...formData.howItWorksSteps];
                        updated[idx] = { ...updated[idx], title: e.target.value };
                        setFormData({ ...formData, howItWorksSteps: updated });
                      }}
                      className="text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Descrição</Label>
                    <Textarea
                      rows={3}
                      value={step.description}
                      onChange={(e) => {
                        const updated = [...formData.howItWorksSteps];
                        updated[idx] = { ...updated[idx], description: e.target.value };
                        setFormData({ ...formData, howItWorksSteps: updated });
                      }}
                      className="text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 5: PERGUNTAS FREQUENTES (FAQ)                              */}
      {/* ============================================================== */}
      {activeTab === 'faq' && (
        <div className="space-y-8 p-6 sm:p-8 rounded-3xl bg-surface border border-border shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-rose-500" />
                <span>Perguntas Frequentes (FAQ) & Banner Geral</span>
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Tire as principais dúvidas dos visitantes e incentive a entrada no grupo geral.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 rounded-xl border border-border">
                <Label htmlFor="show-faq-switch" className="text-xs font-medium cursor-pointer">
                  Exibir FAQ
                </Label>
                <Switch
                  id="show-faq-switch"
                  checked={formData.showFaq}
                  onCheckedChange={(c) => setFormData({ ...formData, showFaq: c })}
                />
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetFaqs}
                className="text-xs flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restaurar FAQs Aura</span>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="faqTitle" className="text-xs font-semibold">
                Título da Seção de Dúvidas
              </Label>
              <Input
                id="faqTitle"
                value={formData.faqTitle}
                onChange={(e) => setFormData({ ...formData, faqTitle: e.target.value })}
                placeholder="Ex: Tudo o que você precisa saber sobre os grupos"
                className="text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="faqSubtitle" className="text-xs font-semibold">
                Subtítulo da Seção
              </Label>
              <Input
                id="faqSubtitle"
                value={formData.faqSubtitle}
                onChange={(e) => setFormData({ ...formData, faqSubtitle: e.target.value })}
                placeholder="Ex: Respostas diretas e transparentes..."
                className="text-xs"
              />
            </div>
          </div>

          {/* LISTA DE PERGUNTAS */}
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Perguntas & Respostas:</h3>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleAddFaq}
                className="text-xs flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Adicionar Pergunta</span>
              </Button>
            </div>

            <div className="space-y-3">
              {formData.faqItems.map((faq, idx) => (
                <div key={idx} className="p-4 rounded-2xl bg-surface-2 border border-border space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-rose-500">#{idx + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFaq(idx)}
                      className="text-destructive hover:bg-destructive/10 p-1.5 h-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Pergunta</Label>
                    <Input
                      value={faq.question}
                      onChange={(e) => handleFaqChange(idx, 'question', e.target.value)}
                      placeholder="Ex: Os grupos são 100% gratuitos?"
                      className="text-xs font-bold"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Resposta</Label>
                    <Textarea
                      rows={2}
                      value={faq.answer}
                      onChange={(e) => handleFaqChange(idx, 'answer', e.target.value)}
                      placeholder="Digite a resposta..."
                      className="text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* BANNER DO GRUPO GERAL */}
          <div className="space-y-4 pt-4 border-t border-border">
            <h3 className="text-sm font-bold">Banner Convite para Grupo Geral (Abaixo do FAQ):</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="faqBannerTitle" className="text-xs font-semibold">
                  Título do Banner
                </Label>
                <Input
                  id="faqBannerTitle"
                  value={formData.faqBannerTitle}
                  onChange={(e) => setFormData({ ...formData, faqBannerTitle: e.target.value })}
                  placeholder="Ex: Quer entrar no Grupo Geral com todos os nichos juntos?"
                  className="text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="faqBannerButtonText" className="text-xs font-semibold">
                  Texto do Botão
                </Label>
                <Input
                  id="faqBannerButtonText"
                  value={formData.faqBannerButtonText}
                  onChange={(e) => setFormData({ ...formData, faqBannerButtonText: e.target.value })}
                  placeholder="Ex: Entrar no WhatsApp Geral"
                  className="text-xs"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="faqBannerText" className="text-xs font-semibold">
                  Descrição do Banner
                </Label>
                <Textarea
                  rows={2}
                  id="faqBannerText"
                  value={formData.faqBannerText}
                  onChange={(e) => setFormData({ ...formData, faqBannerText: e.target.value })}
                  placeholder="Ex: Se você prefere receber todos os achadinhos em um único grupo..."
                  className="text-xs"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 6: RODAPÉ & REDES                                          */}
      {/* ============================================================== */}
      {activeTab === 'rodape' && (
        <div className="space-y-8 p-6 sm:p-8 rounded-3xl bg-surface border border-border shadow-sm">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Globe className="w-5 h-5 text-rose-500" />
              <span>Rodapé & Redes Sociais</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Personalize a descrição institucional do rodapé e links de contato.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="footerText" className="text-xs font-semibold">
                Texto Institucional do Rodapé
              </Label>
              <Textarea
                id="footerText"
                rows={3}
                value={formData.footerText}
                onChange={(e) => setFormData({ ...formData, footerText: e.target.value })}
                placeholder="Ex: A curadoria independente de promoções, cupons e achadinhos nos melhores e-commerces do Brasil."
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-border">
              <div className="space-y-2">
                <Label htmlFor="instagramUrl" className="text-xs font-semibold">
                  Instagram (Opcional)
                </Label>
                <Input
                  id="instagramUrl"
                  value={formData.instagramUrl}
                  onChange={(e) => setFormData({ ...formData, instagramUrl: e.target.value })}
                  placeholder="https://instagram.com/..."
                  className="text-xs font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="youtubeUrl" className="text-xs font-semibold">
                  YouTube (Opcional)
                </Label>
                <Input
                  id="youtubeUrl"
                  value={formData.youtubeUrl}
                  onChange={(e) => setFormData({ ...formData, youtubeUrl: e.target.value })}
                  placeholder="https://youtube.com/@..."
                  className="text-xs font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="telegramUrl" className="text-xs font-semibold">
                  Telegram (Opcional)
                </Label>
                <Input
                  id="telegramUrl"
                  value={formData.telegramUrl}
                  onChange={(e) => setFormData({ ...formData, telegramUrl: e.target.value })}
                  placeholder="https://t.me/..."
                  className="text-xs font-mono"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* ABA 7: PRÉ-VISUALIZAÇÃO AO VIVO                                */}
      {/* ============================================================== */}
      {activeTab === 'preview' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-surface border border-border flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-rose-500 uppercase tracking-wider">
                Pré-visualização Interativa
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Esta é a visualização em tempo real da sua página com o modo <strong>{formData.themeMode === 'dark' ? 'Dark' : 'Light'}</strong> e cores selecionadas.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setActiveTab('geral')}
              className="text-xs"
            >
              Voltar ao Editor
            </Button>
          </div>

          <div className="rounded-3xl overflow-hidden border border-border shadow-2xl">
            <AuraLandingView
              profile={formData}
              niches={formData.customNiches}
              allowThemeToggle={true}
            />
          </div>
        </div>
      )}

      {/* BARRA FLUTUANTE DE SALVAR NO RODAPÉ */}
      <div className="sticky bottom-4 z-40 bg-surface/90 backdrop-blur-md p-4 rounded-2xl border border-border shadow-xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>Alterações prontas para publicação</span>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setActiveTab('preview')}
            className="text-xs"
          >
            <Eye className="w-3.5 h-3.5 mr-1" />
            <span>Ver Preview</span>
          </Button>

          <Button
            onClick={() => handleSubmit()}
            disabled={saving}
            className="bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white font-bold text-xs"
          >
            <Save className="w-3.5 h-3.5 mr-1" />
            <span>{saving ? 'Salvando...' : 'Salvar Alterações'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
