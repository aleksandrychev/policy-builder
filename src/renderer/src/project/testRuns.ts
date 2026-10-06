import { useSyncExternalStore } from 'react';

import type { TestEnvironment } from '../store/testEnvironmentsSlice/types';
import { contentKey } from './useCompiledPolicy';

/**
 * What the test environments are doing right now, per environment: the action
 * running, its streamed log, host states, run results and the hub's Mission
 * Portal details. Kept outside React (and Redux: none of it is project data),
 * so it survives switching tabs; the sidecar's events arrive here once.
 */

type Api = NonNullable<Window['api']>;
// An environment's actions (checking a custom image isn't one).
type Action = Exclude<Parameters<Api['testEnvStart']>[0], 'inspect'>;
type Request = Parameters<Api['testEnvStatus']>[0];
type TestEnvEvent = Parameters<Parameters<Api['onTestEnvEvent']>[0]>[1];
export type TestProblem = Extract<TestEnvEvent, { t: 'problems' }>['problems'][number];

export interface LogLine {
  host?: string | null;
  // "step" lines are the runner's own progress; "setup", "agent" and "exec" (the terminal) are
  // command output; "command" is a terminal command as typed.
  kind: 'agent' | 'command' | 'error' | 'exec' | 'setup' | 'step';
  text: string;
  // When it arrived (ms).
  time: number;
}

const KIND_OF_STREAM: Record<string, LogLine['kind']> = { agent: 'agent', exec: 'exec', command: 'command' };

export interface RunResult {
  exit: number;
  host: string;
  kept?: number;
  notKept?: number;
  repaired?: number;
  run: number;
}

export interface HostRuntime {
  container?: string;
  converged?: boolean;
  ip?: string | null;
  state: string;
  // What it's doing right now ("Bootstrapping to …", "Run 2 of 3"), while busy.
  step?: string;
}

const BUSY_STATES = new Set(['provisioning', 'running']);

export interface EnvironmentRuntime {
  action: Action | null;
  error: string | null;
  hosts: Record<string, HostRuntime>;
  hub: { setupCode: string | null; url: string | null } | null;
  // The last Deploy & run: when, on what policy (the request's contentKey) and how many
  // hosts, and whether it passed (null while running) — Deployment's "Tested?".
  lastRun: { at: number; content: string; hosts: number; passed: boolean | null } | null;
  lines: LogLine[];
  // How the last action ended, until the tab is looked at (the tab name's check / red dot).
  outcome: 'error' | 'ok' | null;
  // Each host's errors from its last agent run.
  problems: Record<string, TestProblem[]>;
  results: RunResult[];
  runId: string | null;
}

const MAX_LINES = 5000;
const EMPTY: EnvironmentRuntime = {
  action: null,
  error: null,
  hosts: {},
  hub: null,
  lastRun: null,
  lines: [],
  outcome: null,
  problems: {},
  results: [],
  runId: null
};
const runtimes = new Map<string, EnvironmentRuntime>();
const environmentOfRun = new Map<string, string>();
const listeners = new Set<() => void>();
let subscribed = false;

const runtimeOf = (environmentId: string) => runtimes.get(environmentId) ?? EMPTY;

function update(environmentId: string, change: (runtime: EnvironmentRuntime) => Partial<EnvironmentRuntime>) {
  const current = runtimeOf(environmentId);
  runtimes.set(environmentId, { ...current, ...change(current) });
  for (const listener of listeners) listener();
}

const appended = (runtime: EnvironmentRuntime, ...lines: Omit<LogLine, 'time'>[]) => ({
  lines: [...runtime.lines, ...lines.map(line => ({ ...line, time: Date.now() }))].slice(-MAX_LINES)
});

// How a run ending updates the runtime; a Deploy & run also records whether it passed.
function exited(runId: string, runtime: EnvironmentRuntime, event: Extract<TestEnvEvent, { t: 'exit' }>): Partial<EnvironmentRuntime> {
  environmentOfRun.delete(runId);
  const running = runtime.lastRun?.passed === null && (runtime.action === 'run' || runtime.action === 'test');
  const clean = Object.values(runtime.problems).every(list => list.length === 0) && runtime.results.every(result => !result.notKept);
  return {
    lastRun: running ? { ...runtime.lastRun!, passed: event.ok && clean } : runtime.lastRun,
    action: null,
    runId: null,
    outcome: event.ok ? 'ok' : 'error',
    error: event.ok ? runtime.error : (runtime.error ?? event.message ?? 'Failed')
  };
}

function handle(runId: string, event: TestEnvEvent) {
  const environmentId = environmentOfRun.get(runId);
  if (!environmentId) return;
  update(environmentId, runtime => {
    switch (event.t) {
      case 'log':
        return appended(runtime, { host: event.host, kind: KIND_OF_STREAM[event.stream ?? ''] ?? 'setup', text: event.line });
      case 'step': {
        const host = event.host ? runtime.hosts[event.host] : undefined;
        const hosts = event.host ? { ...runtime.hosts, [event.host]: { state: 'provisioning', ...host, step: event.message } } : runtime.hosts;
        return { ...appended(runtime, { host: event.host, kind: 'step', text: event.message }), hosts };
      }
      case 'host': {
        const known = runtime.hosts[event.host];
        return {
          hosts: {
            ...runtime.hosts,
            [event.host]: {
              ...known,
              state: event.state,
              container: event.container ?? known?.container,
              ip: event.ip ?? known?.ip,
              converged: event.converged,
              step: BUSY_STATES.has(event.state) ? known?.step : undefined
            }
          }
        };
      }
      case 'result':
        return { results: [...runtime.results, event] };
      case 'hub':
        return { hub: { setupCode: event.setup_code, url: event.url } };
      case 'problems':
        return { problems: { ...runtime.problems, [event.host]: event.problems } };
      case 'exec':
        return event.exit === 0 ? {} : appended(runtime, { host: event.host, kind: 'error', text: `exit ${event.exit}` });
      case 'error':
        return { ...appended(runtime, { kind: 'error', text: event.message }), error: event.message };
      case 'exit':
        return exited(runId, runtime, event);
      default:
        return {};
    }
  });
}

