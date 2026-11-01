# Setup: AI Provider

DevFlow AI talks to **any OpenAI-compatible chat-completions API** (OpenAI, Azure OpenAI gateways, OpenRouter, Groq, Together, local vLLM/Ollama with an OpenAI-compatible route, etc.).

## 1. Configure per user

Sign in → **Settings → AI Provider**:

| Field | Example |
|---|---|
| Base URL | `https://api.openai.com/v1` (no trailing slash needed) |
| API key | `sk-…` (stored encrypted; shown masked afterwards) |
| Model | `gpt-4o-mini` / `llama-3.1-70b` / any model your endpoint serves |

Click **Test connection** — the server performs a real minimal completion and reports latency or the provider's exact error. Nothing is marked configured until this succeeds.

## 2. Or configure via environment (fallback)

```env
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-…
AI_MODEL=gpt-4o-mini
```
Env config applies to users who have not saved their own settings (`source: 'env'` in `GET /api/ai/settings`).

## 3. What the integration powers

- **AI Chat** — SSE streaming, conversation history, project context injection, per-request usage tracking (`/api/ai/usage`).
- **Planning agents** — PM/Architect/Scrum Master workflows; the Scrum Master must return strict JSON validated against a zod schema (invalid structure fails the step, no silent garbage).
- **Task execution** — the developer agent receives repo context (tree, relevant file contents, README conventions, task + acceptance criteria) and must return a JSON change set.

## 4. Behavior without configuration (by design)

- Chat: stream opens, user message persists, then a structured `AI_NOT_CONFIGURED` error with an actionable message and a Retry button in the UI.
- Planning workflows: run on the **clearly-labeled mock provider** so the full UX (drafts → approval → real records) is demoable offline; every mock output is schema-valid and labeled.
- Executions: precheck refuses with `EXECUTION_NOT_READY` listing the missing items.

No fake completions are ever presented as real ones.

## 5. Request/timeout/retry policy

- Non-streaming: 120 s timeout, 1 retry on 408/429/5xx/network.
- Streaming: 300 s ceiling; usage extracted from the final chunk (`stream_options.include_usage`), estimated when the provider omits it.
- Provider errors map to `AI_PROVIDER_ERROR` / `AI_BAD_RESPONSE` with the provider's message preserved.
