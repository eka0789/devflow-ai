/**
 * Password hashing (scrypt) and secret encryption at rest (AES-256-GCM).
 * Used for user passwords and for GitHub PATs / AI API keys stored per user.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

// ---------- secret encryption at rest ----------

// the app secret is constant per process — derive the key once (scryptSync is
// ~50-100ms of event-loop time per call otherwise, on every decrypt hot path)
let cachedKey: Buffer | null = null;
let cachedKeySource = '';

function deriveKey(appSecret: string): Buffer {
  if (!cachedKey || cachedKeySource !== appSecret) {
    cachedKey = scryptSync(appSecret, 'devflow-ai/secrets/v1', 32);
    cachedKeySource = appSecret;
  }
  return cachedKey;
}

export function encryptSecret(plaintext: string, appSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(appSecret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${enc.toString('base64url')}`;
}

export function decryptSecret(packed: string, appSecret: string): string | null {
  try {
    const parts = packed.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const iv = Buffer.from(parts[1]!, 'base64url');
    const tag = Buffer.from(parts[2]!, 'base64url');
    const data = Buffer.from(parts[3]!, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(appSecret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
