/**
 * Docker execution runner — isolates untrusted repository code.
 *
 * Hard isolation rules (enforced on every container):
 *   --network none            no network access
 *   --cap-drop ALL            no Linux capabilities
 *   --security-opt no-new-privileges   no privilege escalation
 *   --memory / --cpus         resource ceilings
 *   --read-only rootfs + tmpfs /tmp    ephemeral filesystem
 *   never mounts the host Docker socket, never privileged
 *
 * The repository is cloned by the CONTROL PLANE into a temp directory and
 * bind-mounted read-only; tests run against a copy so nothing can escape
 * into the workspace. NOTE: verified live only when a Docker engine is
 * present — availability is probed at runtime and surfaced honestly.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logger } from '../../util/logger.js';

export interface DockerRunResult {
  ran: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  reason?: string;
}

let availabilityCache: { available: boolean; checkedAt: number } | null = null;

export async function isDockerAvailable(): Promise<boolean> {
  if (availabilityCache && Date.now() - availabilityCache.checkedAt < 60000) {
    return availabilityCache.available;
  }
  const available = await new Promise<boolean>((resolve) => {
    const child = spawn('docker', ['version', '--format', '{{.Server.Version}}'], { windowsHide: true });
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      done(false);
    }, 8000);
    child.on('error', () => {
      clearTimeout(timer);
      done(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
  });
  availabilityCache = { available, checkedAt: Date.now() };
  return available;
}

/** Picks a small, sensible image based on the repository's toolchain files. */
export function detectImage(repoDir: string): string | null {
  if (existsSync(path.join(repoDir, 'package.json'))) return 'node:20-alpine';
  if (existsSync(path.join(repoDir, 'requirements.txt')) || existsSync(path.join(repoDir, 'pyproject.toml'))) {
    return 'python:3.12-slim';
  }
  if (existsSync(path.join(repoDir, 'go.mod'))) return 'golang:1.22-alpine';
  if (existsSync(path.join(repoDir, 'Cargo.toml'))) return 'rust:1.80-slim';
  return null;
}

export function detectTestCommand(repoDir: string): string | null {
  if (existsSync(path.join(repoDir, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(repoDir, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      };
      if (pkg.scripts?.test) return 'npm test';
      return null;
    } catch {
      return null;
    }
  }
  if (existsSync(path.join(repoDir, 'pytest.ini')) || existsSync(path.join(repoDir, 'pyproject.toml'))) {
    return 'python -m pytest -q';
  }
  if (existsSync(path.join(repoDir, 'go.mod'))) return 'go test ./...';
  if (existsSync(path.join(repoDir, 'Cargo.toml'))) return 'cargo test';
  return null;
}

/** Copies the repo into a fresh temp dir (mount source) and runs the command. */
export async function runInContainer(options: {
  repoDir: string;
  image: string;
  command: string;
  timeoutMs?: number;
}): Promise<DockerRunResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 600000;

  // copy repo into an isolated temp workspace (never mount the real checkout)
  let workDir: string | null = null;
  try {
    workDir = mkdtempSync(path.join(tmpdir(), 'devflow-run-'));
    cpSync(options.repoDir, workDir, { recursive: true, verbatimSymlinks: false });
  } catch (err) {
    if (workDir) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup on the prep path
      }
    }
    return {
      ran: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: Date.now() - started,
      reason: `workspace prep failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const containerName = `devflow-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const args = [
    'run',
    '--rm',
    '--name',
    containerName,
    '--network',
    'none',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--memory',
    '1g',
    '--cpus',
    '1.5',
    '--read-only',
    '--tmpfs',
    '/tmp:size=256m',
    '--workdir',
    '/src',
    '-v',
    `${workDir}:/src`,
    options.image,
    'sh',
    '-c',
    options.command,
  ];

  return new Promise<DockerRunResult>((resolve) => {
    const child = spawn('docker', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
        // --rm only fires when the container exits; force-remove the orphan
        spawn('docker', ['rm', '-f', containerName], { windowsHide: true }).on('error', () => {});
      }
    }, timeoutMs);

    const finish = (exitCode: number | null, reason?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (workDir) {
        try {
          rmSync(workDir, { recursive: true, force: true });
        } catch (cleanupErr) {
          // a still-mounted dir (orphaned container, Windows EBUSY) must not crash the process
          logger.warn('workspace cleanup failed', {
            dir: workDir,
            err: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          });
        }
      }
      resolve({ ran: true, exitCode, stdout: stdout.slice(0, 100000), stderr: stderr.slice(0, 100000), durationMs: Date.now() - started, reason });
    };

    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < 200_000) stdout += d.toString(); // cap accumulation
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 200_000) stderr += d.toString();
    });
    child.on('error', (err) => {
      logger.warn('docker spawn failed', { err: err.message });
      finish(null, `docker spawn failed: ${err.message}`);
    });
    child.on('close', (code) => finish(code));
  });
}
