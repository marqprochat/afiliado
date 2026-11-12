import type { ThemeColor, ButtonColor, ThemeMode } from '@afilados/shared';

export interface AuraThemeConfig {
  mode: ThemeMode;
  color: ThemeColor;
  button: ButtonColor;
}

export function getAuraThemeStyles(color: ThemeColor = 'rose', mode: ThemeMode = 'light', button: ButtonColor = 'emerald') {
  const isDark = mode === 'dark';

  // Cores de fundo e textos base
  const bgMain = isDark ? 'bg-[#090b10]' : 'bg-[#FFFBFD]';
  const textMain = isDark ? 'text-slate-100' : 'text-neutral-900';
  const textMuted = isDark ? 'text-slate-400' : 'text-neutral-600';
  const textSubtle = isDark ? 'text-slate-500' : 'text-neutral-400';
  const cardBg = isDark ? 'bg-[#12151e]/90 border-slate-800/80' : 'bg-white border-rose-100';
  const cardSoftBg = isDark ? 'bg-slate-900/60 border-slate-800' : 'bg-rose-50/70 border-rose-100';
  const sectionBgAlt = isDark ? 'bg-[#0d1017] border-slate-800/80' : 'bg-rose-50/40 border-rose-100';
  const headerBg = isDark ? 'bg-[#090b10]/85 border-slate-800/80 text-white' : 'bg-white/85 border-rose-100/80 text-neutral-900';
  const footerBg = isDark ? 'bg-[#07090e] border-slate-800 text-slate-400' : 'bg-white border-rose-100 text-neutral-500';

  // Configuração da cor de destaque (accent)
  const colorMap: Record<ThemeColor, {
    text: string;
    textDark: string;
    bgSoft: string;
    bgSoftDark: string;
    border: string;
    borderDark: string;
    badgeBg: string;
    badgeText: string;
    ring: string;
    dot: string;
  }> = {
    rose: {
      text: 'text-rose-600',
      textDark: 'text-rose-400',
      bgSoft: 'bg-rose-50',
      bgSoftDark: 'bg-rose-950/30',
      border: 'border-rose-200',
      borderDark: 'border-rose-900/50',
      badgeBg: isDark ? 'bg-rose-950/40 border-rose-800/60' : 'bg-rose-100/70 border-rose-200/80',
      badgeText: isDark ? 'text-rose-300' : 'text-rose-700',
      ring: 'ring-rose-500',
      dot: 'bg-rose-500',
    },
    red: {
      text: 'text-red-600',
      textDark: 'text-red-400',
      bgSoft: 'bg-red-50',
      bgSoftDark: 'bg-red-950/30',
      border: 'border-red-200',
      borderDark: 'border-red-900/50',
      badgeBg: isDark ? 'bg-red-950/40 border-red-800/60' : 'bg-red-100/70 border-red-200/80',
      badgeText: isDark ? 'text-red-300' : 'text-red-700',
      ring: 'ring-red-500',
      dot: 'bg-red-500',
    },
    emerald: {
      text: 'text-emerald-600',
      textDark: 'text-emerald-400',
      bgSoft: 'bg-emerald-50',
      bgSoftDark: 'bg-emerald-950/30',
      border: 'border-emerald-200',
      borderDark: 'border-emerald-900/50',
      badgeBg: isDark ? 'bg-emerald-950/40 border-emerald-800/60' : 'bg-emerald-100/70 border-emerald-200/80',
      badgeText: isDark ? 'text-emerald-300' : 'text-emerald-700',
      ring: 'ring-emerald-500',
      dot: 'bg-emerald-500',
    },
    blue: {
      text: 'text-blue-600',
      textDark: 'text-blue-400',
      bgSoft: 'bg-blue-50',
      bgSoftDark: 'bg-blue-950/30',
      border: 'border-blue-200',
      borderDark: 'border-blue-900/50',
      badgeBg: isDark ? 'bg-blue-950/40 border-blue-800/60' : 'bg-blue-100/70 border-blue-200/80',
      badgeText: isDark ? 'text-blue-300' : 'text-blue-700',
      ring: 'ring-blue-500',
      dot: 'bg-blue-500',
    },
    violet: {
      text: 'text-purple-600',
      textDark: 'text-purple-400',
      bgSoft: 'bg-purple-50',
      bgSoftDark: 'bg-purple-950/30',
      border: 'border-purple-200',
      borderDark: 'border-purple-900/50',
      badgeBg: isDark ? 'bg-purple-950/40 border-purple-800/60' : 'bg-purple-100/70 border-purple-200/80',
      badgeText: isDark ? 'text-purple-300' : 'text-purple-700',
      ring: 'ring-purple-500',
      dot: 'bg-purple-500',
    },
    amber: {
      text: 'text-amber-600',
      textDark: 'text-amber-400',
      bgSoft: 'bg-amber-50',
      bgSoftDark: 'bg-amber-950/30',
      border: 'border-amber-200',
      borderDark: 'border-amber-900/50',
      badgeBg: isDark ? 'bg-amber-950/40 border-amber-800/60' : 'bg-amber-100/70 border-amber-200/80',
      badgeText: isDark ? 'text-amber-300' : 'text-amber-800',
      ring: 'ring-amber-500',
      dot: 'bg-amber-500',
    },
    cyan: {
      text: 'text-cyan-600',
      textDark: 'text-cyan-400',
      bgSoft: 'bg-cyan-50',
      bgSoftDark: 'bg-cyan-950/30',
      border: 'border-cyan-200',
      borderDark: 'border-cyan-900/50',
      badgeBg: isDark ? 'bg-cyan-950/40 border-cyan-800/60' : 'bg-cyan-100/70 border-cyan-200/80',
      badgeText: isDark ? 'text-cyan-300' : 'text-cyan-700',
      ring: 'ring-cyan-400',
      dot: 'bg-cyan-400',
    },
  };

  const accent = colorMap[color] || colorMap.rose;

  // Botões de ação principal (CTA)
  const actualButtonColor = button === 'theme' ? color : button;
  const buttonMap: Record<string, string> = {
    emerald: 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/25',
    rose: 'bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/25',
    red: 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/25',
    blue: 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/25',
    violet: 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-600/25',
    amber: 'bg-amber-500 hover:bg-amber-600 text-neutral-950 shadow-amber-500/25',
    cyan: 'bg-cyan-500 hover:bg-cyan-600 text-neutral-950 shadow-cyan-500/25',
    dark: 'bg-neutral-900 hover:bg-neutral-800 text-white shadow-neutral-900/25 border border-slate-700',
  };

  const primaryBtnClass = buttonMap[actualButtonColor] || buttonMap.emerald;

  return {
    isDark,
    bgMain,
    textMain,
    textMuted,
    textSubtle,
    cardBg,
    cardSoftBg,
    sectionBgAlt,
    headerBg,
    footerBg,
    accentText: isDark ? accent.textDark : accent.text,
    accentBgSoft: isDark ? accent.bgSoftDark : accent.bgSoft,
    accentBorder: isDark ? accent.borderDark : accent.border,
    badgeBg: accent.badgeBg,
    badgeText: accent.badgeText,
    accentRing: accent.ring,
    accentDot: accent.dot,
    primaryBtnClass,
  };
}
