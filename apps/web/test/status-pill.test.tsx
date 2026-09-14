import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from '@/components/app-shell/status-pill';

describe('StatusPill', () => {
  it('mostra label e tom pelo status', () => {
    render(<StatusPill label="Shopee" status="OK" />);
    expect(screen.getByText('Shopee').closest('[data-tone]')).toHaveAttribute('data-tone', 'ok');
  });
  it('status desconhecido é muted', () => {
    render(<StatusPill label="Magalu" status="UNCONFIGURED" />);
    expect(screen.getByText('Magalu').closest('[data-tone]')).toHaveAttribute('data-tone', 'muted');
  });
});
