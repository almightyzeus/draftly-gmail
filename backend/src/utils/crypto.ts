import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Crypto utilities - Handles AES-256-GCM encryption/decryption
 * Used for encrypting sensitive data like OAuth tokens at rest
 */

export interface EncryptedData {
  ciphertext: string; // hex-encoded ciphertext
  iv: string; // base64-encoded initialization vector
  tag: string; // base64-encoded authentication tag
}

/**
 * Encrypt a string using AES-256-GCM
 * Returns an object with ciphertext, IV, and auth tag
 */
export function encrypt(plaintext: string): EncryptedData {
  try {
    const iv = crypto.randomBytes(12); // 96-bit IV (standard for GCM)
    const cipher = crypto.createCipheriv('aes-256-gcm', env.encryptionKey, iv);

    let ciphertext = cipher.update(plaintext, 'utf-8', 'hex');
    ciphertext += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('base64'),
      ciphertext,
      tag: authTag.toString('base64'),
    };
  } catch (error) {
    logger.error({ error }, 'Encryption failed');
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt data encrypted with the encrypt function
 */
export function decrypt(encryptedData: EncryptedData): string {
  try {
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const authTag = Buffer.from(encryptedData.tag, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', env.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let plaintext = decipher.update(encryptedData.ciphertext, 'hex', 'utf-8');
    plaintext += decipher.final('utf-8');

    return plaintext;
  } catch (error) {
    logger.error({ error }, 'Decryption failed');
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Encrypt a string and return as JSON string
 */
export function encryptToJson(plaintext: string): string {
  return JSON.stringify(encrypt(plaintext));
}

/**
 * Decrypt from JSON string
 */
export function decryptFromJson(encryptedJson: string): string {
  const data: EncryptedData = JSON.parse(encryptedJson);
  return decrypt(data);
}
