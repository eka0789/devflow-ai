/** Minimal structured JSON logger. One line per event. Never log secrets. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
let minLevel: LogLevel = 'info';

export function setLogLevel(level: string): void {
  if (level in LEVELS) minLevel = level as LogLevel;
}

export interface LogContext {
  [key: string]: unknown;
}

function write(level: LogLevel, msg: string, ctx?: LogContext): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...ctx });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  setLevel: setLogLevel,
  debug: (msg: string, ctx?: LogContext) => write('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext) => write('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => write('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext) => write('error', msg, ctx),
};
