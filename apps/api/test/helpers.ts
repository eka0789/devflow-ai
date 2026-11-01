import { DatabaseSync } from 'node:sqlite';
import { setDb } from '../src/db/database.js';
import { runMigrations } from '../src/db/schema.js';
import { createApp } from '../src/app.js';
import * as auth from '../src/services/auth.service.js';
import * as projects from '../src/services/projects.service.js';
import type { Express } from 'express';

export function freshDb(): void {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;'); // match production constraints in tests
  setDb(db);
  runMigrations(getRawDb());
}

// import for side effect: raw access for assertions
import { getDb } from '../src/db/database.js';
function getRawDb(): DatabaseSync {
  return getDb();
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  token: string;
  workspaceId: string;
}

export function makeUser(name: string): TestUser {
  const session = auth.register(name, `${name.toLowerCase()}@example.com`, 'password-123');
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    token: session.token,
    workspaceId: session.workspace.id,
  };
}

export function makeProject(userId: string, name = 'Test Project') {
  return projects.createProject(userId, { name, description: 'desc', techStack: ['typescript'] });
}

export function app(): Express {
  return createApp();
}

export function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export { getDb };
