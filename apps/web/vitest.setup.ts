import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

if (typeof window !== 'undefined' && !window.PointerEvent) {
  // @ts-expect-error jsdom missing PointerEvent
  window.PointerEvent = class PointerEvent extends MouseEvent {};
}

// Recharts (ResponsiveContainer) observa o tamanho do contêiner; o jsdom não tem ResizeObserver.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
