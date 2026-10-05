import { useState } from 'react';

import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';

import type { GitStatus } from '../../../../preload/api';
import { type DeployRun, isValid, sshTargetOf } from '../../project/deployRuns';
import type { Check } from './Preflight';
import type { Target } from './TargetSettings';
import { type HubHandle, cannotPull, deploysProject } from './hub';

export type ShipStep = 'check' | 'commit' | 'hub' | 'push' | 'ssh';

export interface ShipPlan {
  // Why it can't ship, and what to do about it.
  blocked?: { action?: { label: string; run: () => void }; reason: string };
  label: string;
  steps: ShipStep[];
  // Failed or unsure checks that don't block: shown, then "Ship anyway".
  warnings: string[];
}

const STEP_TEXT: Record<ShipStep, string> = {
  check: 'Save, build and check the policy (pre-flight)',
  commit: 'Commit the changes',
  push: 'Push to origin',
  hub: 'Run the hub’s agent: it pulls, builds with cfbs, validates and deploys',
  ssh: 'Save, build and check, copy to the hub over SSH, validate and install it there'
};

interface PlanInput {
  checks: Check[];
  content: string;
  git: GitStatus | null;
  hub: HubHandle;
  isModule: boolean;
  onSettings: () => void;
  path: string;
  run: DeployRun;
  target: Target;
}

const stop = (reason: string, warnings: string[], action?: { label: string; run: () => void }): ShipPlan => ({
  label: action?.label ?? 'Ship',
  steps: [],
  warnings,
  blocked: { reason, action }
});

// Commit when there are changes, push when there's something to push.
function gitSteps(checks: Check[], git: GitStatus): ShipStep[] {
  const uncommitted = checks.find(item => item.id === 'committed')?.tone === 'warning';
  return [...(uncommitted ? (['commit'] as const) : []), ...(uncommitted || git.ahead > 0 ? (['push'] as const) : [])];
}

// Checks that don't block but are shown before shipping: an untested policy.
function warningsOf(checks: Check[]): string[] {
  const tested = checks.find(check => check.id === 'tested');
  return tested && tested.tone !== 'success' && !tested.running ? [`Tested: ${tested.status}.`] : [];
}

function sshPlan(path: string, onSettings: () => void, warnings: string[]): ShipPlan {
  const ssh = sshTargetOf(path);
  return ssh
    ? { label: `Deploy to ${ssh.host}`, steps: ['ssh'], warnings }
    : stop('Choose the hub to deploy to over SSH.', warnings, { label: 'Set the hub…', run: onSettings });
}

const hubNeedsSetup = (hub: HubHandle, git: GitStatus | null) => !hub.hub || !hub.state || !deploysProject(hub.state, git) || cannotPull(hub.state);

function hubPlan(input: PlanInput, check: ShipStep[], steps: ShipStep[], warnings: string[]): ShipPlan {
  const { git, hub, onSettings } = input;
  if (!hub.hub) return stop('Connect to the Enterprise hub.', warnings, { label: 'Connect a hub…', run: onSettings });
  if (!hub.state) return stop(hub.failure ? 'Can’t reach the hub.' : 'Connecting to the hub…', warnings);
  if (!deploysProject(hub.state, git)) return stop('The hub deploys another source.', warnings, { label: 'Point the hub at this project…', run: onSettings });
  if (cannotPull(hub.state)) return stop('The hub can’t pull an SSH URL without a deploy key.', warnings, { label: 'Fix the hub’s source…', run: onSettings });
  const label = steps.includes('commit') ? 'Commit, push & deploy to hub' : steps.length ? 'Push & deploy to hub' : 'Deploy to hub';
  return { label, steps: [...check, ...steps, 'hub'], warnings };
}

// What Ship does for the target, given the checks: the steps, or why it can't.
export function planShip(input: PlanInput): ShipPlan {
  const { checks, content, git, isModule, onSettings, path, run, target } = input;
  const warnings = warningsOf(checks);
  if (isModule) return stop('A module ships with the policy set that uses it.', warnings);
  // An invalid policy never ships; one not checked for the current content is checked first.
  const fresh = Boolean(run.build && run.builtFrom === content);
  if ((fresh || run.buildFailure) && !isValid(run)) return stop('The policy has problems: see Valid policy.', warnings);
  const check: ShipStep[] = fresh ? [] : ['check'];
  if (target === 'ssh') return sshPlan(path, onSettings, warnings);
  // The hub's own setup comes first: it's what the button offers.
  if (target === 'hub' && hubNeedsSetup(input.hub, git)) return hubPlan(input, [], [], warnings);
  if (!git?.repo) return stop('The project folder isn’t a git repository: see Committed.', warnings);
  if (!git.remote) return stop('Set the git remote to push to.', warnings, { label: 'Set the remote…', run: onSettings });
  if (git.behind > 0) return stop('The remote has commits you don’t: see Pushed.', warnings);
  const steps = gitSteps(checks, git);
  if (target === 'hub') return hubPlan(input, check, steps, warnings);
  if (!steps.length) return { ...stop('Nothing to commit or push.', warnings), label: 'Up to date' };
  return { label: steps.includes('commit') ? 'Commit & push' : 'Push', steps: [...check, ...steps], warnings };
}

/** What shipping will do, its warnings, and the commit message when it commits. */
export function ShipDialog({
  onCancel,
  onShip,
  plan,
  suggested
}: {
  onCancel: () => void;
  onShip: (message: string) => void;
  plan: ShipPlan;
  suggested: string;
}) {
  const [message, setMessage] = useState(suggested);
  const commits = plan.steps.includes('commit');
  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>{plan.label}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Stack component="ol" spacing={0.25} sx={{ m: 0, pl: 2.5 }}>
            {plan.steps.map(step => (
              <Typography component="li" key={step} sx={{ fontSize: 13 }}>
                {STEP_TEXT[step]}
              </Typography>
            ))}
          </Stack>
          {plan.warnings.length > 0 && (
            <Alert severity="warning">
              {plan.warnings.map(warning => (
                <div key={warning}>{warning}</div>
              ))}
            </Alert>
          )}
          {commits && (
            <TextField
              label="Commit message"
              size="small"
              multiline
              minRows={3}
              maxRows={10}
              value={message}
              onChange={event => setMessage(event.target.value)}
              slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 13 } } }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="contained"
          color={plan.warnings.length ? 'warning' : 'primary'}
          disabled={commits && !message.trim()}
          onClick={() => onShip(message.trim())}
        >
          {plan.warnings.length ? 'Ship anyway' : plan.label}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
