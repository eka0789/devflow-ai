/** Schema definition and migrations for the DevFlow AI database. */
import type { DatabaseSync } from 'node:sqlite';

const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planning',
    tech_stack TEXT NOT NULL DEFAULT '[]',
    repo_full_name TEXT,
    repo_default_branch TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);

  CREATE TABLE IF NOT EXISTS epics (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#6E7BFF',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_epics_project ON epics(project_id);

  CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    epic_id TEXT REFERENCES epics(id) ON DELETE SET NULL,
    sprint_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'backlog',
    priority TEXT NOT NULL DEFAULT 'medium',
    points INTEGER NOT NULL DEFAULT 3,
    position INTEGER NOT NULL DEFAULT 0,
    acceptance_criteria TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_stories_project ON stories(project_id);
  CREATE INDEX IF NOT EXISTS idx_stories_sprint ON stories(sprint_id);

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_story ON tasks(story_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);

  CREATE TABLE IF NOT EXISTS subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

  CREATE TABLE IF NOT EXISTS story_dependencies (
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    depends_on_story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    PRIMARY KEY (story_id, depends_on_story_id)
  );

  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on_task_id)
  );

  CREATE TABLE IF NOT EXISTS sprints (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planned',
    starts_at TEXT,
    ends_at TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sprints_project ON sprints(project_id);

  CREATE TABLE IF NOT EXISTS status_events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_status_events_entity ON status_events(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_status_events_project ON status_events(project_id, created_at);

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT,
    title TEXT NOT NULL DEFAULT 'New conversation',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

  CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT,
    kind TEXT NOT NULL,
    model TEXT NOT NULL,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id, created_at);

  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_drafts_project ON drafts(project_id);

  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    workflow TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    steps TEXT NOT NULL DEFAULT '[]',
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id);

  CREATE TABLE IF NOT EXISTS user_secrets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    github_token_enc TEXT,
    ai_api_key_enc TEXT,
    ai_base_url TEXT,
    ai_model TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activities_project ON activities(project_id, created_at);

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type, target_id);

  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    mode TEXT NOT NULL DEFAULT 'api',
    summary TEXT,
    branch TEXT,
    pr_number INTEGER,
    pr_url TEXT,
    changes TEXT NOT NULL DEFAULT '[]',
    logs TEXT NOT NULL DEFAULT '[]',
    test_result TEXT,
    diff TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_executions_project ON executions(project_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_executions_task ON executions(task_id);

  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    delivery_id TEXT NOT NULL UNIQUE,
    project_id TEXT,
    event TEXT NOT NULL,
    payload TEXT NOT NULL,
    processed_at TEXT
  );
  `,
  // v2 — sprint completion metrics snapshot
  `
  ALTER TABLE sprints ADD COLUMN metrics_snapshot TEXT;
  `,

  // v3 — task comments
  `
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
  `,

  // v4 — double-submit guards (partial unique indexes) + webhook query index
  `
  CREATE UNIQUE INDEX IF NOT EXISTS uq_executions_task_inflight
    ON executions(task_id) WHERE status IN ('queued', 'running');
  CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_runs_project_running
    ON agent_runs(project_id) WHERE status = 'running';
  CREATE INDEX IF NOT EXISTS idx_webhook_events_project ON webhook_events(project_id, event);
  `,

  // v5 — collaboration wave: assignee/due dates, labels, workspace members,
  // invites, outgoing webhooks
  `
  ALTER TABLE stories ADD COLUMN assignee_user_id TEXT;
  ALTER TABLE stories ADD COLUMN due_date TEXT;
  ALTER TABLE tasks ADD COLUMN assignee_user_id TEXT;
  ALTER TABLE tasks ADD COLUMN due_date TEXT;

  CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6E7BFF',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_labels_project ON labels(project_id);

  CREATE TABLE story_labels (
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (story_id, label_id)
  );

  CREATE TABLE task_labels (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
  );

  CREATE TABLE workspace_members (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at TEXT NOT NULL,
    UNIQUE (workspace_id, user_id)
  );
  CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);

  CREATE TABLE workspace_invites (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    invited_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    accepted_at TEXT,
    UNIQUE (workspace_id, email)
  );
  CREATE INDEX idx_workspace_invites_email ON workspace_invites(email);

  CREATE TABLE outgoing_webhooks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    secret_enc TEXT,
    format TEXT NOT NULL DEFAULT 'generic',
    events TEXT NOT NULL DEFAULT '["*"]',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  `,
];

export function runMigrations(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number };
  const current = row.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec(MIGRATIONS[v]!);
    db.exec(`PRAGMA user_version = ${v + 1};`);
  }
}
