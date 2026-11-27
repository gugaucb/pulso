import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

if (typeof window !== 'undefined') {
  if (!window.crypto || !window.crypto.subtle) {
    const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => { webcrypto?: Crypto } } }).process;
    const nodeWebCrypto = proc?.getBuiltinModule?.('node:crypto')?.webcrypto;
    if (nodeWebCrypto) {
      Object.defineProperty(window, 'crypto', {
        value: nodeWebCrypto,
        configurable: true,
      });
    }
  }

  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

afterEach(() => {
  cleanup();
});
