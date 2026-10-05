import { useSyncExternalStore } from 'react';

import type { BuildResult, HubState } from '../../../preload/api';

/**
 * The Deployment tab's Build and SSH deploy, outside React: a run keeps going (and its result
 * stays) when the tab is left, and the tab name shows it (spinner, then a check or a red dot).
 */

export type Failure = { details: string; message: string };
export type SshState =
  | { at: number; host: string; log: string; phase: 'deployed' }
  | { failure: Failure; phase: 'failed' }
  | { phase: 'deploying' }
  | { phase: 'idle' }
  // The build's checks failed: nothing was copied.
  | { phase: 'invalid' };

export interface Stage {
  id: string;
  label: string;
}

// In order; main reports each as it starts (`::stage` lines from the sidecar and the hub script).
export const BUILD_STAGES: Stage[] = [
  { id: 'save', label: 'Saving the project' },
  { id: 'build', label: 'Building the policy set with cfbs' },
  { id: 'lint', label: 'Checking with the linter' },
  { id: 'promises', label: 'Checking with cf-promises' }
];
export const SSH_STAGES: Stage[] = [
  ...BUILD_STAGES,
  { id: 'copy', label: 'Copying it to the hub' },
  { id: 'validate', label: 'Validating it on the hub (cf-promises)' },
  { id: 'install', label: 'Installing it as /var/cfengine/masterfiles' },
  { id: 'update', label: 'Running update.cf on the hub' },
  { id: 'policy', label: 'Running the policy on the hub' }
];

export const HUB_STAGES: Stage[] = [
  { id: 'enable', label: 'Turning on deploys from version control (CMDB class)' },
  { id: 'agent', label: 'Running the hub’s agent: pull, cfbs build, validate, deploy' },
  { id: 'verify', label: 'Reading what the hub runs now' }
];

export type HubDeploy =
  { at: number; deployed: 'no' | 'unknown' | 'yes'; output: string; phase: 'done' } | { failure: Failure; phase: 'failed' } | { phase: 'idle' };

export interface DeployRun {
  action: 'build' | 'hub' | 'ssh' | null;
  build: BuildResult | null;
  buildFailure: Failure | null;
  // The project content (its saved JSON) the last build checked: pre-flight reruns when it changed.
  builtFrom: string | null;
  hub: HubDeploy;
  // How the last run ended, until the tab is looked at.
  outcome: 'error' | 'ok' | null;
  ssh: SshState;
  // The step running now (a Stage id).
  stage: string | null;
}

const EMPTY: DeployRun = {
  action: null,
  build: null,
  buildFailure: null,
  builtFrom: null,
  hub: { phase: 'idle' },
  outcome: null,
  ssh: { phase: 'idle' },
  stage: null
};
// One per project folder.
const runs = new Map<string, DeployRun>();
const listeners = new Set<() => void>();
let current: string | null = null;
let subscribed = false;

const runOf = (path: string | null) => (path ? (runs.get(path) ?? EMPTY) : EMPTY);

function update(path: string, change: Partial<DeployRun>) {
  runs.set(path, { ...runOf(path), ...change });
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  if (!subscribed && window.api) {
    subscribed = true;
    window.api.onDeployProgress(stage => current && update(current, { stage }));
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useDeployRun = (path: string | null): DeployRun => useSyncExternalStore(subscribe, () => runOf(path));

/** Whether any project's Build or deploy is running, and how the last one ended (the tab badge). */
export function useDeployActivity(path: string | null) {
  const run = useDeployRun(path);
  return { running: run.action !== null, outcome: run.outcome };
}

export const markDeploySeen = (path: string | null) => path && runOf(path).outcome && update(path, { outcome: null });

// Saves first (Build and deploy work on what's on disk); null when it wasn't saved.
async function saved(save: () => Promise<boolean>, path: string, action: DeployRun['action']): Promise<string | null> {
  current = path;
  update(path, { action, stage: 'save', outcome: null });
  if (await save()) return path;
  update(path, { action: null, stage: null });
  return null;
}

/** Whether a build's checks passed (an invalid policy can't be shipped). */
export const isValid = (run: DeployRun) => Boolean(run.build && !run.buildFailure && run.build.lint.ok && run.build.promises.ok !== false);

export async function startBuild(path: string, save: () => Promise<boolean>, content: string | null = null): Promise<void> {
  if (!window.api || runOf(path).action || !(await saved(save, path, 'build'))) return;
  try {
    const result = await window.api.buildPolicySet(path);
    const valid = result.ok && result.build.lint.ok && result.build.promises.ok !== false;
    update(path, result.ok ? { build: result.build, buildFailure: null, builtFrom: content } : { build: null, buildFailure: result, builtFrom: content });
    update(path, { outcome: valid ? 'ok' : 'error' });
  } finally {
    update(path, { action: null, stage: null });
  }
}

export async function startSshDeploy(
  path: string,
  save: () => Promise<boolean>,
  target: { host: string; key: string | null; port: number | null },
  content: string | null = null
): Promise<void> {
  if (!window.api || runOf(path).action || !(await saved(save, path, 'ssh'))) return;
  update(path, { ssh: { phase: 'deploying' } });
  try {
    const result = await window.api.deployOverSsh(path, target);
    if (!result.ok) {
      update(path, { ssh: { phase: 'failed', failure: result }, outcome: 'error' });
      return;
    }
    update(path, {
      build: result.build,
      buildFailure: null,
      builtFrom: content,
      ssh: result.deployed ? { phase: 'deployed', log: result.log, at: Date.now(), host: target.host } : { phase: 'invalid' },
      outcome: result.deployed ? 'ok' : 'error'
    });
  } finally {
    update(path, { action: null, stage: null });
  }
}

export const readRun = (path: string | null) => runOf(path);

// Where Deploy over SSH goes, per project (host, port, key path — never the key itself).
export type SshTarget = { host: string; key: string | null; port: number | null };
export function sshTargetOf(path: string | null): SshTarget | null {
  const [host = '', port = '', key = ''] = (localStorage.getItem(`cfpb.deploy.ssh:${path}`) ?? '').split('|');
  return host ? { host, port: port ? Number(port) : null, key: key || null } : null;
}
export const saveSshTarget = (path: string, target: SshTarget) =>
  localStorage.setItem(`cfpb.deploy.ssh:${path}`, `${target.host}|${target.port ?? ''}|${target.key ?? ''}`);

export function forgetSshTarget(path: string) {
  localStorage.removeItem(`cfpb.deploy.ssh:${path}`);
  resetSsh(path);
}

export const resetSsh = (path: string) => runOf(path).ssh.phase !== 'deploying' && update(path, { ssh: { phase: 'idle' } });

/** Deploy now on an Enterprise hub; `onState` gets what the hub runs afterwards. */
export async function startHubDeploy(path: string, url: string, onState: (state: HubState) => void): Promise<void> {
  if (!window.api || runOf(path).action) return;
  current = path;
  update(path, { action: 'hub', stage: 'agent', outcome: null, hub: { phase: 'idle' } });
  try {
    const result = await window.api.hubDeploy(url);
    if (!result.ok) {
      update(path, { hub: { phase: 'failed', failure: result }, outcome: 'error' });
      return;
    }
    onState(result.state);
    update(path, {
      hub: { phase: 'done', deployed: result.deployed, output: result.output, at: Date.now() },
      outcome: result.deployed === 'no' ? 'error' : 'ok'
    });
  } finally {
    update(path, { action: null, stage: null });
  }
}
