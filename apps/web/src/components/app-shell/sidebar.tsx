'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bot,
  Home,
  LogOut,
  Megaphone,
  MessageSquare,
  Radio,
  Search,
  Send,
  Settings,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  Ticket,
  User,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api';

const PRINCIPAL = [
  { href: '/', label: 'Visão Geral', icon: Home },
  { href: '/dashboard', label: 'Dashboard & Métricas', icon: BarChart3 },
  { href: '/produtos', label: 'Buscar Produtos', icon: Search },
  { href: '/enviar', label: 'Enviar Ofertas', icon: Send },
  { href: '/espelhamento', label: 'Espelhamento', icon: Radio },
  { href: '/trafego', label: 'Gestor de Tráfego IA', icon: Megaphone },
  { href: '/afiliados', label: 'Afiliados', icon: Users },
];
const CONFIG = [
  { href: '/config/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { href: '/config/templates', label: 'Template das mensagens', icon: Bot },
  { href: '/config/cupons', label: 'Central de Cupons', icon: Ticket },
  { href: '/config/shopee', label: 'API Shopee', icon: ShoppingBag },
  { href: '/config/mercadolivre', label: 'Conexão Mercado Livre', icon: Store },
  { href: '/config/amazon', label: 'Conexão Amazon', icon: Tag },
  { href: '/config/magalu', label: 'Conexão Magalu', icon: Store },
  { href: '/config/extensao', label: 'Extensão Chrome', icon: Sparkles },
  { href: '/config/conta', label: 'Minha Conta', icon: User },
];

function Group({ title, items, path }: { title: string; items: typeof PRINCIPAL; path: string }) {
  return (
    <div className="mb-4">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-surface-2',
              active && 'bg-brand/15 text-brand',
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const path = usePathname();
  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-surface p-3">
      <div className="mb-4 flex items-center gap-2 px-3 text-lg font-bold">
        <Settings className="h-5 w-5 text-brand" /> Afilados
      </div>
      <nav className="flex-1 overflow-y-auto">
        <Group title="Principal" items={PRINCIPAL} path={path} />
        <Group title="Configurações" items={CONFIG} path={path} />
      </nav>
      <button
        onClick={logout}
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-red-300 hover:bg-surface-2"
      >
        <LogOut className="h-4 w-4" /> Sair
      </button>
    </aside>
  );
}
