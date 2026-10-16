import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from '@/components/app-shell/sidebar';

vi.mock('next/navigation', () => ({ usePathname: () => '/config/ia', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

describe('Sidebar', () => {
  it('tem o link Configurações > IA apontando para /config/ia', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><Sidebar /></QueryClientProvider>);
    expect(screen.getByRole('link', { name: /ia \(cta\)/i }).getAttribute('href')).toBe('/config/ia');
  });
});
