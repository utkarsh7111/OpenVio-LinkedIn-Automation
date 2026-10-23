import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

function resolveKey(key?: string | Buffer): Buffer {
  const material = key ?? env.tokenEncryptionKey;
  if (Buffer.isBuffer(material) && material.length === 32) return material;
  if (typeof material === 'string' && /^[0-9a-fA-F]{64}$/.test(material)) return Buffer.from(material, 'hex');
  throw new Error('A 32-byte AES-256-GCM key is required');
}

/** Encrypts a token as base64-encoded IV:tag:ciphertext components. */
export function encryptToken(plaintext: string, key?: string | Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', resolveKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join(':');
}

/** Authenticated decryption; modified values and wrong keys throw. */
export function decryptToken(encoded: string, key?: string | Buffer): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64'));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted token format');
  const decipher = createDecipheriv('aes-256-gcm', resolveKey(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function generateOAuthState(): string { return randomBytes(32).toString('base64url'); }
export function hashOAuthState(state: string): string { return createHash('sha256').update(state, 'utf8').digest('hex'); }
