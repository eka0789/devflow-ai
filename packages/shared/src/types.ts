/**
 * DevFlow AI — shared domain types.
 * Single source of truth consumed by the API server and the web client.
 */

// ---------- Users & workspaces ----------

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  user: User;
  workspace: Workspace;
}

export interface Workspace {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
}

// ---------- Projects ----------

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'archived';

export interface Project {
  id: string;
  workspaceId: string;
  ownerId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  techStack: string[];
  repoFullName: string | null;
  repoDefaultBranch: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- Backlog: epics / stories / tasks / subtasks ----------

export type BacklogStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'blocked'
  | 'done'
  | 'cancelled';

export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface Epic {
  id: string;
  projectId: string;
  title: string;
  description: string;
  color: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Story {
  id: string;
  projectId: string;
  epicId: string | null;
  sprintId: string | null;
  title: string;
  description: string;
  status: BacklogStatus;
  priority: Priority;
  points: number;
  position: number;
  acceptanceCriteria: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  storyId: string;
  title: string;
  description: string;
  status: BacklogStatus;
  priority: Priority;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  position: number;
}

export interface StoryDependency {
  storyId: string;
  dependsOnStoryId: string;
}

export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
}

/** Centralized, enforced transitions for stories and tasks. */
export const VALID_TRANSITIONS: Record<BacklogStatus, BacklogStatus[]> = {
  backlog: ['todo', 'cancelled'],
  todo: ['in_progress', 'backlog', 'cancelled'],
  in_progress: ['in_review', 'todo', 'blocked'],
  in_review: ['done', 'in_progress', 'blocked'],
  blocked: ['todo', 'in_progress'],
  done: ['todo'], // explicit reopen
  cancelled: ['todo'], // explicit restore
};

export interface StatusEvent {
  id: string;
  projectId: string;
  entityType: 'story' | 'task';
  entityId: string;
  fromStatus: BacklogStatus;
  toStatus: BacklogStatus;
  actorUserId: string;
  createdAt: string;
}

// ---------- Sprints ----------

export type SprintStatus = 'planned' | 'active' | 'completed' | 'cancelled';

export interface Sprint {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  status: SprintStatus;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ---------- AI chat ----------

export type ChatRole = 'user' | 'assistant' | 'system';

export interface Conversation {
  id: string;
  userId: string;
  projectId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
}

// ---------- AI provider settings ----------

export interface AISettingsPublic {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  source: 'user' | 'env' | 'none';
}

export interface AISettingsUpdate {
  baseUrl: string;
  apiKey: string | null; // null keeps existing key
  model: string;
}

// ---------- Agents & planning drafts ----------

export type AgentRole =
  | 'product_manager'
  | 'architect'
  | 'scrum_master'
  | 'developer'
  | 'code_reviewer'
  | 'qa_engineer'
  | 'technical_writer';

export type DraftType = 'prd' | 'tech_plan' | 'backlog' | 'roadmap';
export type DraftStatus = 'draft' | 'approved' | 'rejected';

export interface Draft {
  id: string;
  projectId: string;
  userId: string;
  type: DraftType;
  title: string;
  content: string;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunStep {
  agent: AgentRole;
  action: string;
  status: 'ok' | 'failed' | 'skipped';
  tokensIn: number;
  tokensOut: number;
  detail: string;
  durationMs: number;
}

export interface AgentRun {
  id: string;
  projectId: string;
  userId: string;
  workflow: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  steps: AgentRunStep[];
  tokensIn: number;
  tokensOut: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Structured backlog proposal produced by the scrum-master agent. */
export interface BacklogProposal {
  epics: Array<{
    title: string;
    description: string;
    color?: string;
    stories: Array<{
      title: string;
      description: string;
      points: number;
      priority: Priority;
      acceptanceCriteria: string[];
      dependencies?: string[]; // titles of prerequisite stories
      tasks: Array<{
        title: string;
        description: string;
        subtasks?: string[];
      }>;
    }>;
  }>;
}

// ---------- GitHub ----------

export interface GitHubRepoSummary {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  updatedAt: string;
}

export interface GitHubBranch {
  name: string;
  sha: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  headBranch: string;
  baseBranch: string;
  url: string;
  ciStatus: 'success' | 'failure' | 'pending' | 'none';
  mergeable: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

// ---------- Execution runner ----------

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'awaiting_review'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type ExecutionMode = 'api' | 'docker';

export interface ExecutionFileChange {
  path: string;
  action: 'add' | 'modify' | 'delete';
  before?: string;
  after?: string;
}

export interface ExecutionStepLog {
  step: string;
  status: 'ok' | 'failed' | 'skipped';
  detail: string;
  durationMs: number;
  at: string;
}

export interface Execution {
  id: string;
  projectId: string;
  taskId: string;
  userId: string;
  status: ExecutionStatus;
  mode: ExecutionMode;
  summary: string | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  changes: ExecutionFileChange[];
  logs: ExecutionStepLog[];
  testResult: { status: 'passed' | 'failed' | 'skipped'; detail: string } | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

// ---------- Notifications / activity / audit ----------

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface Activity {
  id: string;
  projectId: string;
  userId: string | null;
  type: string;
  message: string;
  createdAt: string;
}

// ---------- Analytics ----------

export interface DashboardStats {
  projectsTotal: number;
  projectsActive: number;
  openStories: number;
  doneStories: number;
  openTasks: number;
  activeSprints: number;
  executionsThisMonth: number;
  tokensThisMonth: number;
  prsOpen: number;
}

export interface VelocityPoint {
  sprint: string;
  sprintId: string;
  committed: number;
  completed: number;
}

export interface BurndownPoint {
  date: string;
  remaining: number;
  ideal: number;
}

export interface SprintMetrics {
  sprint: Sprint;
  totalPoints: number;
  donePoints: number;
  totalStories: number;
  doneStories: number;
  openTasks: number;
  burndown: BurndownPoint[];
  completionRate: number;
}

export interface AIUsageStats {
  tokensIn: number;
  tokensOut: number;
  requests: number;
  byDay: Array<{ date: string; tokens: number; requests: number }>;
}

export interface ExecutionStats {
  total: number;
  succeeded: number;
  failed: number;
  awaitingReview: number;
  byDay: Array<{ date: string; total: number; failed: number }>;
}
