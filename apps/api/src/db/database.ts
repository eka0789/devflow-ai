/**
 * SQLite access layer built on node:sqlite (bundled with Node >= 22.5).
 * Synchronous driver — transactions are safe without extra coordination.
 */
import { DatabaseSync } from 'node:sqlite';
import { logger } from '../util/logger.js';

let instance: DatabaseSync | null = null;

export function openDatabase(filePath: string): DatabaseSync {
  if (instance) return instance;
  instance = new DatabaseSync(filePath);
  instance.exec('PRAGMA journal_mode = WAL;');
  instance.exec('PRAGMA foreign_keys = ON;');
  instance.exec('PRAGMA busy_timeout = 5000;');
  logger.info('database opened', { path: filePath });
  return instance;
}

export function getDb(): DatabaseSync {
  if (!instance) throw new Error('Database not opened — call openDatabase() first');
  return instance;
}

/** Test helper: swap the active connection (in-memory DBs in unit tests). */
export function setDb(db: DatabaseSync): void {
  instance = db;
}

export function closeDatabase(): void {
  instance?.close();
  instance = null;
}

export function withTransaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
