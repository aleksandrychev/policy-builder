import { type ReactNode, useEffect, useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Box, Button, LinearProgress, MenuItem, Stack, TextField, Typography } from '@mui/material';

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
import { EnvVarsField } from './testenv/EnvVarsField';
import { HostCard } from './testenv/HostCard';
import { LogPane } from './testenv/LogPane';

type Api = NonNullable<Window['api']>;
type DockerStatus = Awaited<ReturnType<Api['testEnvDoctor']>>;

const BUSY_LABEL = { up: 'Starting…', run: 'Running policy…', stop: 'Stopping…', destroy: 'Removing…', pull: 'Pulling…' };

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
  const emulated = Boolean(docker?.arch) && docker!.arch !== environment.arch;
  const ready = Boolean(docker?.available) && !busy && !problem;
  const id = environment.id;
  const anyUp = Object.values(runtime.hosts).some(host => ['running', 'ready', 'done', 'failed'].includes(host.state));
  const anyExists = Object.values(runtime.hosts).some(host => host.state !== 'absent');
  const lastResults = new Map(runtime.results.map(result => [result.host, result]));

  return (
    <Box component="main" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Stack spacing={1.5} sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {docker?.available ? (
            <CheckCircleOutlineIcon color="success" fontSize="small" />
          ) : (
            <WarningAmberIcon color={docker ? 'warning' : 'disabled'} fontSize="small" />
          )}
          <Typography sx={{ fontSize: 12, color: 'text.muted', flex: 1 }}>
            {docker ? docker.message : 'Checking Docker…'}
            {docker && !docker.available && (
              <Button size="small" onClick={() => setChecks(count => count + 1)} sx={{ ml: 1, textTransform: 'none' }}>
                Retry
              </Button>
            )}
          </Typography>
          {busy ? (
            <>
              <Typography sx={{ fontSize: 13 }}>{BUSY_LABEL[runtime.action!]}</Typography>
              <Button size="small" color="inherit" onClick={() => cancelAction(id)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="small" variant="contained" disabled={!ready} onClick={() => void startAction(environment, 'up', request())}>
                Start
              </Button>
              <Button size="small" variant="outlined" disabled={!ready || !anyUp} onClick={() => void startAction(environment, 'run', request())}>
                Run policy
              </Button>
              <Button size="small" disabled={!docker?.available || !anyUp} onClick={() => void startAction(environment, 'stop', request())}>
                Stop
              </Button>
              <Button
                size="small"
                color="error"
                disabled={!docker?.available || !anyExists}
                onClick={() => void startAction(environment, 'destroy', request())}
              >
                Destroy
              </Button>
            </>
          )}
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            label="Environment"
            value={environment.name}
            onChange={event => dispatch(environmentChanged({ environmentId: id, changes: { name: event.target.value } }))}
            sx={{ width: 200 }}
          />
          <TextField
            select
            size="small"
            label="Edition"
            value={environment.edition}
            disabled={busy}
            onChange={event => dispatch(environmentChanged({ environmentId: id, changes: { edition: event.target.value as TestEnvironment['edition'] } }))}
            sx={{ width: 170 }}
          >
            <MenuItem value="community">Community</MenuItem>
            <MenuItem value="enterprise">Enterprise (Mission Portal)</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Architecture"
            value={environment.arch}
            disabled={busy}
            helperText={emulated ? 'Emulated by Docker (slower)' : 'Native'}
            onChange={event => dispatch(environmentChanged({ environmentId: id, changes: { arch: event.target.value as TestEnvironment['arch'] } }))}
            sx={{ width: 150 }}
          >
            <MenuItem value="x86_64">x86-64</MenuItem>
            <MenuItem value="aarch64">arm64</MenuItem>
          </TextField>
          <TextField
            size="small"
            label="CFEngine version"
            value={environment.version}
            disabled={busy}
            onChange={event => dispatch(environmentChanged({ environmentId: id, changes: { version: event.target.value.trim() || 'latest' } }))}
            helperText="latest, or e.g. 3.27.1"
            sx={{ width: 160 }}
          />
          <TextField
            size="small"
            label=".env file"
            value={environment.envFile ?? ''}
            placeholder="./.env"
            disabled={!project.path}
            helperText={project.path ? 'In the project folder; read at Start and Run' : 'Save the project to use one'}
            onChange={event => dispatch(environmentChanged({ environmentId: id, changes: { envFile: event.target.value.trim() || null } }))}
            sx={{ width: 230 }}
          />
        </Stack>
        {(problem || runtime.error) && (
          <Typography sx={{ fontSize: 12, color: problem ? 'warning.main' : 'error.main' }}>{problem ?? runtime.error}</Typography>
        )}
      </Stack>
      {busy && <LinearProgress />}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', gap: 2, p: 2 }}>
        <Stack spacing={1.5} sx={{ width: 520, flexShrink: 0, overflowY: 'auto', pr: 0.5 }}>
          <EnvVarsField
            label="Environment variables (all hosts)"
            env={environment.env}
            onChange={env => dispatch(envVarsChanged({ environmentId: id, env }))}
          />
          {environment.hosts.map(host => (
            <HostCard
              key={host.id}
              host={host}
              runtime={runtime.hosts[host.id]}
              isHub={host.id === environment.hub}
              hub={host.id === environment.hub && environment.edition === 'enterprise' ? (runtime.hub ?? { setupCode: null, url: null }) : null}
              busy={busy}
              canRemove={environment.hosts.length > 1}
              lastResult={lastResults.get(host.id)}
              support={platformSupport}
              otherPorts={new Set(environment.hosts.filter(other => other.id !== host.id).flatMap(other => other.ports.map(port => port.host)))}
              onRename={name => dispatch(hostRenamed({ environmentId: id, hostId: host.id, name }))}
              onChange={({ env, ...changes }) => {
                if (env) dispatch(envVarsChanged({ environmentId: id, hostId: host.id, env }));
                if (Object.keys(changes).length > 0) dispatch(hostChanged({ environmentId: id, hostId: host.id, changes }));
              }}
              onMakeHub={() => dispatch(hubChanged({ environmentId: id, hostId: host.id }))}
              onRemove={() => dispatch(hostRemoved({ environmentId: id, hostId: host.id }))}
              onReset={() => void startAction(environment, 'destroy', request([host.id]))}
            />
          ))}
          <Box>
            <Button
              size="small"
              startIcon={<AddIcon />}
              disabled={busy}
              onClick={() => dispatch(hostAdded({ environmentId: id }))}
              sx={{ textTransform: 'none' }}
            >
              Host
            </Button>
          </Box>
        </Stack>
        <LogPane hosts={environment.hosts} lines={runtime.lines} onClear={() => clearLog(id)} />
      </Box>
    </Box>
  );
}

function Placeholder({ children, text }: { children?: ReactNode; text: string }) {
  return (
    <Stack component="main" spacing={2} sx={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Typography sx={{ color: 'text.muted' }}>{text}</Typography>
      {children}
    </Stack>
  );
}
