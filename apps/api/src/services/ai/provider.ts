/**
 * AI provider abstraction. The default implementation targets any
 * OpenAI-compatible /chat/completions endpoint (self-hosted or commercial).
 * A clearly-labeled MockProvider exists for tests and offline development —
 * it is never selected silently: resolveAI() must return a config or the API
 * answers AI_NOT_CONFIGURED.
 */
import { AppError } from '../../util/appError.js';
import { ErrorCodes } from '@devflow/shared';
import { logger } from '../../util/logger.js';

export interface ChatRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Hint used only by the MockProvider to emit schema-valid test payloads. */
  mockKind?: 'chat' | 'prd' | 'tech_plan' | 'backlog';
}

export interface ChatResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
}

export interface StreamChunk {
  delta?: string;
  usage?: { tokensIn: number; tokensOut: number };
  done?: boolean;
}

export interface AIProvider {
  readonly name: string;
  complete(req: ChatRequest, timeoutMs?: number): Promise<ChatResult>;
  stream(req: ChatRequest): AsyncGenerator<StreamChunk>;
}

const RETRY_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = 'openai-compatible';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async post(body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  private static errorMessage(status: number, bodyText: string): string {
    let detail = bodyText.slice(0, 300);
    try {
      const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      /* keep raw */
    }
    return `AI provider responded ${status}: ${detail}`;
  }

  async complete(req: ChatRequest, timeoutMs = 120000): Promise<ChatResult> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.post(
          {
            model: req.model,
            messages: req.messages,
            temperature: req.temperature ?? 0.4,
            max_tokens: req.maxTokens ?? 4096,
          },
          timeoutMs
        );
        if (!res.ok) {
          const text = await res.text();
          const err = new Error(OpenAICompatibleProvider.errorMessage(res.status, text));
          if (!RETRY_STATUS.has(res.status) || attempt === 1) throw err;
          lastError = err;
          continue;
        }
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const content = data.choices?.[0]?.message?.content ?? '';
        if (!content) {
          throw new AppError(502, ErrorCodes.AI_BAD_RESPONSE, 'AI provider returned an empty completion');
        }
        return {
          content,
          tokensIn: data.usage?.prompt_tokens ?? estimateTokens(req.messages.map((m) => m.content).join(' ')),
          tokensOut: data.usage?.completion_tokens ?? estimateTokens(content),
        };
      } catch (err) {
        if (err instanceof AppError) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === 1) break;
      }
    }
    logger.error('ai complete failed', { err: lastError?.message });
    throw new AppError(502, ErrorCodes.AI_PROVIDER_ERROR, lastError?.message ?? 'AI provider request failed');
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamChunk> {
    const res = await this.post(
      {
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.4,
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true },
      },
      300000
    );
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new AppError(
        502,
        ErrorCodes.AI_PROVIDER_ERROR,
        OpenAICompatibleProvider.errorMessage(res.status, text)
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let tokensIn = 0;
    let tokensOut = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          yield { done: true, usage: { tokensIn, tokensOut } };
          return;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield { delta };
          if (parsed.usage) {
            tokensIn = parsed.usage.prompt_tokens ?? tokensIn;
            tokensOut = parsed.usage.completion_tokens ?? tokensOut;
          }
        } catch {
          // ignore malformed keep-alive lines
        }
      }
    }
    yield { done: true, usage: { tokensIn, tokensOut } };
  }
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Deterministic provider for unit tests and offline demos. Produces
 * schema-valid structured outputs for agent workflows. Clearly labeled —
 * the API reports source='mock' when this is active in non-test contexts.
 */
export class MockProvider implements AIProvider {
  readonly name = 'mock';

  async complete(req: ChatRequest): Promise<ChatResult> {
    const content = mockContent(req);
    return {
      content,
      tokensIn: estimateTokens(req.messages.map((m) => m.content).join(' ')),
      tokensOut: estimateTokens(content),
    };
  }

  async *stream(req: ChatRequest): AsyncGenerator<StreamChunk> {
    const content = mockContent(req);
    for (const piece of content.match(/.{1,24}/gs) ?? [content]) {
      yield { delta: piece };
    }
    yield { done: true, usage: { tokensIn: estimateTokens(req.messages.map((m) => m.content).join(' ')), tokensOut: estimateTokens(content) } };
  }
}

function mockContent(req: ChatRequest): string {
  const vision = req.messages.find((m) => m.role === 'user')?.content ?? 'the project';
  switch (req.mockKind) {
    case 'prd':
      return [
        '# Product Requirements Document',
        '',
        `## Vision`,
        vision.slice(0, 2000),
        '',
        '## Goals',
        '- Deliver a usable end-to-end workflow',
        '- Keep the system secure by default',
        '',
        '## Non-goals',
        '- No mobile client in v1',
        '',
        '## Success metrics',
        '- Week-4 activation rate > 60%',
      ].join('\n');
    case 'tech_plan':
      return [
        '# Technical Plan',
        '',
        '## Architecture',
        '- Frontend: single-page client',
        '- Backend: REST API service',
        '- Database: relational store',
        '',
        '## Milestones',
        '1. Foundation (auth, projects)',
        '2. Planning (PRD, backlog)',
        '3. Delivery (execution, PRs)',
      ].join('\n');
    case 'backlog':
      return JSON.stringify({
        epics: [
          {
            title: 'Foundation',
            description: 'Core infrastructure derived from: ' + vision.slice(0, 120),
            stories: [
              {
                title: 'Set up project skeleton',
                description: 'Initialize structure and tooling',
                points: 3,
                priority: 'high',
                acceptanceCriteria: ['Project builds', 'Tests pass'],
                tasks: [{ title: 'Bootstrap repository', description: 'Create baseline structure', subtasks: ['Add config', 'Add CI'] }],
              },
              {
                title: 'Implement authentication',
                description: 'Secure login and session handling',
                points: 5,
                priority: 'critical',
                acceptanceCriteria: ['Users can register', 'Sessions are protected'],
                tasks: [{ title: 'Build auth endpoints', description: 'Register, login, token handling' }],
              },
            ],
          },
        ],
      });
    default:
      return `Mock AI response (no provider configured). You said: "${vision.slice(0, 200)}". Configure a real AI provider in Settings → AI Provider to get genuine completions.`;
  }
}
