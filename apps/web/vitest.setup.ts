import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

if (typeof window !== 'undefined' && !window.PointerEvent) {
  // @ts-expect-error jsdom missing PointerEvent
  window.PointerEvent = class PointerEvent extends MouseEvent {};
}
