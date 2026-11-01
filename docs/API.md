# DevFlow AI — REST API Reference

Base URL: `/api` (dev: `http://localhost:4310/api`, Vite dev server proxies `/api`).

## Conventions

- All request/response bodies are JSON.
- **Success envelope:** `{ "data": <payload> }`
- **Error envelope:** `{ "error": { "code": "<ErrorCode>", "message": "…", "details": … }, "requestId": "…" }` — see `packages/shared/src/errors.ts` for codes.
- All routes require `Authorization: Bearer <token>` **except** `/api/auth/register`, `/api/auth/login`, `/api/webhooks/*`.
- `401` with code `UNAUTHENTICATED` means the client must redirect to login.
- All project-scoped resources are ownership-isolated: requesting another user's project yields `404 NOT_FOUND`.
- IDs are UUIDs. Timestamps are ISO-8601 UTC strings.

## Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/register` | `{name, email, password}` | `AuthSession {token, user, workspace}` |
| POST | `/auth/login` | `{email, password}` | `AuthSession` |
| POST | `/auth/logout` | — | `{ok:true}` |
| GET | `/auth/me` | — | `{user, workspace}` |
| PATCH | `/auth/me` | `{name}` | `{user, workspace}` |

## Dashboard & Activity

| Method | Path | Returns |
|---|---|---|
| GET | `/dashboard` | `DashboardStats` |
| GET | `/activity?limit=20` | `Activity[]` (across user projects) |

## Projects

| Method | Path | Body/Query | Returns |
|---|---|---|---|
| GET | `/projects` | — | `Project[]` |
| POST | `/projects` | `{name, description, techStack[]}` | `Project` |
| GET | `/projects/:id` | — | `Project` |
| PATCH | `/projects/:id` | `{name?, description?, status?, techStack?}` | `Project` |
| DELETE | `/projects/:id` | — | `{ok:true}` |
| GET | `/projects/:id/activity` | `?limit=` | `Activity[]` |

## Backlog

One-shot tree payload for the backlog UI:

| Method | Path | Returns |
|---|---|---|
| GET | `/projects/:projectId/backlog` | `{epics: Epic[], stories: Story[], tasks: Task[], subtasks: Subtask[], dependencies: {stories: [storyId, dependsOnId][], tasks: [taskId, dependsOnId][]}}` |

Epics:

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/projects/:projectId/epics` | `{title, description, color}` | `Epic` |
| PATCH | `/projects/:projectId/epics/:id` | `{title?, description?, color?}` | `Epic` |
| DELETE | `/projects/:projectId/epics/:id` | — | `{ok:true}` |

Stories:

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/projects/:projectId/stories` | `{epicId?, title, description, points, priority, acceptanceCriteria[]}` | `Story` |
| PATCH | `/projects/:projectId/stories/:id` | `{epicId?, title?, description?, points?, priority?, acceptanceCriteria?}` | `Story` |
| DELETE | `/projects/:projectId/stories/:id` | — | `{ok:true}` |
| POST | `/projects/:projectId/stories/:id/transition` | `{status}` | `Story` |
| POST | `/projects/:projectId/stories/:id/dependencies` | `{dependsOnId}` | `{ok:true}` |
| DELETE | `/projects/:projectId/stories/:id/dependencies/:depId` | — | `{ok:true}` |

Tasks & subtasks:

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/projects/:projectId/tasks` | `{storyId, title, description, priority}` | `Task` |
| GET | `/projects/:projectId/tasks/:id` | — | `{task, story, subtasks, dependencies}` |
| PATCH | `/projects/:projectId/tasks/:id` | `{title?, description?, priority?, position?}` | `Task` |
| DELETE | `/projects/:projectId/tasks/:id` | — | `{ok:true}` |
| POST | `/projects/:projectId/tasks/:id/transition` | `{status}` | `Task` |
| POST | `/projects/:projectId/tasks/:id/subtasks` | `{title}` | `Subtask` |
| PATCH | `/projects/:projectId/tasks/:id/subtasks/:subtaskId` | `{title?, done?}` | `Subtask` |
| DELETE | `/projects/:projectId/tasks/:id/subtasks/:subtaskId` | — | `{ok:true}` |
| POST | `/projects/:projectId/tasks/:id/dependencies` | `{dependsOnId}` | `{ok:true}` |
| DELETE | `/projects/:projectId/tasks/:id/dependencies/:depId` | — | `{ok:true}` |

**Transition rules** (`INVALID_TRANSITION` on violation): see `VALID_TRANSITIONS` in shared types — `backlog→todo|cancelled`, `todo→in_progress|backlog|cancelled`, `in_progress→in_review|todo|blocked`, `in_review→done|in_progress|blocked`, `blocked→todo|in_progress`, `done→todo`, `cancelled→todo`.
**Dependency rule** (`DEPENDENCY_BLOCKED`): a story/task cannot enter `in_progress`/`in_review`/`done` while any story/task it depends on is not `done`.

## Sprints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/projects/:projectId/sprints` | — | `Sprint[]` |
| POST | `/projects/:projectId/sprints` | `{name, goal, startsAt?, endsAt?}` | `Sprint` |
| PATCH | `/projects/:projectId/sprints/:id` | `{name?, goal?, startsAt?, endsAt?}` | `Sprint` |
| POST | `/projects/:projectId/sprints/:id/activate` | — | `Sprint` (fails if another sprint is active or no stories assigned) |
| POST | `/projects/:projectId/sprints/:id/complete` | — | `SprintMetrics` (incomplete stories are carried over to backlog) |
| POST | `/projects/:projectId/sprints/:id/stories` | `{storyId}` | `{ok:true}` |
| DELETE | `/projects/:projectId/sprints/:id/stories/:storyId` | — | `{ok:true}` |
| GET | `/projects/:projectId/sprints/:id/metrics` | — | `SprintMetrics` |
| GET | `/projects/:projectId/velocity` | — | `VelocityPoint[]` |
| GET | `/projects/:projectId/board` | — | `{tasks: (Task & {storyTitle, epicTitle})[], sprints: Sprint[], activeSprint: Sprint|null}` |

