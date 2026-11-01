import { getDb, newId, nowIso, withTransaction } from '../db/database.js';
import { hashPassword, verifyPassword } from '../util/crypto.js';
import { AppError } from '../util/appError.js';
import { ErrorCodes, type AuthSession, type User, type Workspace } from '@devflow/shared';
import { signJwt } from '../util/jwt.js';
import { config } from '../config.js';
import { acceptInvitesForEmail } from './workspace.service.js';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
}

interface WorkspaceRow {
  id: string;
  owner_user_id: string;
  name: string;
  created_at: string;
}

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id, ownerId: row.owner_user_id, name: row.name, createdAt: row.created_at };
}

export function register(name: string, email: string, password: string): AuthSession {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
    | { id: string }
    | undefined;
  if (existing) {
    throw new AppError(409, ErrorCodes.CONFLICT, 'An account with this email already exists');
  }
  const userId = newId();
  const workspaceId = newId();
  const ts = nowIso();

  withTransaction(() => {
    db.prepare(
      'INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, email, name, hashPassword(password), ts);
    db.prepare(
      'INSERT INTO workspaces (id, owner_user_id, name, created_at) VALUES (?, ?, ?, ?)'
    ).run(workspaceId, userId, `${name}'s workspace`, ts);
  });

  acceptInvitesForEmail(email, userId);
  return issueSession(userId);
}

export function login(email: string, password: string): AuthSession {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
    | UserRow
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AppError(401, ErrorCodes.UNAUTHENTICATED, 'Invalid email or password');
  }
  acceptInvitesForEmail(email, row.id);
  return issueSession(row.id);
}

export function issueSession(userId: string): AuthSession {
  const db = getDb();
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
    | UserRow
    | undefined;
  if (!userRow) throw AppError.notFound('User');
  const wsRow = db
    .prepare('SELECT * FROM workspaces WHERE owner_user_id = ? ORDER BY created_at LIMIT 1')
    .get(userId) as unknown as unknown as WorkspaceRow | undefined;
  if (!wsRow) throw AppError.notFound('Workspace');

  const token = signJwt({ sub: userRow.id, email: userRow.email }, config.appSecret);
  return { token, user: toUser(userRow), workspace: toWorkspace(wsRow) };
}

export function getUser(userId: string): { user: User; workspace: Workspace } {
  const db = getDb();
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
    | UserRow
    | undefined;
  if (!userRow) throw AppError.notFound('User');
  const wsRow = db
    .prepare('SELECT * FROM workspaces WHERE owner_user_id = ? ORDER BY created_at LIMIT 1')
    .get(userId) as unknown as unknown as WorkspaceRow | undefined;
  if (!wsRow) throw AppError.notFound('Workspace');
  return { user: toUser(userRow), workspace: toWorkspace(wsRow) };
}

export function updateName(userId: string, name: string): { user: User; workspace: Workspace } {
  const db = getDb();
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
  return getUser(userId);
}
