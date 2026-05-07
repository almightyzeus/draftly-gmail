import { vi } from 'vitest';
import '@angular/compiler';

const store = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  },
  configurable: true,
});

Object.defineProperty(globalThis, 'document', {
  value: { cookie: '' },
  configurable: true,
});

Object.defineProperty(globalThis, 'window', {
  value: {
    location: { href: '' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  configurable: true,
});

vi.spyOn(console, 'error').mockImplementation(() => undefined);