## AI — chat & provider

| Method | Path | Body/Query | Returns |
|---|---|---|---|
| GET | `/ai/settings` | — | `AISettingsPublic {configured, baseUrl, model, source}` |
| PUT | `/ai/settings` | `{baseUrl, apiKey?, model}` | `AISettingsPublic` (apiKey omitted/`null` keeps stored key) |
| POST | `/ai/verify` | — | `{ok, model?, latencyMs?, error?}` (real test call) |
| GET | `/ai/usage` | `?days=30` | `AIUsageStats` |
| GET | `/conversations` | `?projectId=` | `Conversation[]` |
| POST | `/conversations` | `{projectId?, title?}` | `Conversation` |
| GET | `/conversations/:id` | — | `{conversation, messages: ChatMessage[]}` |
| DELETE | `/conversations/:id` | — | `{ok:true}` |

### Streaming chat (SSE via POST)

`POST /conversations/:id/chat` body `{content}` → `200 text/event-stream` (read with `fetch` + `ReadableStream`; **do not** use EventSource, it cannot POST).

Events (each `event:` line followed by `data:` line, blank line between events):

```
event: delta
data: {"text":"partial tokens"}

event: done
data: {"message": ChatMessage, "conversation": Conversation}

event: error
data: {"code":"AI_NOT_CONFIGURED","message":"…"}
```

Server persists the user message immediately and the assistant message on completion.

## AI — agents & planning drafts

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/agents` | — | `{agents: {role, name, description}[]}` |
| POST | `/projects/:projectId/workflows` | `{workflow: 'full_planning'\|'prd_only'\|'tech_plan_only'\|'backlog_only', vision}` | `AgentRun` (status `running`; poll) |
| GET | `/projects/:projectId/agent-runs` | `?limit=` | `AgentRun[]` |
| GET | `/projects/:projectId/agent-runs/:runId` | — | `AgentRun` |
| GET | `/projects/:projectId/drafts` | `?type=` | `Draft[]` |
| GET | `/projects/:projectId/drafts/:id` | — | `Draft` |
| POST | `/projects/:projectId/drafts/:id/approve` | `{createRecords?}` | `{draft, created?: {epics, stories, tasks}}` (backlog drafts create real records) |
| POST | `/projects/:projectId/drafts/:id/reject` | — | `Draft` |

## GitHub

| Method | Path | Body/Query | Returns |
|---|---|---|---|
| GET | `/github/status` | — | `{connected}` |
| PUT | `/github/token` | `{token}` | `{connected:true}` |
| DELETE | `/github/token` | — | `{connected:false}` |
| GET | `/github/repos` | — | `GitHubRepoSummary[]` |
| POST | `/projects/:projectId/github/connect` | `{repoFullName}` | `Project` |
| POST | `/projects/:projectId/github/disconnect` | — | `Project` |
| GET | `/projects/:projectId/github/branches` | — | `GitHubBranch[]` |
| GET | `/projects/:projectId/github/commits` | `?branch=` | `GitHubCommit[]` |
| GET | `/projects/:projectId/github/prs` | — | `GitHubPR[]` |
| GET | `/projects/:projectId/github/prs/:number` | — | `{pr: GitHubPR, files: GitHubPRFile[]}` |
| POST | `/projects/:projectId/github/prs/:number/merge` | `{confirmation:'MERGE', mergeMethod}` | `{merged:true, sha}` — refused with `PR_NOT_MERGEABLE` if PR is closed/draft/mergeable=false or CI failing; every merge is recorded in the audit log |

Webhook receiver (no bearer auth; HMAC-validated):

| Method | Path | Headers | Returns |
|---|---|---|---|
| POST | `/webhooks/github` | `X-GitHub-Event`, `X-Hub-Signature-256`, `X-GitHub-Delivery` | `{ok:true}` — `401` on bad signature, deliveries are deduplicated |

## Executions

| Method | Path | Body/Query | Returns |
|---|---|---|---|
| POST | `/tasks/:taskId/execute` | `{createPR?}` | `Execution` (status `queued`, runs async) |
| GET | `/projects/:projectId/executions` | `?limit=` | `Execution[]` |
| GET | `/projects/:projectId/executions/:id` | — | `Execution` |
| GET | `/projects/:projectId/executions/:id/diff` | — | `{diff: string}` |
| POST | `/executions/:id/cancel` | — | `Execution` |
| GET | `/executions/stats` | `?projectId=` | `ExecutionStats` |

Execution prerequisites (`EXECUTION_NOT_READY` lists what's missing): AI provider configured, repo connected, task in `todo`/`in_progress`, no in-flight execution for the task.

## Notifications

| Method | Path | Returns |
|---|---|---|
| GET | `/notifications` | `Notification[]` |
| POST | `/notifications/:id/read` | `{ok:true}` |
| POST | `/notifications/read-all` | `{ok:true}` |
