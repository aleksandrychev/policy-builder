import { type ReactNode, useEffect, useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import StopOutlinedIcon from '@mui/icons-material/StopOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import { Box, Button, ButtonBase, IconButton, LinearProgress, Stack, Typography, alpha, useTheme } from '@mui/material';

import { toCfbsProject } from '../project/cfbsProject';
import { cancelAction, clearLog, refreshStatus, startAction, useEnvironmentRuntime } from '../project/testRuns';
import { store, useAppDispatch, useAppSelector } from '../store';
import { selectCurrentProject } from '../store/projectSlice/selectors';
import {
  envVarsChanged,
  environmentAdded,
  environmentChanged,
  hostAdded,
  hostChanged,
  hostRemoved,
  hostRenamed,
  hubChanged,
  newEnvironment
} from '../store/testEnvironmentsSlice';
import type { PlatformSupport, TestEnvironment } from '../store/testEnvironmentsSlice/types';
import { useMasterfilesVersions } from './dialogs/NewProjectDialog';
import { EnvironmentSettingsDialog } from './testenv/EnvironmentSettingsDialog';
import { HostCard } from './testenv/HostCard';
import { HostSettingsDialog } from './testenv/HostSettingsDialog';
import { LogPane } from './testenv/LogPane';
import { TerminalBar } from './testenv/TerminalBar';

type Api = NonNullable<Window['api']>;
type DockerStatus = Awaited<ReturnType<Api['testEnvDoctor']>>;

// Why the environment can't start as it is, if it can't.
function problemOf(environment: TestEnvironment, support: PlatformSupport | null): string | null {
  for (const host of environment.hosts) {
    const known = support?.[host.platform];
    const hub = host.id === environment.hub;
    if (known && !(hub ? known.hub : known.client)) {
      return `No CFEngine ${environment.edition}${hub && environment.edition === 'enterprise' ? ' hub' : ''} package for ${host.name}'s platform (${environment.arch}).`;
    }
  }
  const names = environment.hosts.map(host => host.name.trim().toLowerCase());
  if (names.some(name => !/^[a-z0-9][a-z0-9-]*$/.test(name))) return 'Host names: letters, digits and dashes only.';
  if (new Set(names).size !== names.length) return 'Two hosts have the same name.';
  const ports = environment.hosts.flatMap(host => host.ports.map(port => port.host));
  if (new Set(ports).size !== ports.length) return 'Two hosts publish the same port.';
  return null;
}

/**
 * The Test Results & Logs tab: a test environment of Docker hosts running the
 * generated policy (current edits, not the saved files). Start creates and
 * bootstraps the hosts; Run policy rebuilds, deploys to the hub and runs the
 * agent everywhere until it converges.
 */
export function TestResultsView() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const environment = useAppSelector(state => state.testEnvironments[0]) as TestEnvironment | undefined;
  const runtime = useEnvironmentRuntime(environment?.id ?? '');
  const versions = useMasterfilesVersions();
  const [docker, setDocker] = useState<DockerStatus | null>(null);
  const [checks, setChecks] = useState(0);
  const [editingHost, setEditingHost] = useState<string | null>(null);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [support, setSupport] = useState<{ key: string; platforms: PlatformSupport | null } | null>(null);
  const supportKey = environment ? `${environment.edition}|${environment.version}|${environment.arch}` : '';

  useEffect(() => {
    if (!environment) return;
    let current = true;
    const { arch, edition, version } = environment;
    window.api
      ?.testEnvPlatforms({ arch, edition, version })
      .then(({ platforms }) => current && setSupport({ key: supportKey, platforms: Object.fromEntries(platforms.map(p => [p.id, p])) }))
      .catch(() => current && setSupport({ key: supportKey, platforms: null }));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportKey]);
  const platformSupport = support?.key === supportKey ? support.platforms : null;

  useEffect(() => {
    let current = true;
    window.api
      ?.testEnvDoctor()
      .then(status => current && setDocker(status))
      .catch((error: unknown) => current && setDocker({ available: false, problem: 'not_running', message: String(error), host: null }));
    return () => {
      current = false;
    };
  }, [checks]);

  const request = (hosts?: string[]) => {
    const state = store.getState();
    const content = toCfbsProject(
      { canvas: state.canvas, derivedNodes: state.derivedNodes, edges: state.edges, files: state.files, groups: state.groups, testEnvironments: [] },
      project!
    );
    const masterfiles = project?.masterfiles ?? (environment!.version !== 'latest' ? environment!.version : versions.latest);
    const envFile = project?.path && environment?.envFile ? `${project.path.replace(/[/\\]+$/, '')}/${environment.envFile.replace(/^\.\//, '')}` : null;
    return { environment: environment!, content, masterfiles, envFile, ...(hosts ? { hosts } : {}) };
  };

  const idle = Boolean(environment) && !runtime.action;
  useEffect(() => {
    if (idle && environment && docker?.available) void refreshStatus(environment, request());
    // Refresh when an action ends or Docker comes back; not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle, docker?.available, environment?.id]);

  if (!window.api) return <Placeholder text="Test environments need the desktop app." />;
  if (!project) return null;

  if (!environment) {
    return (
      <Placeholder text="Run this project's policy on Docker containers.">
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => dispatch(environmentAdded(newEnvironment('Test environment')))}>
          Create test environment
        </Button>
      </Placeholder>
    );
  }

  const busy = runtime.action !== null;
  const problem = problemOf(environment, platformSupport);
  const id = environment.id;
  const anyUp = Object.values(runtime.hosts).some(host => ['running', 'ready', 'done', 'failed'].includes(host.state));
  const anyExists = Object.values(runtime.hosts).some(host => host.state !== 'absent');
  const lastResults = new Map(runtime.results.map(result => [result.host, result]));
  const editing = environment.hosts.find(host => host.id === editingHost);
  const network = `cfpb-${
    environment.id
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8) || 'env'
  }`;

  return (
    <Box component="main" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
        {busy ? (
          <Button variant="outlined" color="inherit" startIcon={<StopIcon />} onClick={() => cancelAction(id)}>
            Cancel
          </Button>
        ) : (
          <Button
            variant="contained"
            startIcon={<PlayArrowIcon />}
            disabled={!docker?.available || Boolean(problem)}
            onClick={() => void startAction(environment, 'test', request())}
            title="Create and bootstrap any host that isn't up yet, then run the policy on all of them"
          >
            Run test
          </Button>
        )}
        <Button
          variant="outlined"
          startIcon={<StopOutlinedIcon />}
          disabled={busy || !docker?.available || !anyUp}
          onClick={() => void startAction(environment, 'stop', request())}
        >
          Stop
        </Button>
        <RunSummary
          busy={busy}
          action={runtime.action}
          docker={docker}
          error={problem ?? runtime.error}
          hosts={environment.hosts}
          runtime={runtime}
          onRetry={() => setChecks(count => count + 1)}
        />
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          {environment.name} · {environment.edition === 'enterprise' ? 'Enterprise' : 'Community'} {environment.version} ·{' '}
          {environment.arch === 'aarch64' ? 'arm64' : 'x86-64'}
        </Typography>
        <IconButton title="Test environment settings" onClick={() => setEnvironmentOpen(true)}>
          <TuneIcon />
        </IconButton>
      </Stack>
      {busy && <LinearProgress />}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Stack sx={{ width: 380, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 2, py: 1.5 }}>
            <Typography sx={{ fontSize: 16, fontWeight: 700 }}>Topology nodes</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.muted', px: 0.75, borderRadius: 0.5, bgcolor: 'action.hover' }}>
              {environment.hosts.length} {environment.hosts.length === 1 ? 'host' : 'hosts'}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="outlined" startIcon={<AddIcon />} disabled={busy} onClick={() => dispatch(hostAdded({ environmentId: id }))}>
              Add host
            </Button>
          </Stack>
          <Stack spacing={1.25} sx={{ flex: 1, overflowY: 'auto', px: 2, pb: 2 }}>
            {[...environment.hosts]
              .sort((a, b) => Number(b.id === environment.hub) - Number(a.id === environment.hub))
              .map(host => (
                <HostCard
                  key={host.id}
                  host={host}
                  isHub={host.id === environment.hub}
                  hub={host.id === environment.hub && environment.edition === 'enterprise' ? (runtime.hub ?? null) : null}
                  runtime={runtime.hosts[host.id]}
                  lastResult={lastResults.get(host.id)}
                  onOpenSettings={() => setEditingHost(host.id)}
                />
              ))}
            <ButtonBase
              disabled={busy}
              onClick={() => dispatch(hostAdded({ environmentId: id }))}
              sx={{ py: 1.5, borderRadius: 1, border: '1px dashed', borderColor: 'divider', color: 'text.secondary', fontSize: 13, gap: 0.75 }}
            >
              <AddCircleOutlineIcon sx={{ fontSize: 18 }} /> Add client host
            </ButtonBase>
          </Stack>
          <Stack direction="row" sx={{ alignItems: 'center', px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 12, color: 'text.muted', flex: 1 }}>
              Network:{' '}
              <Box component="span" sx={{ fontFamily: 'monospace' }}>
                {network}
              </Box>
            </Typography>
            <Button
              size="small"
              color="error"
              disabled={busy || !docker?.available || !anyExists}
              onClick={() => void startAction(environment, 'destroy', request())}
            >
              Purge all
            </Button>
          </Stack>
        </Stack>
        <Stack sx={{ flex: 1, minWidth: 0, p: 2 }} spacing={1}>
          <LogPane hosts={environment.hosts} lines={runtime.lines} onClear={() => clearLog(id)} />
          <TerminalBar
            hosts={environment.hosts}
            disabled={busy || !docker?.available || !anyUp}
            onRun={(command, hosts) => void startAction(environment, 'exec', { ...request(hosts), command })}
          />
        </Stack>
      </Box>
      {editing && (
        <HostSettingsDialog
          host={editing}
          isHub={editing.id === environment.hub}
          busy={busy}
          exists={Boolean(runtime.hosts[editing.id]?.container) && runtime.hosts[editing.id]?.state !== 'absent'}
          canRemove={environment.hosts.length > 1}
          support={platformSupport}
          otherPorts={new Set(environment.hosts.filter(other => other.id !== editing.id).flatMap(other => other.ports.map(port => port.host)))}
          onClose={() => setEditingHost(null)}
          onRename={name => dispatch(hostRenamed({ environmentId: id, hostId: editing.id, name }))}
          onChange={({ env, ...changes }) => {
            if (env) dispatch(envVarsChanged({ environmentId: id, hostId: editing.id, env }));
            if (Object.keys(changes).length > 0) dispatch(hostChanged({ environmentId: id, hostId: editing.id, changes }));
          }}
          onMakeHub={() => dispatch(hubChanged({ environmentId: id, hostId: editing.id }))}
          onRemove={() => {
            setEditingHost(null);
            dispatch(hostRemoved({ environmentId: id, hostId: editing.id }));
          }}
          onReset={() => {
            setEditingHost(null);
            void startAction(environment, 'destroy', request([editing.id]));
          }}
        />
      )}
      {environmentOpen && (
        <EnvironmentSettingsDialog
          environment={environment}
          busy={busy}
          saved={Boolean(project.path)}
          engineArch={docker?.arch}
          canDestroy={Boolean(docker?.available) && anyExists}
          onClose={() => setEnvironmentOpen(false)}
          onChange={changes => dispatch(environmentChanged({ environmentId: id, changes }))}
          onEnvChange={env => dispatch(envVarsChanged({ environmentId: id, env }))}
          onDestroy={() => {
            setEnvironmentOpen(false);
            void startAction(environment, 'destroy', request());
          }}
        />
      )}
    </Box>
  );
}

const BUSY_LABEL = {
  up: 'Starting hosts…',
  run: 'Running policy…',
  test: 'Running test…',
  exec: 'Running command…',
  stop: 'Stopping…',
  destroy: 'Removing…',
  pull: 'Pulling…'
};

// The toolbar's status pill: what's happening, or how the last run went.
function RunSummary(props: {
  action: keyof typeof BUSY_LABEL | null;
  busy: boolean;
  docker: DockerStatus | null;
  error: string | null;
  hosts: TestEnvironment['hosts'];
  onRetry: () => void;
  runtime: ReturnType<typeof useEnvironmentRuntime>;
}) {
  const theme = useTheme();
  const pill = (tone: 'error' | 'info' | 'success' | 'warning', text: string, extra?: ReactNode) => (
    <Stack
      direction="row"
      spacing={0.75}
      sx={{ alignItems: 'center', px: 1.25, py: 0.5, borderRadius: 4, bgcolor: alpha(theme.palette[tone].main, 0.12), maxWidth: 520 }}
    >
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, bgcolor: `${tone}.main` }} />
      <Typography
        sx={{ fontSize: 12, fontWeight: 600, color: `${tone}.main`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={text}
      >
        {text}
      </Typography>
      {extra}
    </Stack>
  );
  const { docker, runtime } = props;
  if (!docker) return pill('info', 'Checking Docker…');
  if (!docker.available)
    return pill(
      'warning',
      docker.problem === 'not_installed' ? 'Docker isn’t installed' : 'Docker isn’t running',
      <Button size="small" onClick={props.onRetry} sx={{ minWidth: 0, py: 0, textTransform: 'none' }}>
        Retry
      </Button>
    );
  if (props.busy && props.action) return pill('info', BUSY_LABEL[props.action]);
  if (props.error) return pill('error', props.error);
  const ran = props.hosts.filter(host => runtime.results.some(result => result.host === host.id));
  if (ran.length === 0) return null;
  const last = (hostId: string) => runtime.results.filter(result => result.host === hostId).at(-1)!;
  const failed = ran.filter(host => runtime.hosts[host.id]?.state === 'failed' || last(host.id).exit !== 0);
  const notKept = ran.filter(host => (last(host.id).notKept ?? 0) > 0);
  const count = `${ran.length} ${ran.length === 1 ? 'host' : 'hosts'}`;
  if (failed.length) return pill('error', `Last run: failed on ${failed.map(host => host.name).join(', ')}`);
  if (notKept.length) return pill('warning', `Last run: promises not kept on ${notKept.map(host => host.name).join(', ')} · ${count}`);
  const converged = ran.every(host => runtime.hosts[host.id]?.converged);
  return pill(converged ? 'success' : 'warning', `Last run: ${converged ? 'converged' : 'still repairing'} · ${count}`);
}

function Placeholder({ children, text }: { children?: ReactNode; text: string }) {
  return (
    <Stack component="main" spacing={2} sx={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Typography sx={{ color: 'text.muted' }}>{text}</Typography>
      {children}
    </Stack>
  );
}
