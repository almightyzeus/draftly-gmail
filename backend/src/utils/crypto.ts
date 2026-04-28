import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Crypto Service - Handles AES-256-GCM encryption/decryption
 * Used for encrypting sensitive data like OAuth tokens at rest
 */

export interface EncryptedData {
  ciphertext: string; // base64-encoded ciphertext
  iv: string; // base64-encoded initialization vector
  authTag: string; // base64-encoded authentication tag
}

/**
 * Encrypt a string using AES-256-GCM
 * Returns an object with ciphertext, IV, and auth tag (all base64-encoded)
 */
export function encrypt(plaintext: string): EncryptedData {
  try {
    const iv = crypto.randomBytes(16); // 128-bit IV
    const cipher = crypto.createCipheriv('aes-256-gcm', env.encryptionKey, iv);

    let ciphertext = cipher.update(plaintext, 'utf8', 'binary');
    ciphertext += cipher.final('binary');

    const authTag = cipher.getAuthTag();

    return {
      ciphertext: Buffer.from(ciphertext, 'binary').toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  } catch (error) {
    logger.error({ error }, 'Encryption failed');
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt data encrypted with the encrypt function
 * Expects an object with base64-encoded ciphertext, IV, and auth tag
 */
export function decrypt(encryptedData: EncryptedData): string {
  try {
    const ciphertext = Buffer.from(encryptedData.ciphertext, 'base64');
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.authTag, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', env.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let plaintext = decipher.update(ciphertext, 'binary', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  } catch (error) {
    logger.error({ error }, 'Decryption failed');
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Encrypt an object (converts to JSON first)
 */
export function encryptObject<T extends Record<string, any>>(obj: T): EncryptedData {
  return encrypt(JSON.stringify(obj));
}

/**
 * Decrypt and parse an object
 */
export function decryptObject<T extends Record<string, any>>(
  encryptedData: EncryptedData
): T {
  const plaintext = decrypt(encryptedData);
  return JSON.parse(plaintext) as T;
}
