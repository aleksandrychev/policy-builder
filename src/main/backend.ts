import { spawn } from 'child_process';
import { app } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';

import type { CompiledPolicy } from '../preload/api';

/**
 * Runs the bundled Python sidecar (see `python/`): one short-lived process per
 * action, input on stdin, result on stdout, diagnostics on stderr.
 */

const FORMAT_TIMEOUT_MS = 30_000;
const COMPILE_TIMEOUT_MS = 30_000;
// Downloading masterfiles on a slow network can take a while.
const INIT_TIMEOUT_MS = 120_000;
// Docker queries and the release-data lookup (a network fetch).
const TESTENV_TIMEOUT_MS = 60_000;

const isWindows = process.platform === 'win32';
const executableName = isWindows ? 'cfpb-backend.exe' : 'cfpb-backend';

type SidecarResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
};

/**
 * Packaged: the PyInstaller bundle in the app's resources. Development: that
 * bundle if built, else the uv virtualenv (`npm run backend:sync` suffices).
 */
function resolveCommand(): { command: string; commandArgs: string[] } {
  if (app.isPackaged) {
    return { command: join(process.resourcesPath, 'backend', executableName), commandArgs: [] };
  }

  // __dirname is out/main in development, so two levels up is the repo root.
  const repoRoot = join(__dirname, '../..');
  const bundled = join(repoRoot, 'python/dist/cfpb-backend', executableName);
  if (existsSync(bundled)) {
    return { command: bundled, commandArgs: [] };
  }

  const venvPython = join(repoRoot, 'python/.venv', isWindows ? 'Scripts/python.exe' : 'bin/python');
  return { command: venvPython, commandArgs: ['-m', 'cfpb_backend'] };
}

// Spawns the sidecar with `args`, feeds `input` on stdin, and resolves with the
// raw outcome; rejects only when the process cannot be spawned at all.
function runSidecar(args: string[], input: string, timeoutMs: number): Promise<SidecarResult> {
  const { command, commandArgs } = resolveCommand();
  if (!existsSync(command)) {
    return Promise.reject(new Error(`Python backend not found at ${command} — run \`npm run backend:build\` (or \`npm run backend:sync\` for development)`));
  }

  return new Promise<SidecarResult>((resolve, reject) => {
    // `timeout` SIGTERMs a hung child, surfacing as 'close' with that signal.
    // No guard flag: settling an already-settled promise is a no-op.
    const child = spawn(command, [...commandArgs, ...args], { windowsHide: true, timeout: timeoutMs });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    // A failed spawn (no execute permission, wrong architecture) arrives as an
    // event rather than a throw, so it has to become a rejection.
    child.on('error', error => reject(error));

    // Without a listener, EPIPE from a child that died before draining stdin
    // would crash the main process. 'close' still settles with the real cause.
    child.stdin.on('error', () => {});

    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));

    child.stdin.end(input, 'utf8');
  });
}

/** A streaming sidecar run: one JSON event per stdout line, until the process ends. */
export interface SidecarStream {
  cancel: () => void;
  // Resolves when the process exits: ok, or the last stderr line as the message.
  done: Promise<{ message?: string; ok: boolean }>;
}

/**
 * Spawns the sidecar for a long action (test environments): no timeout, each
 * stdout line parsed as one event and handed to `onEvent` as it arrives.
 */
export function startSidecarStream(args: string[], input: string, onEvent: (event: Record<string, unknown>) => void): SidecarStream {
  const { command, commandArgs } = resolveCommand();
  if (!existsSync(command)) {
    return { cancel: () => {}, done: Promise.resolve({ ok: false, message: `Python backend not found at ${command}` }) };
  }
  const child = spawn(command, [...commandArgs, ...args], { windowsHide: true });
  let buffered = '';
  let stderr = '';
  let cancelled = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as Record<string, unknown>);
      } catch {
        onEvent({ t: 'log', line });
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.on('error', () => {});
  child.stdin.end(input, 'utf8');
  const done = new Promise<{ message?: string; ok: boolean }>(resolve => {
    child.on('error', error => resolve({ ok: false, message: error.message }));
    child.on('close', code => {
      logStderr(stderr);
      if (cancelled) return resolve({ ok: false, message: 'Cancelled' });
      const lastLine = stderr.trim().split(/\r?\n/).filter(Boolean).pop();
      resolve(code === 0 ? { ok: true } : { ok: false, message: lastLine ?? `Process failed (exit ${code})` });
    });
  });
  return {
    cancel: () => {
      cancelled = true;
      child.kill('SIGTERM');
    },
    done
  };
}

/** A one-shot test-environment query (`testenv doctor|images|package|status`), resolving with its JSON answer. */
export async function testEnvQuery(action: 'doctor' | 'images' | 'package' | 'platforms' | 'status', input: unknown = {}): Promise<unknown> {
  const result = await runSidecar(['testenv', action], JSON.stringify(input), TESTENV_TIMEOUT_MS);
  logStderr(result.stderr);
  if (result.code !== 0) throw sidecarError(result, TESTENV_TIMEOUT_MS);
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw Object.assign(new Error('Python backend returned an unreadable answer'), { details: result.stdout });
  }
}

