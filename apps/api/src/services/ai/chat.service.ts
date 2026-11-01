/**
 * Conversational AI with streaming. Persists messages, tracks usage, and
 * enforces conversation ownership.
 */
import { getDb, newId, nowIso } from '../../db/database.js';
import { AppError } from '../../util/appError.js';
import { ErrorCodes, type ChatMessage, type Conversation } from '@devflow/shared';
import { OpenAICompatibleProvider, MockProvider, estimateTokens, type AIProvider } from './provider.js';
import { resolveAI } from '../settings.service.js';

interface ConversationRow {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  created_at: string;
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as ChatMessage['role'],
    content: row.content,
    model: row.model,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    createdAt: row.created_at,
  };
}

export function listConversations(userId: string, projectId: string | null): Conversation[] {
  const rows = (
    projectId
      ? getDb()
          .prepare('SELECT * FROM conversations WHERE user_id = ? AND (project_id = ? OR project_id IS NULL) ORDER BY updated_at DESC LIMIT 100')
          .all(userId, projectId)
      : getDb()
          .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100')
          .all(userId)
  ) as unknown as ConversationRow[];
  return rows.map(toConversation);
}

export function createConversation(userId: string, projectId: string | null, title: string | null): Conversation {
  if (projectId) {
    const project = getDb().prepare('SELECT owner_user_id FROM projects WHERE id = ?').get(projectId) as { owner_user_id: string } | undefined;
    if (!project || project.owner_user_id !== userId) throw AppError.notFound('Project');
  }
  const id = newId();
  const ts = nowIso();
  getDb()
    .prepare('INSERT INTO conversations (id, user_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, projectId, title ?? 'New conversation', ts, ts);
  const row = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as unknown as ConversationRow;
  return toConversation(row);
}

export function getConversation(userId: string, conversationId: string): { conversation: Conversation; messages: ChatMessage[] } {
  const row = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as unknown as unknown as ConversationRow | undefined;
  if (!row || row.user_id !== userId) throw AppError.notFound('Conversation');
  const messages = getDb()
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid LIMIT 500')
    .all(conversationId) as unknown as MessageRow[];
  return { conversation: toConversation(row), messages: messages.map(toMessage) };
}

export function deleteConversation(userId: string, conversationId: string): void {
  const res = getDb().prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(conversationId, userId);
  if (res.changes === 0) throw AppError.notFound('Conversation');
}

export interface ChatStreamHandlers {
  onDelta: (text: string) => void;
  onDone: (payload: { message: ChatMessage; conversation: Conversation }) => void;
  onError: (payload: { code: string; message: string }) => void;
}

const CONTEXT_MESSAGE_LIMIT = 20;

/**
 * Streams a completion for the conversation. Returns the sse event sender so
 * routes only deal with transport.
 */
export async function streamChat(
  userId: string,
  conversationId: string,
  content: string,
  handlers: ChatStreamHandlers
): Promise<void> {
  const { conversation, messages } = getConversation(userId, conversationId);

  // persist user message immediately
  const userMsgId = newId();
  const ts = nowIso();
  getDb()
    .prepare('INSERT INTO messages (id, conversation_id, role, content, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(userMsgId, conversationId, 'user', content, estimateTokens(content), ts);
  let title = conversation.title;
  if (title === 'New conversation' && messages.length === 0) {
    title = content.slice(0, 60).replace(/\s+/g, ' ').trim() || 'New conversation';
  }
  getDb().prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, ts, conversationId);

  const aiConfig = resolveAI(userId);
  if (!aiConfig) {
    handlers.onError({
      code: ErrorCodes.AI_NOT_CONFIGURED,
      message:
        'No AI provider configured. Go to Settings → AI Provider and add an OpenAI-compatible base URL, API key and model.',
    });
    return;
  }
  const provider: AIProvider = new OpenAICompatibleProvider(aiConfig.baseUrl, aiConfig.apiKey);

  // project context if the conversation is tied to a project
  let projectContext = '';
  if (conversation.projectId) {
    const project = getDb()
      .prepare('SELECT name, description, tech_stack, repo_full_name FROM projects WHERE id = ?')
      .get(conversation.projectId) as { name: string; description: string; tech_stack: string; repo_full_name: string | null } | undefined;
    if (project) {
      projectContext = `\n\nActive project context: "${project.name}" — ${project.description.slice(0, 500)}${
        project.repo_full_name ? ` (GitHub: ${project.repo_full_name})` : ''
      }`;
    }
  }

  const history = [...messages, { id: userMsgId, conversationId, role: 'user', content, model: null, tokensIn: 0, tokensOut: 0, createdAt: ts }]
    .slice(-CONTEXT_MESSAGE_LIMIT)
    .map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }));

  const model = aiConfig.model;
  const started = Date.now();
  let full = '';
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    for await (const chunk of provider.stream({
      model,
      messages: [
        {
          role: 'system',
          content: `You are DevFlow AI, a senior software engineering assistant inside a development workspace. Be precise, practical, and concise. Use markdown.${projectContext}`,
        },
        ...history,
      ],
      temperature: 0.4,
      maxTokens: 4096,
    })) {
      if (chunk.delta) {
        full += chunk.delta;
        handlers.onDelta(chunk.delta);
      }
      if (chunk.usage) {
        tokensIn = chunk.usage.tokensIn;
        tokensOut = chunk.usage.tokensOut;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (full) {
      // partial content was already streamed; persist what we have
      persistAssistantMessage(conversationId, full, model, tokensIn || estimateTokens(content), tokensOut || estimateTokens(full), started);
    }
    handlers.onError({ code: ErrorCodes.AI_PROVIDER_ERROR, message });
    return;
  }

  const finalTokensIn = tokensIn || estimateTokens(history.map((m) => m.content).join(' '));
  const finalTokensOut = tokensOut || estimateTokens(full);
  const message = persistAssistantMessage(conversationId, full, model, finalTokensIn, finalTokensOut, started);
  handlers.onDone({ message, conversation: { ...conversation, title, updatedAt: nowIso() } });
}

function persistAssistantMessage(
  conversationId: string,
  content: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  startedAt: number
): ChatMessage {
  void startedAt;
  const db = getDb();
  const id = newId();
  const ts = nowIso();
  db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, model, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, conversationId, 'assistant', content, model, tokensIn, tokensOut, ts);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(ts, conversationId);
  const conv = db.prepare('SELECT user_id, project_id FROM conversations WHERE id = ?').get(conversationId) as { user_id: string; project_id: string | null };
  db.prepare(
    'INSERT INTO usage_events (id, user_id, project_id, kind, model, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(newId(), conv.user_id, conv.project_id, 'chat', model, tokensIn, tokensOut, ts);
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as MessageRow;
  return toMessage(row);
}

/** Real connectivity test used by Settings → "Test connection". */
export async function verifyProvider(userId: string): Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }> {
  const aiConfig = resolveAI(userId);
  if (!aiConfig) return { ok: false, error: 'No AI provider configured' };
  const provider = new OpenAICompatibleProvider(aiConfig.baseUrl, aiConfig.apiKey);
  const started = Date.now();
  try {
    await provider.complete(
      { model: aiConfig.model, messages: [{ role: 'user', content: 'Reply with exactly: ok' }], maxTokens: 8, temperature: 0 },
      30000
    );
    return { ok: true, model: aiConfig.model, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - started };
  }
}

export { MockProvider };
