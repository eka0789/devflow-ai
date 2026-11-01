/**
 * Application configuration. Loads .env if present (searching upward from cwd),
 * validates required values, and never logs secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { logger } from './util/logger.js';

function findDotEnv(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadDotEnv(): void {
  const file = findDotEnv();
  if (!file) return;
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
  logger.info('env loaded', { file: path.basename(file) });
}
loadDotEnv();

export interface EnvAIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Config {
  port: number;
  clientOrigins: string[];
  dbPath: string;
  appSecret: string;
  appSecretEphemeral: boolean;
  webhookSecret: string | null;
  envAI: EnvAIConfig | null;
  logLevel: string;
  isProd: boolean;
  /** Set TRUST_PROXY=true ONLY behind a proxy that overwrites X-Forwarded-For. */
  trustProxy: boolean;
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  const items = raw
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function resolveDbPath(raw: string | undefined): string {
  const p = raw && raw.trim() ? raw.trim() : './data/devflow.db';
  const resolved = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

const envSecret = (process.env.APP_SECRET ?? '').trim();
const appSecretEphemeral = envSecret.length < 16;
const appSecret = appSecretEphemeral ? randomBytes(32).toString('hex') : envSecret;

if (appSecretEphemeral) {
  logger.warn(
    'APP_SECRET missing or too short — using an EPHEMERAL secret. JWT sessions and stored credentials reset on restart. Set APP_SECRET in .env before production.'
  );
}

const envAIConfig: EnvAIConfig | null =
  (process.env.AI_BASE_URL ?? '').trim() && (process.env.AI_API_KEY ?? '').trim()
    ? {
        baseUrl: (process.env.AI_BASE_URL ?? '').trim().replace(/\/$/, ''),
        apiKey: (process.env.AI_API_KEY ?? '').trim(),
        model: (process.env.AI_MODEL ?? 'gpt-4o-mini').trim(),
      }
    : null;

export const config: Config = {
  port: Number(process.env.PORT ?? 4310),
  clientOrigins: parseList(process.env.CLIENT_ORIGIN, ['http://localhost:5173']),
  dbPath: resolveDbPath(process.env.DB_PATH),
  appSecret,
  appSecretEphemeral,
  webhookSecret: (process.env.GITHUB_WEBHOOK_SECRET ?? '').trim() || null,
  envAI: envAIConfig,
  logLevel: (process.env.LOG_LEVEL ?? 'info').trim(),
  isProd: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === 'true',
};
