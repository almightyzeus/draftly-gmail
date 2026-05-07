import { describe, it, expect } from 'vitest';
import { CryptoService } from '../src/services/cryptoService.js';

describe('CryptoService', () => {
  const secret = 'sensitive-gmail-token-12345';

  it('encryptToken returns a JSON payload with encryption metadata', () => {
    const encryptedJson = CryptoService.encryptToken(secret);

    expect(typeof encryptedJson).toBe('string');

    const payload = JSON.parse(encryptedJson);
    expect(payload).toHaveProperty('ciphertext');
    expect(payload).toHaveProperty('iv');
    expect(payload).toHaveProperty('tag');
    expect(payload.ciphertext).not.toHaveLength(0);
  });

  it('decryptToken restores the original plaintext', () => {
    const encryptedJson = CryptoService.encryptToken(secret);
    const decrypted = CryptoService.decryptToken(encryptedJson);

    expect(decrypted).toBe(secret);
  });

  it('produces different ciphertexts for the same plaintext due to random IV', () => {
    const first = CryptoService.encryptToken(secret);
    const second = CryptoService.encryptToken(secret);

    expect(first).not.toBe(second);
  });

  it('throws when decrypting malformed payloads', () => {
    expect(() => CryptoService.decryptToken('not-json')).toThrow();
  });
});
