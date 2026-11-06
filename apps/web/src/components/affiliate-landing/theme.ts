import type { ThemeColor } from '@afilados/shared';

export interface ThemeStyles {
  primary: string;
  primaryHover: string;
  textGlow: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  buttonGradient: string;
  buttonHoverGradient: string;
  buttonShadow: string;
  ambientLight: string;
  ringColor: string;
  accentText: string;
  cardBorderHover: string;
}

export const THEME_CONFIG: Record<ThemeColor, ThemeStyles> = {
  red: {
    primary: 'red-500',
    primaryHover: 'red-400',
    textGlow: 'from-red-500 via-rose-500 to-red-400',
    badgeBg: 'bg-red-500/10',
    badgeBorder: 'border-red-500/30',
    badgeText: 'text-red-400',
    buttonGradient: 'from-red-600 via-rose-600 to-red-500',
    buttonHoverGradient: 'hover:from-red-500 hover:to-rose-400',
    buttonShadow: 'shadow-[0_0_35px_rgba(239,68,68,0.45)]',
    ambientLight: 'bg-red-600/15',
    ringColor: 'ring-red-500',
    accentText: 'text-red-500',
    cardBorderHover: 'hover:border-red-500/50',
  },
  emerald: {
    primary: 'emerald-500',
    primaryHover: 'emerald-400',
    textGlow: 'from-emerald-400 via-teal-400 to-emerald-500',
    badgeBg: 'bg-emerald-500/10',
    badgeBorder: 'border-emerald-500/30',
    badgeText: 'text-emerald-400',
    buttonGradient: 'from-emerald-600 via-teal-600 to-emerald-500',
    buttonHoverGradient: 'hover:from-emerald-500 hover:to-teal-400',
    buttonShadow: 'shadow-[0_0_35px_rgba(16,185,129,0.45)]',
    ambientLight: 'bg-emerald-600/15',
    ringColor: 'ring-emerald-500',
    accentText: 'text-emerald-400',
    cardBorderHover: 'hover:border-emerald-500/50',
  },
  cyan: {
    primary: 'cyan-400',
    primaryHover: 'cyan-300',
    textGlow: 'from-cyan-400 via-sky-400 to-blue-400',
    badgeBg: 'bg-cyan-500/10',
    badgeBorder: 'border-cyan-500/30',
    badgeText: 'text-cyan-400',
    buttonGradient: 'from-cyan-600 via-sky-600 to-blue-600',
    buttonHoverGradient: 'hover:from-cyan-500 hover:to-sky-400',
    buttonShadow: 'shadow-[0_0_35px_rgba(6,182,212,0.45)]',
    ambientLight: 'bg-cyan-600/15',
    ringColor: 'ring-cyan-400',
    accentText: 'text-cyan-400',
    cardBorderHover: 'hover:border-cyan-500/50',
  },
  blue: {
    primary: 'blue-500',
    primaryHover: 'blue-400',
    textGlow: 'from-blue-400 via-indigo-400 to-blue-500',
    badgeBg: 'bg-blue-500/10',
    badgeBorder: 'border-blue-500/30',
    badgeText: 'text-blue-400',
    buttonGradient: 'from-blue-600 via-indigo-600 to-blue-500',
    buttonHoverGradient: 'hover:from-blue-500 hover:to-indigo-400',
    buttonShadow: 'shadow-[0_0_35px_rgba(59,130,246,0.45)]',
    ambientLight: 'bg-blue-600/15',
    ringColor: 'ring-blue-500',
    accentText: 'text-blue-400',
    cardBorderHover: 'hover:border-blue-500/50',
  },
  violet: {
    primary: 'purple-500',
    primaryHover: 'purple-400',
    textGlow: 'from-purple-400 via-fuchsia-400 to-violet-500',
    badgeBg: 'bg-purple-500/10',
    badgeBorder: 'border-purple-500/30',
    badgeText: 'text-purple-400',
    buttonGradient: 'from-purple-600 via-fuchsia-600 to-violet-600',
    buttonHoverGradient: 'hover:from-purple-500 hover:to-fuchsia-400',
    buttonShadow: 'shadow-[0_0_35px_rgba(168,85,247,0.45)]',
    ambientLight: 'bg-purple-600/15',
    ringColor: 'ring-purple-500',
    accentText: 'text-purple-400',
    cardBorderHover: 'hover:border-purple-500/50',
  },
  amber: {
    primary: 'amber-400',
    primaryHover: 'amber-300',
    textGlow: 'from-amber-400 via-orange-400 to-yellow-500',
    badgeBg: 'bg-amber-500/10',
    badgeBorder: 'border-amber-500/30',
    badgeText: 'text-amber-400',
    buttonGradient: 'from-amber-600 via-orange-600 to-yellow-600',
    buttonHoverGradient: 'hover:from-amber-500 hover:to-orange-400',
    buttonShadow: 'shadow-[0_0_35px_rgba(245,158,11,0.45)]',
    ambientLight: 'bg-amber-600/15',
    ringColor: 'ring-amber-400',
    accentText: 'text-amber-400',
    cardBorderHover: 'hover:border-amber-500/50',
  },
  rose: {
    primary: 'rose-500',
    primaryHover: 'rose-400',
    textGlow: 'from-rose-400 via-pink-400 to-rose-500',
    badgeBg: 'bg-rose-500/10',
    badgeBorder: 'border-rose-500/30',
    badgeText: 'text-rose-400',
    buttonGradient: 'from-rose-600 via-pink-600 to-rose-500',
    buttonHoverGradient: 'hover:from-rose-500 hover:to-pink-400',
    buttonShadow: 'shadow-[0_0_35px_rgba(244,63,94,0.45)]',
    ambientLight: 'bg-rose-600/15',
    ringColor: 'ring-rose-500',
    accentText: 'text-rose-400',
    cardBorderHover: 'hover:border-rose-500/50',
  },
};

export function getThemeStyles(color?: string | null): ThemeStyles {
  const c = (color || 'red') as ThemeColor;
  return THEME_CONFIG[c] || THEME_CONFIG.red;
}
