/**
 * Per-user integration settings. GitHub PATs and AI API keys are encrypted at
 * rest (AES-256-GCM) and never returned to clients.
 */
import { getDb, nowIso } from '../db/database.js';
import { config } from '../config.js';
import { decryptSecret, encryptSecret } from '../util/crypto.js';
import { assertPublicAiUrl } from './ai/provider.js';
import type { AISettingsPublic } from '@devflow/shared';

interface SecretsRow {
  user_id: string;
  github_token_enc: string | null;
  ai_api_key_enc: string | null;
  ai_base_url: string | null;
  ai_model: string | null;
  updated_at: string;
}

function getRow(userId: string): SecretsRow | undefined {
  return getDb().prepare('SELECT * FROM user_secrets WHERE user_id = ?').get(userId) as
    | SecretsRow
    | undefined;
}

// ---------- AI provider settings ----------

export function getAISettingsPublic(userId: string): AISettingsPublic {
  const row = getRow(userId);
  if (row?.ai_api_key_enc && row.ai_base_url && row.ai_model) {
    return { configured: true, baseUrl: row.ai_base_url, model: row.ai_model, source: 'user' };
  }
  if (config.envAI) {
    return {
      configured: true,
      baseUrl: config.envAI.baseUrl,
      model: config.envAI.model,
      source: 'env',
    };
  }
  return { configured: false, baseUrl: row?.ai_base_url ?? null, model: row?.ai_model ?? null, source: 'none' };
}

export function setAISettings(
  userId: string,
  input: { baseUrl: string; apiKey?: string | null; model: string }
): AISettingsPublic {
  // reject private-network targets up front (SSRF guard; see provider.ts)
  assertPublicAiUrl(input.baseUrl.replace(/\/$/, ''));
  const db = getDb();
  const row = getRow(userId);
  const apiKeyEnc =
    input.apiKey !== null && input.apiKey !== undefined && input.apiKey.length > 0
      ? encryptSecret(input.apiKey, config.appSecret)
      : (row?.ai_api_key_enc ?? null);
  db.prepare(
    `INSERT INTO user_secrets (user_id, ai_api_key_enc, ai_base_url, ai_model, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET ai_api_key_enc = excluded.ai_api_key_enc,
       ai_base_url = excluded.ai_base_url, ai_model = excluded.ai_model, updated_at = excluded.updated_at`
  ).run(userId, apiKeyEnc, input.baseUrl.replace(/\/$/, ''), input.model, nowIso());
  return getAISettingsPublic(userId);
}

export interface ResolvedAI {
  baseUrl: string;
  apiKey: string;
  model: string;
  source: 'user' | 'env';
}

/** Resolves the effective AI provider config, or null when unconfigured. */
export function resolveAI(userId: string): ResolvedAI | null {
  const row = getRow(userId);
  if (row?.ai_api_key_enc && row.ai_base_url && row.ai_model) {
    const apiKey = decryptSecret(row.ai_api_key_enc, config.appSecret);
    if (apiKey) {
      return { baseUrl: row.ai_base_url, apiKey, model: row.ai_model, source: 'user' };
    }
  }
  if (config.envAI) {
    return { ...config.envAI, source: 'env' };
  }
  return null;
}

// ---------- GitHub token ----------

export function setGitHubToken(userId: string, token: string): void {
  const db = getDb();
  const enc = encryptSecret(token, config.appSecret);
  db.prepare(
    `INSERT INTO user_secrets (user_id, github_token_enc, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET github_token_enc = excluded.github_token_enc, updated_at = excluded.updated_at`
  ).run(userId, enc, nowIso());
}

export function clearGitHubToken(userId: string): void {
  getDb().prepare('UPDATE user_secrets SET github_token_enc = NULL WHERE user_id = ?').run(userId);
}

export function getGitHubToken(userId: string): string | null {
  const row = getRow(userId);
  if (!row?.github_token_enc) return null;
  return decryptSecret(row.github_token_enc, config.appSecret);
}

export function hasGitHubToken(userId: string): boolean {
  return getRow(userId)?.github_token_enc != null;
}
