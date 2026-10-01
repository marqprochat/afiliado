import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '@/components/app-shell/sidebar';

vi.mock('next/navigation', () => ({ usePathname: () => '/config/ia', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

describe('Sidebar', () => {
  it('tem o link Configurações > IA apontando para /config/ia', () => {
    render(<Sidebar />);
    expect(screen.getByRole('link', { name: /ia \(cta\)/i }).getAttribute('href')).toBe('/config/ia');
  });
});
