import type { ReactNode } from 'react';

import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { Box, Button, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';

import type { GitStatus } from '../../../../preload/api';
import { type DeployRun, sshTargetOf } from '../../project/deployRuns';
import { TARGET_LABELS, type Target } from './TargetSettings';
import { type HubHandle, cannotPull, deploysProject } from './hub';
import { Line, StatusIcon, type Tone, ago, short } from './shared';
import type { ShipPlan } from './ship';

type Status = { text: string; tone: Tone };

function gitLines(git: GitStatus | null, changes: number): Status[] {
  if (!git) return [{ tone: 'muted', text: 'Reading git…' }];
  if (!git.repo) return [{ tone: 'warning', text: 'Not a git repository' }];
  if (!git.remote) return [{ tone: 'warning', text: 'No remote set' }];
  const sync: Status =
    git.behind > 0
      ? { tone: 'warning', text: `${git.behind} new on the remote` }
      : git.ahead > 0
        ? { tone: 'warning', text: `${git.ahead} ${git.ahead === 1 ? 'commit' : 'commits'} to push` }
        : { tone: 'success', text: `In sync with ${git.upstream ?? 'origin'}` };
  const pending = changes || git.changedFiles;
  return [
    { tone: 'muted', text: `${git.remote} · ${git.branch ?? '?'}` },
    sync,
    pending ? { tone: 'warning', text: `${pending} ${pending === 1 ? 'change' : 'changes'} to commit` } : { tone: 'success', text: 'Nothing to commit' }
  ];
}

function sshLines(path: string, run: DeployRun): Status[] {
  const ssh = sshTargetOf(path);
  if (!ssh) return [{ tone: 'warning', text: 'No hub set' }];
  const last: Status =
    run.ssh.phase === 'deployed'
      ? { tone: 'success', text: `Deployed ${ago(run.ssh.at)}` }
      : run.ssh.phase === 'failed'
        ? { tone: 'error', text: 'Last deploy failed' }
        : run.ssh.phase === 'invalid'
          ? { tone: 'error', text: 'Not deployed: the checks failed' }
          : { tone: 'muted', text: 'Not deployed from here yet' };
  return [{ tone: 'muted', text: `${ssh.host}${ssh.port ? `:${ssh.port}` : ''}${ssh.key ? ' · own key' : ''}` }, last];
}

const hubName = (state: NonNullable<HubHandle['state']>): Status => ({
  tone: 'muted',
  text: `${state.info.hostname} · Enterprise ${state.info.version}${state.hosts !== null ? ` · ${state.hosts} ${state.hosts === 1 ? 'host' : 'hosts'}` : ''}`
});

// What the hub runs against what's pushed.
function hubRuns(git: GitStatus | null, releaseId: string | null): Status {
  if (!releaseId) return { tone: 'muted', text: 'No policy reported yet' };
  const head = git?.lastCommit?.hash;
  if (head && releaseId === head && git?.ahead === 0) return { tone: 'success', text: `Runs ${short(releaseId)}, the latest` };
  return { tone: 'warning', text: `Runs ${short(releaseId)}${head ? ` · you’d ship ${short(head)}` : ''}` };
}

function hubLines(git: GitStatus | null, hub: HubHandle): Status[] {
  if (!hub.hub) return [{ tone: 'warning', text: 'Not connected' }];
  const { state } = hub;
  if (!state) return [{ tone: hub.failure ? 'error' : 'muted', text: hub.failure ? `Can’t reach ${hub.hub.url}` : `Connecting to ${hub.hub.url}…` }];
  if (!deploysProject(state, git)) return [hubName(state), { tone: 'warning', text: 'Deploys another source' }];
  if (cannotPull(state)) return [hubName(state), { tone: 'error', text: 'Can’t pull: an SSH URL without a deploy key' }];
  return [hubName(state), { tone: 'success', text: `Deploys this project’s ${state.vcs!.refspec}` }, hubRuns(git, state.releaseId)];
}

export function statusLines({
  changes,
  git,
  hub,
  path,
  run,
  target
}: {
  changes: number;
  git: GitStatus | null;
  hub: HubHandle;
  path: string;
  run: DeployRun;
  target: Target;
}) {
  if (target === 'git') return gitLines(git, changes);
  return target === 'ssh' ? sshLines(path, run) : hubLines(git, hub);
}

const HINTS: Record<Target, string> = {
  git: 'Commit and push; a hub on GIT_CFBS deploys from the repository.',
  ssh: 'Copy the built policy set to a hub as its masterfiles.',
  hub: 'Point a hub at the repository and deploy now.'
};

export interface DeployWay {
  lines: Status[];
  plan: ShipPlan;
  // Not set up yet: its setup form, shown in place of the status and action.
  setup?: ReactNode;
  target: Target;
}

// A tab shows its way's worst status.
const RANK: Record<Tone, number> = { error: 3, warning: 2, success: 1, muted: 0 };
const worst = (lines: Status[]): Tone => lines.reduce<Tone>((tone, line) => (RANK[line.tone] > RANK[tone] ? line.tone : tone), 'muted');

/** The ways to deploy as tabs, each named with its status: what it's set to, where it stands, and its one action. */
export function DeployTabs({
  busy,
  onSettings,
  onShip,
  onTab,
  tab,
  ways
}: {
  busy: boolean;
  onSettings: (target: Target) => void;
  onShip: (target: Target) => void;
  onTab: (target: Target) => void;
  tab: Target;
  ways: DeployWay[];
}) {
  const way = ways.find(item => item.target === tab) ?? ways[0];
  const { plan } = way;
  const action = plan.blocked?.action;
  return (
    <Paper variant="outlined">
      <Tabs
        value={way.target}
        onChange={(_event, value: Target) => onTab(value)}
        sx={{ px: 1, minHeight: 44, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        {ways.map(item => (
          <Tab
            key={item.target}
            value={item.target}
            iconPosition="start"
            icon={<StatusIcon tone={worst(item.lines)} size={16} />}
            label={TARGET_LABELS[item.target]}
            sx={{ minHeight: 44, textTransform: 'none', fontSize: 14, gap: 0.5 }}
          />
        ))}
      </Tabs>
      {way.setup ? (
        <Box sx={{ p: 2 }}>
          <Typography sx={{ fontSize: 12, color: 'text.muted', mb: 1.5 }}>{HINTS[way.target]}</Typography>
          {way.setup}
        </Box>
      ) : (
        <Stack direction="row" spacing={2} sx={{ p: 2, alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, color: 'text.muted', mb: 0.75 }}>{HINTS[way.target]}</Typography>
            {way.lines.map(line => (
              <Line key={line.text} tone={line.tone}>
                {line.text}
              </Line>
            ))}
          </Box>
          <Stack spacing={0.75} sx={{ alignItems: 'flex-end', flexShrink: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button size="small" startIcon={<SettingsOutlinedIcon />} onClick={() => onSettings(way.target)}>
                Settings
              </Button>
              {action ? (
                <Button variant="contained" size="small" disabled={busy} onClick={action.run}>
                  {action.label}
                </Button>
              ) : (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<RocketLaunchOutlinedIcon />}
                  disabled={busy || Boolean(plan.blocked)}
                  title={plan.blocked?.reason}
                  onClick={() => onShip(way.target)}
                >
                  {plan.label}
                </Button>
              )}
            </Stack>
            {plan.blocked && <Typography sx={{ fontSize: 12, color: 'text.muted', maxWidth: 320, textAlign: 'right' }}>{plan.blocked.reason}</Typography>}
          </Stack>
        </Stack>
      )}
    </Paper>
  );
}