// Maps a failed sidecar outcome to an Error: the last stderr line as the
// message (the sidecar's summary), the whole stderr as `details`.
function sidecarError({ code, signal, stderr }: SidecarResult, timeoutMs: number): Error & { details: string } {
  const details = stderr.trim();
  const lastLine = details
    .split(/\r?\n/)
    .filter(line => line.trim())
    .pop();
  let message: string;
  // SIGTERM only ever comes from the spawn timeout
  if (signal === 'SIGTERM') message = `Process timed out after ${timeoutMs}ms`;
  else message = lastLine ?? (signal ? `Process was killed by ${signal}` : `Process failed (exit ${code})`);
  return Object.assign(new Error(message), { details });
}

// Forward diagnostics so sidecar warnings show in the Electron console.
function logStderr(stderr: string) {
  if (stderr.trim()) console.error(`[cfpb-backend] ${stderr.trim()}`);
}

/**
 * Formats CFEngine policy, resolving with the formatted text
 */
export async function formatPolicy(source: string): Promise<string> {
  const result = await runSidecar(['format'], source, FORMAT_TIMEOUT_MS);
  logStderr(result.stderr);
  if (result.code === 0) return result.stdout;
  throw sidecarError(result, FORMAT_TIMEOUT_MS);
}

export type InitCfbsProjectOptions = {
  // The builder's own content (modules, provided module, project data), written before the initial commit.
  content?: { modules: unknown[]; project: object; provided: object };
  description: string;
  directory: string;
  git: boolean;
  masterfiles: string;
  name: string;
  // A module gets no cfbs init and no masterfiles: its cfbs.json provides the project.
  type: 'module' | 'policy-set';
};

export type InitCfbsProjectResult = {
  masterfiles: Record<string, unknown> | null;
  path: string;
};

/**
 * Creates a cfbs project in `directory` (absent or empty). Rejects with the
 * sidecar's one-line summary as the message and its full stderr as `details`.
 */
export async function initCfbsProject(options: InitCfbsProjectOptions): Promise<InitCfbsProjectResult> {
  const result = await runSidecar(['init'], JSON.stringify(options), INIT_TIMEOUT_MS);
  logStderr(result.stderr);
  if (result.code !== 0) throw sidecarError(result, INIT_TIMEOUT_MS);
  try {
    return JSON.parse(result.stdout) as InitCfbsProjectResult;
  } catch {
    throw Object.assign(new Error('Python backend returned an unreadable init result'), { details: result.stdout });
  }
}

/**
 * Generates the policy for the builder's project data (.policy-builder/project.json),
 * resolving with every generated file by project path (the .cf files, and the
 * templates in ./templates/) and where each block landed in them.
 */
export async function compilePolicy(project: unknown): Promise<CompiledPolicy> {
  const result = await runSidecar(['compile'], JSON.stringify(project), COMPILE_TIMEOUT_MS);
  logStderr(result.stderr);
  if (result.code !== 0) throw sidecarError(result, COMPILE_TIMEOUT_MS);
  try {
    const parsed = JSON.parse(result.stdout) as {
      files: Record<string, string>;
      source_map?: CompiledPolicy['sourceMap'];
    };
    if (typeof parsed.files !== 'object' || parsed.files === null) throw new Error('no files');
    return { files: parsed.files, sourceMap: parsed.source_map ?? {} };
  } catch {
    throw Object.assign(new Error('Python backend returned an unreadable compile result'), { details: result.stdout });
  }
}

/**
 * Runs the sidecar once with an empty project, in the background. The first run of a new
 * build is slow (macOS checks the bundle's binaries, ~10 s): this takes it at launch,
 * not on the first save or Generated Policy view.
 */
export function warmUpSidecar(): void {
  const started = Date.now();
  compilePolicy({ files: [] })
    .then(() => console.log(`[backend] warm-up done in ${Date.now() - started} ms`))
    .catch((error: unknown) => console.warn('[backend] warm-up failed:', error instanceof Error ? error.message : error));
}

/**
 * The masterfiles build entry cfbs writes for `version` ("3.27.1" or "master"), for turning a
 * module into a policy set. Needs the network, like New Project.
 */
export async function masterfilesEntry(version: string): Promise<Record<string, unknown>> {
  const result = await runSidecar(['masterfiles'], JSON.stringify({ version }), INIT_TIMEOUT_MS);
  logStderr(result.stderr);
  if (result.code !== 0) throw sidecarError(result, INIT_TIMEOUT_MS);
  try {
    const entry = JSON.parse(result.stdout) as Record<string, unknown>;
    if (typeof entry !== 'object' || entry === null || entry.name !== 'masterfiles') throw new Error('not a masterfiles entry');
    return entry;
  } catch {
    throw Object.assign(new Error('Python backend returned an unreadable masterfiles entry'), { details: result.stdout });
  }
}
