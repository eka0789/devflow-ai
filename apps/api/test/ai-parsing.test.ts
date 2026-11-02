/**
 * Regression tests for the AI provider response parsing:
 * many providers return different shapes for /chat/completions — the parser
 * must extract the assistant text from all of them, and report the actual
 * shape when it cannot (instead of a bare "empty completion").
 */
import { describe, expect, it, vi } from 'vitest';
import {
  describeResponseShape,
  extractCompletionText,
  extractDeltaText,
  extractUsage,
  normalizeBaseUrl,
} from '../src/services/ai/provider.js';

describe('normalizeBaseUrl', () => {
  it('appends /chat/completions to a bare base', () => {
    expect(normalizeBaseUrl('https://api.example.com')).toBe('https://api.example.com/chat/completions');
    expect(normalizeBaseUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1/chat/completions');
  });

  it('does not duplicate an endpoint the user already pasted', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions'
    );
    expect(normalizeBaseUrl('https://api.example.com/v1/chat/completions/')).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });

  it('rewrites sibling endpoints onto chat/completions', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/completions')).toBe(
      'https://api.example.com/v1/chat/completions'
    );
    expect(normalizeBaseUrl('https://api.example.com/v1/messages')).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });

  it('trims whitespace and trailing slashes', () => {
    expect(normalizeBaseUrl('  https://api.example.com/v1///  ')).toBe('https://api.example.com/v1/chat/completions');
  });
});

describe('extractCompletionText', () => {
  it('reads the canonical chat-completions shape', () => {
    const payload = { choices: [{ message: { role: 'assistant', content: 'hello world' } }] };
    expect(extractCompletionText(payload)).toBe('hello world');
  });

  it('reads Anthropic-style content blocks', () => {
    const payload = { content: [{ type: 'text', text: 'block answer' }] };
    expect(extractCompletionText(payload)).toBe('block answer');
  });

  it('reads a top-level content array', () => {
    const payload = { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] };
    expect(extractCompletionText(payload)).toBe('ab');
  });

  it('reads the Responses-API output shapes', () => {
    expect(extractCompletionText({ output_text: 'resp answer' })).toBe('resp answer');
    const payload = { output: [{ content: [{ type: 'output_text', text: 'nested answer' }] }] };
    expect(extractCompletionText(payload)).toBe('nested answer');
  });

  it('reads reasoning_content used by reasoning models', () => {
    const payload = { choices: [{ message: { content: '', reasoning_content: 'the real answer' } }] };
    expect(extractCompletionText(payload)).toBe('the real answer');
  });

  it('reads text placed directly on the choice or the root', () => {
    expect(extractCompletionText({ choices: [{ text: 'choice text' }] })).toBe('choice text');
    expect(extractCompletionText({ text: 'root text' })).toBe('root text');
  });

  it('returns null when there is genuinely no text', () => {
    expect(extractCompletionText({ choices: [{ message: { content: '' } }] })).toBeNull();
    expect(extractCompletionText({ error: { message: 'bad request' } })).toBeNull();
    expect(extractCompletionText(null)).toBeNull();
  });
});

describe('describeResponseShape', () => {
  it('names the choice/message keys so a mismatch is diagnosable', () => {
    const shape = describeResponseShape({ choices: [{ message: { content: '', reasoning_content: 'x' } }] });
    expect(shape).toContain('message');
    expect(shape).toContain('reasoning_content');
  });

  it('names the root keys for non-chat shapes', () => {
    expect(describeResponseShape({ error: 'nope', detail: 1 })).toContain('error');
  });
});

describe('extractDeltaText', () => {
  it('reads the canonical delta', () => {
    expect(extractDeltaText({ choices: [{ delta: { content: 'chunk' } }] })).toBe('chunk');
  });

  it('reads Anthropic-style streaming deltas', () => {
    expect(extractDeltaText({ type: 'content_block_delta', delta: { text: 'anth chunk' } })).toBe('anth chunk');
  });

  it('reads array deltas and output_text', () => {
    expect(extractDeltaText({ choices: [{ delta: { content: [{ text: 'arr' }] } }] })).toBe('arr');
    expect(extractDeltaText({ output_text: 'ot' })).toBe('ot');
  });

  it('returns null for a keep-alive frame', () => {
    expect(extractDeltaText({ choices: [{ delta: {} }] })).toBeNull();
  });
});

describe('extractUsage', () => {
  it('reads both usage dialects', () => {
    expect(extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 4 } })).toEqual({
      tokensIn: 10,
      tokensOut: 4,
    });
    expect(extractUsage({ usage: { input_tokens: 7, output_tokens: 2 } })).toEqual({ tokensIn: 7, tokensOut: 2 });
    expect(extractUsage({ input_tokens: 3, output_tokens: 1 })).toEqual({ tokensIn: 3, tokensOut: 1 });
    expect(extractUsage({})).toEqual({ tokensIn: 0, tokensOut: 0 });
  });
});
