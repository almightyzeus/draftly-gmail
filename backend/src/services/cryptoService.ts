import { encrypt, decrypt, EncryptedData } from '../utils/crypto.js';

/**
 * CryptoService - Business logic layer for encryption/decryption
 * Wraps crypto utility functions with service-level error handling
 */
export class CryptoService {
  /**
   * Encrypt plaintext using AES-256-GCM
   */
  static encryptToken(plaintext: string): string {
    const encrypted = encrypt(plaintext);
    return JSON.stringify(encrypted);
  }

  /**
   * Decrypt ciphertext using AES-256-GCM
   */
  static decryptToken(encryptedJson: string): string {
    const data: EncryptedData = JSON.parse(encryptedJson);
    return decrypt(data);
  }
}

