import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { ChatMessage, Conversation, Project } from '@devflow/shared';
import { api, apiStream } from '../lib/api';
import { formatRelative, useApi, useToast } from '../lib/hooks';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Field, Select } from '../components/Field';
import { Modal } from '../components/Modal';
import { Skeleton } from '../components/Skeleton';
import { MarkdownView } from '../components/MarkdownView';
import { IconChat, IconPlus, IconSend, IconTrash, IconX } from '../components/icons';

function shortTitle(c: Conversation): string {
  if (c.title && c.title.trim()) return c.title;
  return 'New conversation';
}

export function ChatPage(): JSX.Element {
  const toast = useToast();
  const conversations = useApi<Conversation[]>(() => api.get<Conversation[]>('/conversations'), []);
  const projects = useApi<Project[]>(() => api.get<Project[]>('/projects'), []);

  const [activeId, setActiveId] = useState<string | null>(null);
  const conv = useApi<{ conversation: Conversation; messages: ChatMessage[] } | null>(
    () => (activeId ? api.get<{ conversation: Conversation; messages: ChatMessage[] }>(`/conversations/${activeId}`) : Promise.resolve(null)),
    [activeId],
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamError, setStreamError] = useState<{ code: string; message: string } | null>(null);
  const lastSentRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [newConvProject, setNewConvProject] = useState('');
  const [newConvBusy, setNewConvBusy] = useState(false);

  // Keep local messages in sync with the loaded conversation.
  useEffect(() => {
    if (conv.data) setMessages(conv.data.messages);
  }, [conv.data]);

  // Reset transient state when switching conversations.
  useEffect(() => {
    setMessages([]);
    setStreamText(null);
    setStreamError(null);
  }, [activeId]);

  // Stop any in-flight stream when switching conversations or unmounting.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [activeId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamText, streamError]);

  const send = async (content: string): Promise<void> => {
    if (!activeId || sending || content.trim().length === 0) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    lastSentRef.current = content;
    setSending(true);
    setStreamError(null);
    setStreamText('');

    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      conversationId: activeId,
      role: 'user',
      content,
      model: null,
      tokensIn: 0,
      tokensOut: 0,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);

    await apiStream(
      `/conversations/${activeId}/chat`,
      { content },
      {
        signal: controller.signal,
        onDelta: (t) => setStreamText((s) => (s ?? '') + t),
        onDone: (data) => {
          const payload = data as { message?: ChatMessage; conversation?: Conversation };
          setStreamText(null);
          if (payload.message) {
            setMessages((m) => [...m, payload.message!]);
          }
          void conv.reload();
          void conversations.reload();
        },
        onError: (e) => {
          setStreamText(null);
          setStreamError(e);
        },
      },
    );
    setSending(false);
  };

  const retry = (): void => {
    setStreamError(null);
    void send(lastSentRef.current);
  };

  const createConversation = async (): Promise<void> => {
    setNewConvBusy(true);
    try {
      const c = await api.post<Conversation>('/conversations', {
        projectId: newConvProject || null,
      });
      setCreating(false);
      setNewConvProject('');
      void conversations.reload();
      setActiveId(c.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create conversation');
    } finally {
      setNewConvBusy(false);
    }
  };

  const deleteConversation = async (id: string): Promise<void> => {
    try {
      await api.del(`/conversations/${id}`);
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
      void conversations.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete conversation');
    }
  };

  const list = conversations.data ?? [];
  const activeConv = conv.data?.conversation;
  const title = activeConv
    ? activeConv.title && activeConv.title.trim()
      ? activeConv.title
      : (messages.find((m) => m.role === 'user')?.content ?? 'New conversation').slice(0, 40) + ((messages.find((m) => m.role === 'user')?.content.length ?? 0) > 40 ? '…' : '')
    : 'AI Chat';

  const emptyList = useMemo(() => conversations.loading === false && list.length === 0, [conversations.loading, list.length]);

  return (
    <div className="chat-layout" style={{ height: '100%' }}>
      <aside className="chat-list">
        <div className="chat-list-header">
          <span className="weight-600">Conversations</span>
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)} aria-label="New conversation">
            <IconPlus size={13} />
            New
          </button>
        </div>
        <div className="chat-list-scroll">
          {conversations.loading ? (
            <div className="stack gap-2">
              <Skeleton height={44} />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          ) : conversations.error ? (
            <ErrorState error={conversations.error} onRetry={conversations.reload} compact title="Failed to load" />
          ) : list.length === 0 ? (
            <div className="muted text-sm" style={{ padding: '10px 6px' }}>
              No conversations yet. Start one — the AI knows your workspace.
            </div>
          ) : (
            list.map((c) => {
              const project = projects.data?.find((p) => p.id === c.projectId);
              return (
                <div
                  key={c.id}
                  className={`conv-item ${activeId === c.id ? 'active' : ''}`}
                  onClick={() => {
                    if (activeId !== c.id) setActiveId(c.id);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setActiveId(c.id);
                  }}
                >
                  <div className="conv-title">{shortTitle(c)}</div>
                  <div className="conv-meta">
                    {project ? `${project.name} · ` : ''}
                    {formatRelative(c.updatedAt)}
                  </div>
                  <button
                    className="conv-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteConversation(c.id);
                    }}
                    aria-label="Delete conversation"
                  >
                    <IconTrash size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      <div className="chat-main">
        {activeId === null ? (
          <div className="flex-1 row justify-center" style={{ padding: 24 }}>
            <div style={{ maxWidth: 420, width: '100%', alignSelf: 'center' }}>
              <EmptyState
                title="AI Chat"
                description="Ask anything about your projects, backlog or code. Conversations can be scoped to a project for extra context."
                icon={<IconChat size={18} />}
                action={
                  <button className="btn btn-primary" onClick={() => setCreating(true)}>
                    <IconPlus size={14} />
                    New conversation
                  </button>
                }
              />
            </div>
          </div>
        ) : (
          <>
            <div className="row gap-2" style={{ padding: '12px 24px 0' }}>
              <span className="weight-600 truncate flex-1">{title}</span>
              {conv.refreshing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}
            </div>
            <div className="chat-messages" ref={scrollRef}>
              <div className="chat-messages-inner">
                {conv.loading && messages.length === 0 ? (
                  <Skeleton height={200} />
                ) : conv.error ? (
                  <ErrorState error={conv.error} onRetry={conv.reload} title="Failed to load conversation" />
                ) : messages.length === 0 && streamText === null ? (
                  <EmptyState
                    compact
                    title="Say hello"
                    description="Ask the AI to review your backlog, draft a story, or explain part of your codebase."
                  />
                ) : (
                  <>
                    {messages.map((m) => (
                      <div key={m.id} className={`msg msg-${m.role}`}>
                        <div className={`msg-avatar ${m.role}`}>{m.role === 'assistant' ? 'DF' : 'You'}</div>
                        <div className="msg-body">
                          <div className="msg-role">{m.role === 'assistant' ? 'DevFlow AI' : 'You'}</div>
                          {m.role === 'assistant' ? (
                            <div className="msg-bubble">
                              <MarkdownView source={m.content} />
                            </div>
                          ) : (
                            <div className="msg-bubble">{m.content}</div>
                          )}
                        </div>
                      </div>
                    ))}
                    {streamText !== null ? (
                      <div className="msg msg-assistant">
                        <div className="msg-avatar assistant">DF</div>
                        <div className="msg-body">
                          <div className="msg-role">DevFlow AI</div>
                          {streamText === '' ? (
                            <div className="msg-bubble">
                              <div className="typing-dots" aria-label="Assistant is typing">
                                <span />
                                <span />
                                <span />
                              </div>
                            </div>
                          ) : (
                            <div className="msg-bubble">
                              <MarkdownView source={streamText} />
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                    {streamError ? (
                      <div className="msg msg-assistant">
                        <div className="msg-avatar assistant">DF</div>
                        <div className="msg-body">
                          <div className="msg-error">
                            <span className="flex-1">
                              {streamError.code === 'AI_NOT_CONFIGURED'
                                ? 'No AI provider is configured. Set one up in Settings.'
                                : streamError.message}
                            </span>
                            <button className="btn btn-sm" onClick={retry}>
                              Retry
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
            <div className="chat-inputbar">
              <div className="chat-inputbar-inner">
                <textarea
                  className="chat-textarea"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (input.trim()) {
                        const content = input.trim();
                        setInput('');
                        void send(content);
                      }
                    }
                  }}
                  placeholder={sending ? 'DevFlow AI is responding…' : 'Ask anything — Enter to send, Shift+Enter for a new line'}
                  rows={1}
                  disabled={sending}
                  aria-label="Message"
                />
                {sending ? (
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      abortRef.current?.abort();
                      setSending(false);
                      setStreamText(null);
                    }}
                    aria-label="Stop generating"
                  >
                    <IconX size={13} />
                    Stop
                  </button>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      if (input.trim()) {
                        const content = input.trim();
                        setInput('');
                        void send(content);
                      }
                    }}
                    disabled={!input.trim()}
                    aria-label="Send message"
                  >
                    <IconSend size={13} />
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New conversation"
        size="sm"
        footer={
          <>
            <button className="btn" onClick={() => setCreating(false)} disabled={newConvBusy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void createConversation()} disabled={newConvBusy}>
              {newConvBusy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : null}
              Start chatting
            </button>
          </>
        }
      >
        <div className="stack gap-3">
          <Field label="Project context" hint="Optional — gives the AI access to this project's backlog and repo.">
            <Select value={newConvProject} onChange={(e) => setNewConvProject(e.target.value)}>
              <option value="">No project context</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          {emptyList ? <div className="field-hint">This will be your first conversation.</div> : null}
        </div>
      </Modal>
    </div>
  );
}