function subscribe(listener: () => void) {
  if (!subscribed && window.api) {
    subscribed = true;
    window.api.onTestEnvEvent(handle);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEnvironmentRuntime(environmentId: string): EnvironmentRuntime {
  return useSyncExternalStore(subscribe, () => runtimeOf(environmentId));
}

/** Starts Start / Run / Stop / Destroy for an environment; its events land in the runtime. */
export async function startAction(environment: TestEnvironment, action: Action, request: Request): Promise<void> {
  if (!window.api) return;
  subscribe(() => {});
  const label = {
    up: 'Start',
    run: 'Deploy & run',
    test: 'Deploy & run',
    exec: 'Command',
    start: 'Start',
    stop: 'Stop',
    destroy: 'Destroy',
    reset: 'Recreate',
    pull: 'Pull'
  }[action];
  update(environment.id, runtime => ({
    ...(action === 'exec' ? {} : appended(runtime, { kind: 'step', text: `── ${label} ──` })),
    action,
    error: null,
    outcome: null,
    results: action === 'run' || action === 'test' ? [] : runtime.results,
    problems: action === 'run' || action === 'test' ? {} : runtime.problems,
    lastRun:
      action === 'run' || action === 'test'
        ? {
            at: Date.now(),
            content: request.content ? contentKey(request.content) : 'null',
            hosts: request.hosts?.length ?? environment.hosts.length,
            passed: null
          }
        : runtime.lastRun
  }));
  try {
    const runId = await window.api.testEnvStart(action, request);
    environmentOfRun.set(runId, environment.id);
    update(environment.id, () => ({ runId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    update(environment.id, runtime => ({ ...appended(runtime, { kind: 'error', text: message }), action: null, error: message }));
  }
}

export function cancelAction(environmentId: string): void {
  const { runId } = runtimeOf(environmentId);
  if (runId) void window.api?.cancelTestEnvRun(runId);
}

/** Each host's container state, as Docker reports it (not while an action is running). */
export async function refreshStatus(environment: TestEnvironment, request: Request): Promise<void> {
  if (!window.api || runtimeOf(environment.id).action) return;
  try {
    const { hosts } = await window.api.testEnvStatus(request);
    update(environment.id, runtime => ({
      hosts: Object.fromEntries(
        Object.entries(hosts).map(([id, docker]) => {
          // A running container keeps its last run's outcome; otherwise Docker's word is final.
          const known = runtime.hosts[id];
          const keep = docker.state === 'running' && known && ['done', 'failed', 'ready'].includes(known.state);
          // Docker's "running" is the container being up, not the agent running: Ready.
          const state = docker.state === 'running' ? 'ready' : docker.state;
          return [id, keep ? { ...known, container: docker.container, ip: docker.ip } : { state, container: docker.container, ip: docker.ip }];
        })
      )
    }));
  } catch {
    // Docker not reachable: the status card says so.
  }
}

// Across environments: whether an action is running, else how the last unseen one ended.
let activity: { outcome: 'error' | 'ok' | null; running: boolean } = { outcome: null, running: false };
function currentActivity() {
  const all = [...runtimes.values()];
  const running = all.some(runtime => runtime.action !== null);
  const outcome = all.some(runtime => runtime.outcome === 'error') ? 'error' : all.some(runtime => runtime.outcome === 'ok') ? 'ok' : null;
  if (running !== activity.running || outcome !== activity.outcome) activity = { outcome, running };
  return activity;
}

export function useTestActivity() {
  return useSyncExternalStore(subscribe, currentActivity);
}

/** The tab was looked at: its check / red dot goes. */
export function markTestActivitySeen(): void {
  if (![...runtimes.values()].some(runtime => runtime.outcome)) return;
  for (const [id, runtime] of runtimes) runtimes.set(id, { ...runtime, outcome: null });
  for (const listener of listeners) listener();
}

// Block id -> the host names its promises failed on in the last run, across environments.
let blockProblems: Record<string, string[]> = {};
let blockProblemsKey = '';
function currentBlockProblems(hostNames: Map<string, string>) {
  const found: Record<string, string[]> = {};
  for (const runtime of runtimes.values()) {
    for (const [host, problems] of Object.entries(runtime.problems)) {
      for (const problem of problems) {
        if (!problem.block) continue;
        const name = hostNames.get(host) ?? host;
        found[problem.block] = [...new Set([...(found[problem.block] ?? []), name])];
      }
    }
  }
  const key = JSON.stringify(found);
  if (key !== blockProblemsKey) [blockProblems, blockProblemsKey] = [found, key];
  return blockProblems;
}

/** Which blocks failed on which hosts in the last runs (the canvas badges). */
export function useBlockProblems(hostNames: Map<string, string>): Record<string, string[]> {
  return useSyncExternalStore(subscribe, () => currentBlockProblems(hostNames));
}

export function clearLog(environmentId: string): void {
  update(environmentId, () => ({ lines: [] }));
}
