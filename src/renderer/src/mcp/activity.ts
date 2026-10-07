import { useSyncExternalStore } from 'react';

/**
 * What AI agents are doing in the app (over MCP): every tool call as a log
 * line, whether an agent is working (and so the editor is locked), and the
 * user's Stop. An agent declares its work with begin_work / end_work; one that
 * doesn't counts as working until IMPLICIT_MS after its last call.
 */

export const IMPLICIT_MS = 10_000;
// An agent that began work and went quiet this long is let go of.
export const ABANDONED_MS = 5 * 60_000;
const MAX_ENTRIES = 500;

export interface LogEntry {
  at: number;
  // Filled in when the call ends.
  durationMs?: number;
  id: string;
  ok?: boolean;
  // What failed, or the result's short summary.
  outcome?: string;
  text: string;
  tool: string;
}

export interface AgentActivity {
  // A call being answered now.
  current: LogEntry | null;
  lastCallAt: number | null;
  // The latest last: this app session's history.
  log: LogEntry[];
  paused: boolean;
  // What the agent said it's doing (begin_work), until end_work.
  task: { since: number; text: string } | null;
}

let state: AgentActivity = { current: null, log: [], lastCallAt: null, paused: false, task: null };
const listeners = new Set<() => void>();
let expiry: ReturnType<typeof setTimeout> | undefined;

function set(next: Partial<AgentActivity>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
  // Re-render when an implicit or abandoned session runs out.
  clearTimeout(expiry);
  const ends = workingUntil(state);
  if (ends !== null && Number.isFinite(ends)) expiry = setTimeout(() => set({}), Math.max(0, ends - Date.now()) + 50);
}

// When the agent stops counting as working: never (a call is running), or a time; null when it isn't.
function workingUntil(activity: AgentActivity, now = Date.now()): number | null {
  if (activity.paused) return null;
  if (activity.current) return Infinity;
  if (activity.lastCallAt === null) return null;
  const until = activity.lastCallAt + (activity.task ? ABANDONED_MS : IMPLICIT_MS);
  return until > now ? until : null;
}

export const isWorking = (activity: AgentActivity, now = Date.now()) => workingUntil(activity, now) !== null;

export const agentActivity = () => state;

export function useAgentActivity(): AgentActivity {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state
  );
}

export function callStarted(tool: string, text: string): string {
  const entry: LogEntry = { id: crypto.randomUUID(), at: Date.now(), tool, text };
  set({ current: entry, lastCallAt: entry.at });
  return entry.id;
}

export function callEnded(id: string, ok: boolean, outcome?: string) {
  const entry = state.current?.id === id ? state.current : null;
  if (!entry) return;
  const done: LogEntry = { ...entry, ok, outcome, durationMs: Date.now() - entry.at };
  // end_work releases the editor at once: its own call doesn't start the implicit wait again.
  set({ current: null, lastCallAt: entry.tool === 'end_work' && ok ? null : Date.now(), log: [...state.log, done].slice(-MAX_ENTRIES) });
}

export function workBegan(text: string) {
  set({ task: { text, since: Date.now() }, lastCallAt: Date.now() });
}

export const workEnded = () => set({ task: null, lastCallAt: null });

// Stop: the agent's calls are refused until Resume (the running one is cancelled by its caller).
export const paused = () => set({ paused: true, task: null });
export const resumed = () => set({ paused: false, lastCallAt: null });

export const logCleared = () => set({ log: [] });

/** For tests: back to no activity. */
export function resetActivity() {
  clearTimeout(expiry);
  state = { current: null, log: [], lastCallAt: null, paused: false, task: null };
}
