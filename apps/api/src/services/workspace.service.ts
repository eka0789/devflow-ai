/**
 * Workspace membership: roles (owner | maintainer | viewer), invitations and
 * the authorization primitives used across services.
 *
 * Access model: a project is readable by any member of its workspace and
 * writable by the project owner or workspace maintainers/owners. Viewers are
 * read-only. Non-members get 404 (no existence leak).
 */
import { getDb, newId, nowIso, withTransaction } from '../db/database.js';
import { AppError } from '../util/appError.js';
import type { WorkspaceInvite, WorkspaceMember, WorkspaceRole, WorkspaceRoster } from '@devflow/shared';

export function getWorkspaceRole(workspaceId: string, userId: string): WorkspaceRole | null {
  const ws = getDb().prepare('SELECT owner_user_id FROM workspaces WHERE id = ?').get(workspaceId) as
    | { owner_user_id: string }
    | undefined;
  if (!ws) return null;
  if (ws.owner_user_id === userId) return 'owner';
  const m = getDb()
    .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(workspaceId, userId) as { role: string } | undefined;
  return m ? (m.role as WorkspaceRole) : null;
}

export function isWorkspaceMember(workspaceId: string, userId: string): boolean {
  return getWorkspaceRole(workspaceId, userId) !== null;
}

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 1, maintainer: 2, owner: 3 };

/** Throws 403 when the user's role is below `min`. Members-only by design. */
export function requireWorkspaceRole(workspaceId: string, userId: string, min: WorkspaceRole): WorkspaceRole {
  const role = getWorkspaceRole(workspaceId, userId);
  if (!role) throw AppError.notFound('Workspace');
  if (ROLE_RANK[role] < ROLE_RANK[min]) {
    throw AppError.forbidden(`${min} access required`);
  }
  return role;
}

/** Materializes pending invites for an email (called on login/register). */
export function acceptInvitesForEmail(email: string, userId: string): number {
  const db = getDb();
  const pending = db
    .prepare('SELECT id, workspace_id, role FROM workspace_invites WHERE email = ? AND accepted_at IS NULL')
    .all(email.toLowerCase()) as Array<{ id: string; workspace_id: string; role: string }>;
  let added = 0;
  for (const invite of pending) {
    withTransaction(() => {
      db.prepare(
        'INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(newId(), invite.workspace_id, userId, invite.role, nowIso());
      db.prepare('UPDATE workspace_invites SET accepted_at = ? WHERE id = ?').run(nowIso(), invite.id);
    });
    added++;
  }
  return added;
}

// ---------- roster ----------

export function getRoster(workspaceId: string, userId: string): WorkspaceRoster {
  // only the workspace owner manages members; members may read the roster
  requireWorkspaceRole(workspaceId, userId, 'viewer');
  const db = getDb();
  const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as
    | { id: string; owner_user_id: string; name: string; created_at: string }
    | undefined;
  if (!ws) throw AppError.notFound('Workspace');

  const memberRows = db
    .prepare(
      `SELECT m.id, m.workspace_id, m.user_id, m.role, m.created_at, u.name AS user_name, u.email AS user_email
       FROM workspace_members m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY m.created_at`
    )
    .all(workspaceId) as unknown as Array<{
    id: string;
    workspace_id: string;
    user_id: string;
    role: string;
    created_at: string;
    user_name: string | null;
    user_email: string | null;
  }>;

  const members: WorkspaceMember[] = memberRows.map((m) => ({
    id: m.id,
    workspaceId: m.workspace_id,
    userId: m.user_id,
    userName: m.user_name,
    userEmail: m.user_email,
    role: m.role as WorkspaceRole,
    createdAt: m.created_at,
  }));
  // the implicit owner entry
  if (!members.some((m) => m.userId === ws.owner_user_id)) {
    const owner = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(ws.owner_user_id) as
      | { id: string; name: string; email: string; created_at: string }
      | undefined;
    if (owner) {
      members.unshift({
        id: `owner-${ws.id}`,
        workspaceId: ws.id,
        userId: owner.id,
        userName: owner.name,
        userEmail: owner.email,
        role: 'owner',
        createdAt: owner.created_at,
      });
    }
  }

  const inviteRows = db
    .prepare('SELECT * FROM workspace_invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY created_at')
    .all(workspaceId) as unknown as Array<{
    id: string;
    workspace_id: string;
    email: string;
    role: string;
    invited_by_user_id: string;
    created_at: string;
  }>;
  const invites: WorkspaceInvite[] = inviteRows.map((i) => ({
    id: i.id,
    workspaceId: i.workspace_id,
    email: i.email,
    role: i.role as WorkspaceRole,
    invitedByUserId: i.invited_by_user_id,
    createdAt: i.created_at,
    acceptedAt: null,
  }));

  return {
    workspace: { id: ws.id, ownerId: ws.owner_user_id, name: ws.name, createdAt: ws.created_at },
    members,
    invites,
  };
}

export function inviteMember(
  workspaceId: string,
  inviterUserId: string,
  email: string,
  role: 'maintainer' | 'viewer'
): WorkspaceInvite {
  requireWorkspaceRole(workspaceId, inviterUserId, 'owner');
  const db = getDb();
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
  const id = newId();
  const ts = nowIso();
  if (existingUser) {
    // known account → grant membership immediately
    withTransaction(() => {
      db.prepare(
        'INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(newId(), workspaceId, existingUser.id, role, ts);
      db.prepare(
        'INSERT INTO workspace_invites (id, workspace_id, email, role, invited_by_user_id, created_at, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, workspaceId, email, role, inviterUserId, ts, ts);
    });
  } else {
    db.prepare(
      'INSERT INTO workspace_invites (id, workspace_id, email, role, invited_by_user_id, created_at, accepted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
    ).run(id, workspaceId, email, role, inviterUserId, ts);
  }
  return {
    id,
    workspaceId,
    email,
    role,
    invitedByUserId: inviterUserId,
    createdAt: ts,
    acceptedAt: existingUser ? ts : null,
  };
}

export function revokeInvite(workspaceId: string, inviteId: string, userId: string): void {
  requireWorkspaceRole(workspaceId, userId, 'owner');
  const res = getDb()
    .prepare('DELETE FROM workspace_invites WHERE id = ? AND workspace_id = ?')
    .run(inviteId, workspaceId);
  if (res.changes === 0) throw AppError.notFound('Invite');
}

export function updateMemberRole(
  workspaceId: string,
  targetUserId: string,
  role: 'maintainer' | 'viewer',
  actorUserId: string
): void {
  requireWorkspaceRole(workspaceId, actorUserId, 'owner');
  if (targetUserId === actorUserId) {
    throw AppError.badRequest('VALIDATION_FAILED', 'You cannot change your own role');
  }
  const res = getDb()
    .prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?')
    .run(role, workspaceId, targetUserId);
  if (res.changes === 0) throw AppError.notFound('Member');
}

export function removeMember(workspaceId: string, targetUserId: string, actorUserId: string): void {
  const ws = getDb().prepare('SELECT owner_user_id FROM workspaces WHERE id = ?').get(workspaceId) as
    | { owner_user_id: string }
    | undefined;
  if (!ws) throw AppError.notFound('Workspace');
  if (targetUserId === ws.owner_user_id) {
    throw AppError.badRequest('VALIDATION_FAILED', 'The workspace owner cannot be removed');
  }
  requireWorkspaceRole(workspaceId, actorUserId, 'owner');
  const res = getDb()
    .prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .run(workspaceId, targetUserId);
  if (res.changes === 0) throw AppError.notFound('Member');
}
