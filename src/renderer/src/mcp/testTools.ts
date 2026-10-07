import { toCfbsProject } from '../project/cfbsProject';
import * as testRuns from '../project/testRuns';
import type { EnvironmentRuntime } from '../project/testRuns';
import { contentKey } from '../project/useCompiledPolicy';
import type { RootState } from '../store';
import { inOneStep } from '../store/history';
import type { Project } from '../store/projectSlice/types';
import {
  envVarsChanged,
  environmentAdded,
  environmentChanged,
  environmentRemoved,
  hostAdded,
  hostChanged,
  hostRemoved,
  hostRenamed,
  hubChanged,
  newEnvironment
} from '../store/testEnvironmentsSlice';
import { PLATFORMS, type TestEnvironment, type TestHost } from '../store/testEnvironmentsSlice/types';
import { agentActivity } from './activity';
import { type Input, type Tool, type ToolEnv, ToolError, optionalStr, str } from './shared';

/**
 * Test environments (src/main/mcpTools/testing.ts names them): edits are store actions, one undo
 * step per call; runs go through the Tests & Logs view's own actions (project/testRuns.ts).
 */

type Api = NonNullable<Window['api']>;
type Request = Parameters<Api['testEnvStatus']>[0];
type Action = Parameters<typeof testRuns.startAction>[1];

export const POLL_MS = { value: 500 };
const RUN_WAIT_S = 600;
const STOP_WAIT_S = 150;
const FALLBACK_MASTERFILES = '3.27.1';
const HOST_NAME = /^[a-z0-9][a-z0-9-]*$/;
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VERSION = /^(latest|\d+\.\d+\.\d+(-\d+)?)$/;
const IMAGE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/;
const PLATFORM_IDS: Set<string> = new Set(PLATFORMS.map(platform => platform.id));

function api(): Api {
  if (!window.api) throw new ToolError('Test environments need the Policy Builder desktop app');
  return window.api;
}

function projectOf(env: ToolEnv): Project {
  const project = env.getState().project;
  if (!project) throw new ToolError('No project is open in Policy Builder; open or create one first');
  return project;
}

function environmentOf(state: RootState, environmentId: string | undefined): TestEnvironment {
  const all = state.testEnvironments;
  if (environmentId) {
    const found = all.find(environment => environment.id === environmentId);
    if (!found) throw new ToolError(`No test environment ${environmentId}; get_test_environments lists them`);
    return found;
  }
  if (all.length === 1) return all[0];
  if (all.length === 0) throw new ToolError('The project has no test environment; create one with set_test_environment');
  throw new ToolError(`The project has ${all.length} test environments; give environmentId (get_test_environments lists them)`);
}

const runtimeOf = (environmentId: string): EnvironmentRuntime => testRuns.environmentRuntime(environmentId);
const runtimeOrNull = runtimeOf;

function requireIdle(environment: TestEnvironment) {
  const action = runtimeOrNull(environment.id)?.action;
  if (action) throw new ToolError(`${environment.name} is busy (${action}); wait for it (get_test_results) or cancel it in the Tests & Logs view`);
}

async function requireDocker() {
  const status = await api()
    .testEnvDoctor()
    .catch((error: unknown) => ({ available: false, problem: 'not_running' as const, message: String(error) }));
  if (status.available) return;
  if (status.problem === 'not_installed') throw new ToolError('Docker isn’t installed: install Docker Desktop, Colima or OrbStack, then retry');
  throw new ToolError(`Docker isn’t running: start it, then retry (${status.message})`);
}

const latestRelease = () =>
  api()
    .getMasterfilesVersions()
    .then(versions => versions.latest)
    .catch(() => FALLBACK_MASTERFILES);

const contentOf = (state: RootState, project: Project) =>
  toCfbsProject(
    { canvas: state.canvas, derivedNodes: state.derivedNodes, edges: state.edges, files: state.files, groups: state.groups, testEnvironments: [] },
    project
  );

// What the Tests & Logs view sends (TestResultsView's request()): the current edits, built against the project's masterfiles.
async function requestFor(state: RootState, environment: TestEnvironment, hosts?: string[]): Promise<Request> {
  const project = state.project!;
  const masterfiles = project.masterfiles ?? (environment.version !== 'latest' ? environment.version : await latestRelease());
  const envFile = project.path && environment.envFile ? `${project.path.replace(/[/\\]+$/, '')}/${environment.envFile.replace(/^\.\//, '')}` : null;
  return { environment, content: contentOf(state, project), masterfiles, envFile, ...(hosts ? { hosts } : {}) };
}

// Host names (or ids) -> ids.
function hostIdsOf(environment: TestEnvironment, names: unknown): string[] | undefined {
  if (names === undefined) return undefined;
  if (!Array.isArray(names) || names.length === 0) throw new ToolError('hosts must be a non-empty list of host names');
  return names.map(name => {
    const key = String(name).toLowerCase();
    const host = environment.hosts.find(item => item.id === name || item.name.toLowerCase() === key);
    if (!host) throw new ToolError(`No host ${String(name)} in ${environment.name}; its hosts: ${environment.hosts.map(item => item.name).join(', ')}`);
    return host.id;
  });
}

// --- reading -----------------------------------------------------------------------------------

async function dockerStatus() {
  try {
    const { available, problem, message, host, version, arch } = await api().testEnvDoctor();
    return { available, problem, message, socket: host, version, arch };
  } catch (error) {
    return { available: false, problem: 'not_running', message: error instanceof Error ? error.message : String(error) };
  }
}

async function listPlatforms(env: ToolEnv, input: Input) {
  const first = env.getState().testEnvironments[0] as TestEnvironment | undefined;
  const edition = optionalStr(input, 'edition') ?? first?.edition ?? 'community';
  const version = optionalStr(input, 'version') ?? first?.version ?? 'latest';
  const arch = optionalStr(input, 'arch') ?? first?.arch ?? 'x86_64';
  if (!VERSION.test(version)) throw new ToolError('version is "latest" or a release such as "3.27.1"');
  const [packages, images, latest] = await Promise.all([
    api()
      .testEnvPlatforms({ arch, edition, version })
      .then(result => ({ platforms: new Map(result.platforms.map(platform => [platform.id, platform])), error: null }))
      .catch((error: unknown) => ({ platforms: null, error: error instanceof Error ? error.message : String(error) })),
    api()
      .testEnvImages()
      .then(result => new Map(result.platforms.map(platform => [platform.id, platform])))
      .catch(() => null),
    latestRelease()
  ]);
  return {
    edition,
    version,
    arch,
    platforms: PLATFORMS.map(({ id, label }) => {
      const found = packages.platforms?.get(id);
      return {
        id,
        label,
        image: images?.get(id)?.image,
        pulled: images?.get(id)?.present,
        clientPackage: found ? found.client : null,
        hubPackage: found ? found.hub : null
      };
    }),
    packagesUnknown: packages.error ? `Couldn’t check packages (offline?): ${packages.error}` : undefined,
    editions: ['community', 'enterprise'],
    arches: ['x86_64', 'aarch64'],
    versions: { latest, note: '"latest", or any CFEngine release such as "3.27.1"' },
    customImages: 'A host may run any Docker image with apt or dnf (e.g. "rockylinux:9"): give it as image, with the platform whose package it takes'
  };
}

function environmentSummary(environment: TestEnvironment) {
  const runtime = runtimeOrNull(environment.id);
  return {
    id: environment.id,
    name: environment.name,
    edition: environment.edition,
    version: environment.version,
    arch: environment.arch,
    maxRuns: environment.maxRuns ?? 3,
    env: environment.env,
    envFile: environment.envFile,
    busy: runtime?.action ?? undefined,
    hosts: environment.hosts.map(host => ({
      id: host.id,
      name: host.name,
      role: host.id === environment.hub ? 'hub' : 'client',
      platform: host.platform,
      image: host.image,
      ports: host.ports,
      env: host.env,
      state: runtime?.hosts[host.id]?.state
    }))
  };
}

async function getEnvironments(env: ToolEnv) {
  const state = env.getState();
  projectOf(env);
  const environments = state.testEnvironments;
  const docker = environments.length > 0 && window.api ? await dockerStatus() : null;
  if (docker?.available) await Promise.all(environments.map(async environment => testRuns.refreshStatus(environment, await requestFor(state, environment))));
  return { environments: environments.map(environmentSummary), docker: docker && !docker.available ? docker.message : undefined };
}

// A run's outcome, as the view shows it: per host compliance and the errors traced to blocks.
function resultsOf(state: RootState, environment: TestEnvironment, logLines: number) {
  const runtime = runtimeOf(environment.id);
  const describe = (id: string) => {
    const block = state.canvas.find(item => item.instanceId === id);
    const group = state.groups.find(item => item.id === (block ? block.groupId : id));
    const fileId = block?.fileId ?? group?.fileId;
    const file = state.files.files.find(item => item.id === fileId);
    if (!block && !group) return { id, label: null };
    return {
      id,
      type: block ? 'block' : 'group',
      label: block ? block.label : group!.name,
      fileId,
      file: file && `${file.name}.cf`,
      group: block && group?.name
    };
  };
  const names = new Map(environment.hosts.map(host => [host.id, host.name]));
  const { lastRun } = runtime;
  const status = runtime.action ? 'running' : !lastRun ? 'not run' : lastRun.passed ? 'passed' : 'failed';
  const project = state.project;
  return {
    environmentId: environment.id,
    status,
    action: runtime.action ?? undefined,
    error: runtime.error ?? undefined,
    ranAt: lastRun ? new Date(lastRun.at).toISOString() : undefined,
    policyChangedSince: lastRun && project ? lastRun.content !== contentKey(contentOf(state, project)) : undefined,
    hosts: environment.hosts.map(host => {
      const runs = runtime.results.filter(result => result.host === host.id);
      const last = runs.at(-1);
      const known = runtime.hosts[host.id];
      return {
        id: host.id,
        name: host.name,
        role: host.id === environment.hub ? 'hub' : 'client',
        state: known?.state,
        step: known?.step,
        converged: known?.converged,
        agentRuns: runs.length || undefined,
        compliance: last && { kept: last.kept, repaired: last.repaired, notKept: last.notKept, exit: last.exit },
        problems: (runtime.problems[host.id] ?? []).map(problem => ({
          message: problem.message,
          cause: problem.cause.length ? problem.cause : undefined,
          count: problem.count,
          block: problem.block ? describe(problem.block) : null,
          bundle: problem.bundle,
          file: problem.file,
          line: problem.line
        }))
      };
    }),
    hub: runtime.hub ?? undefined,
    log:
      logLines > 0
        ? runtime.lines
            .slice(-logLines)
            .map(line => `${line.host ? `[${names.get(line.host) ?? line.host}] ` : ''}${line.kind === 'error' ? 'ERROR ' : ''}${line.text}`)
        : undefined
  };
}

function logLinesOf(input: Input, fallback: number) {
  const value = input.logLines;
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1000) throw new ToolError('logLines is 0 to 1000');
  return value;
}

// --- editing -----------------------------------------------------------------------------------

interface PlannedHost {
  env?: Record<string, string>;
  existing?: TestHost;
  image?: string;
  name: string;
  platform: string;
  ports?: TestHost['ports'];
}

function varsOf(value: unknown, what: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ToolError(`${what} must be an object of NAME: value`);
  for (const [key, item] of Object.entries(value)) {
    if (!VAR_NAME.test(key)) throw new ToolError(`${what}: ${key} isn’t a variable name (letters, digits, _; not starting with a digit)`);
    if (typeof item !== 'string') throw new ToolError(`${what}: ${key} must be a string`);
  }
  return { ...(value as Record<string, string>) };
}

function portsOf(value: unknown, host: string): TestHost['ports'] {
  if (!Array.isArray(value)) throw new ToolError(`${host}: ports must be a list of { host, container }`);
  const valid = (port: unknown) => Number.isInteger(port) && (port as number) >= 1 && (port as number) <= 65535;
  return value.map(item => {
    const { host: published, container } = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    if (!valid(published) || !valid(container)) throw new ToolError(`${host}: each port is { host, container }, numbers 1 to 65535`);
    return { host: published as number, container: container as number };
  });
}

function planHosts(existing: TestHost[], value: unknown): PlannedHost[] {
  if (!Array.isArray(value) || value.length === 0) throw new ToolError('hosts must list at least one host');
  const taken = new Set<string>();
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) throw new ToolError('Each host is { name, platform, … }');
    const host = item as Input;
    const name = str(host, 'name').trim();
    const platform = str(host, 'platform');
    const id = optionalStr(host, 'id');
    const match = id
      ? existing.find(other => other.id === id)
      : existing.find(other => !taken.has(other.id) && other.name.toLowerCase() === name.toLowerCase());
    if (id && !match) throw new ToolError(`No host ${id} in this environment`);
    if (match) taken.add(match.id);
    const image = optionalStr(host, 'image') ?? match?.image;
    if (image && !IMAGE_REFERENCE.test(image)) throw new ToolError(`${name}: ${image} isn’t a Docker image reference`);
    return {
      name,
      platform,
      existing: match,
      image: image || undefined,
      ports: host.ports === undefined ? undefined : portsOf(host.ports, name),
      env: host.env === undefined ? undefined : varsOf(host.env, `${name}'s env`)
    };
  });
}

// Why an environment can't run as planned (TestResultsView's problemOf, plus platforms), else null.
function problemOf(hosts: PlannedHost[], hubIndex: number, edition: string, arch: string, support: Map<string, { client: boolean; hub: boolean }> | null) {
  const names = hosts.map(host => host.name.toLowerCase());
  const bad = names.find(name => !HOST_NAME.test(name));
  if (bad !== undefined) return `Host name "${bad}": letters, digits and dashes only, starting with a letter or digit`;
  if (new Set(names).size !== names.length) return 'Two hosts have the same name';
  const ports = hosts.flatMap(host => (host.ports ?? host.existing?.ports ?? []).map(port => port.host));
  if (new Set(ports).size !== ports.length) return 'Two hosts publish the same host port';
  const unknown = hosts.find(host => !PLATFORM_IDS.has(host.platform));
  if (unknown) return `${unknown.name}: no platform ${unknown.platform}; one of ${[...PLATFORM_IDS].join(', ')}`;
  if (support && [...support.values()].every(platform => !platform.client && !platform.hub)) {
    return `No CFEngine ${edition} packages for that version on ${arch}; list_test_platforms shows what exists`;
  }
  for (const [index, host] of hosts.entries()) {
    const known = support?.get(host.platform);
    const hub = index === hubIndex;
    if (known && !(hub ? known.hub : known.client)) {
      return `No CFEngine ${edition}${hub && edition === 'enterprise' ? ' hub' : ''} package for ${host.platform} (${arch}); list_test_platforms shows which platforms have one`;
    }
  }
  return null;
}

function oneOf<T extends string>(input: Input, key: string, values: readonly T[]): T | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!values.includes(value as T)) throw new ToolError(`${key} is one of ${values.join(', ')}`);
  return value as T;
}

type EnvironmentChanges = Partial<Pick<TestEnvironment, 'arch' | 'edition' | 'envFile' | 'maxRuns' | 'name' | 'version'>>;

// The environment's own fields that `input` sets.
function fieldsOf(input: Input): EnvironmentChanges {
  const name = input.name === undefined ? undefined : str(input, 'name').trim();
  if (name === '') throw new ToolError('name can’t be empty');
  const version = input.version === undefined ? undefined : str(input, 'version');
  if (version !== undefined && !VERSION.test(version)) throw new ToolError('version is "latest" or a release such as "3.27.1"');
  const maxRuns = input.maxRuns;
  if (maxRuns !== undefined && (!Number.isInteger(maxRuns) || (maxRuns as number) < 1 || (maxRuns as number) > 10)) throw new ToolError('maxRuns is 1 to 10');
  const envFile = input.envFile === undefined || input.envFile === null ? (input.envFile as null | undefined) : str(input, 'envFile');
  if (envFile && (/^([/\\]|[A-Za-z]:)/.test(envFile) || envFile.split(/[/\\]/).includes('..'))) {
    throw new ToolError('envFile is relative to the project folder, inside it (e.g. "./.env")');
  }
  const changes: EnvironmentChanges = {
    name,
    edition: oneOf(input, 'edition', ['community', 'enterprise'] as const),
    arch: oneOf(input, 'arch', ['x86_64', 'aarch64'] as const),
    version,
    maxRuns: maxRuns as number | undefined,
    envFile
  };
  return Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
}

// Which platforms have packages for the environment, or null (with a warning) when that can't be checked.
async function packagesFor(target: Pick<TestEnvironment, 'arch' | 'edition' | 'version'>, warnings: string[]) {
  try {
    return new Map((await api().testEnvPlatforms(target)).platforms.map(platform => [platform.id, platform]));
  } catch (error) {
    warnings.push(`Couldn’t check CFEngine packages (offline?): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// The planned hosts onto an existing environment's (inside the caller's undo step): kept ones changed, new ones added, the rest removed.
function applyHosts(env: ToolEnv, existing: TestEnvironment, planned: PlannedHost[], hubIndex: number) {
  const id = existing.id;
  const hostsNow = () => environmentOf(env.getState(), id).hosts;
  const ids = planned.map(host => {
    let hostId = host.existing?.id;
    if (!hostId) {
      const before = new Set(hostsNow().map(item => item.id));
      env.dispatch(hostAdded({ environmentId: id, platform: host.platform, ...(host.image ? { image: host.image } : {}) }));
      hostId = hostsNow().find(item => !before.has(item.id))!.id;
    }
    const current = hostsNow().find(item => item.id === hostId)!;
    if (current.name !== host.name) env.dispatch(hostRenamed({ environmentId: id, hostId, name: host.name }));
    const ports = host.ports && JSON.stringify(host.ports) !== JSON.stringify(current.ports) ? { ports: host.ports } : {};
    if (current.platform !== host.platform || current.image !== host.image || ports.ports) {
      env.dispatch(hostChanged({ environmentId: id, hostId, changes: { platform: host.platform, image: host.image, ...ports } }));
    }
    if (host.env) env.dispatch(envVarsChanged({ environmentId: id, hostId, env: host.env }));
    return hostId;
  });
  env.dispatch(hubChanged({ environmentId: id, hostId: ids[hubIndex] }));
  for (const host of existing.hosts) if (!ids.includes(host.id)) env.dispatch(hostRemoved({ environmentId: id, hostId: host.id }));
}

function hubIndexOf(planned: PlannedHost[], hubName: string | undefined, currentHub: string) {
  if (!hubName)
    return Math.max(
      0,
      planned.findIndex(host => host.existing?.id === currentHub)
    );
  const index = planned.findIndex(host => host.name.toLowerCase() === hubName.toLowerCase());
  if (index < 0) throw new ToolError(`hub ${hubName} isn’t one of the hosts (${planned.map(host => host.name).join(', ')})`);
  return index;
}

async function setEnvironment(env: ToolEnv, input: Input) {
  projectOf(env);
  const environmentId = optionalStr(input, 'environmentId');
  const existing = environmentId ? environmentOf(env.getState(), environmentId) : null;
  if (existing) requireIdle(existing);
  const changes = fieldsOf(input);
  const vars = input.env === undefined ? undefined : varsOf(input.env, 'env');
  const base = existing ?? newEnvironment(changes.name ?? 'Test environment');
  const hostsGiven = input.hosts !== undefined;
  const planned: PlannedHost[] = hostsGiven
    ? planHosts(existing?.hosts ?? [], input.hosts)
    : base.hosts.map(host => ({ ...host, existing: existing ? host : undefined }));
  const hubIndex = hubIndexOf(planned, optionalStr(input, 'hub'), base.hub);

  const target = { ...base, ...changes };
  const warnings: string[] = [];
  const problem = problemOf(planned, hubIndex, target.edition, target.arch, await packagesFor(target, warnings));
  if (problem) throw new ToolError(problem);
  const result = (id: string) => ({ environmentId: id, warnings: warnings.length ? warnings : undefined });

  if (!existing) {
    const hosts: TestHost[] = planned.map(host => ({
      id: crypto.randomUUID(),
      name: host.name,
      platform: host.platform,
      ports: host.ports ?? [],
      env: host.env ?? {},
      ...(host.image ? { image: host.image } : {})
    }));
    const created: TestEnvironment = { ...target, env: vars ?? {}, hosts, hub: hosts[hubIndex].id };
    inOneStep(env.dispatch, () => env.dispatch(environmentAdded(created)));
    return result(created.id);
  }
  const id = existing.id;
  inOneStep(env.dispatch, () => {
    if (Object.keys(changes).length) env.dispatch(environmentChanged({ environmentId: id, changes }));
    if (vars) env.dispatch(envVarsChanged({ environmentId: id, env: vars }));
    if (hostsGiven) applyHosts(env, existing, planned, hubIndex);
    else env.dispatch(hubChanged({ environmentId: id, hostId: existing.hosts[hubIndex].id }));
  });
  return result(id);
}

function removeEnvironment(env: ToolEnv, input: Input) {
  projectOf(env);
  const environment = environmentOf(env.getState(), str(input, 'environmentId'));
  requireIdle(environment);
  inOneStep(env.dispatch, () => env.dispatch(environmentRemoved({ environmentId: environment.id })));
  if (env.getState().testEnvironments.some(item => item.id === environment.id)) {
    throw new ToolError('This build of Policy Builder can’t remove test environments yet');
  }
  const containers = Object.values(runtimeOrNull(environment.id)?.hosts ?? {}).some(host => host.state !== 'absent');
  return {
    removed: environment.id,
    note: containers ? 'Its containers may still exist: Docker keeps them until removed (docker ps --filter label=cfpb.env)' : undefined
  };
}

// --- running -----------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitIdle(environmentId: string, seconds: number): Promise<boolean> {
  const deadline = Date.now() + seconds * 1000;
  while (runtimeOf(environmentId).action) {
    // The user pressed Stop in the app: the run is cancelled with the agent.
    if (agentActivity().paused) {
      testRuns.cancelAction(environmentId);
      throw new ToolError('Stopped by the user in Policy Builder; the test run was cancelled');
    }
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS.value);
  }
  return true;
}

async function start(env: ToolEnv, input: Input, action: Action) {
  projectOf(env);
  const environment = environmentOf(env.getState(), optionalStr(input, 'environmentId'));
  runtimeOf(environment.id);
  requireIdle(environment);
  const hosts = hostIdsOf(environment, input.hosts);
  await requireDocker();
  await testRuns.startAction(environment, action, await requestFor(env.getState(), environment, hosts));
  return environment;
}

async function runTests(env: ToolEnv, input: Input) {
  const seconds = input.timeoutSeconds ?? RUN_WAIT_S;
  if (!Number.isInteger(seconds) || (seconds as number) < 1 || (seconds as number) > RUN_WAIT_S) throw new ToolError(`timeoutSeconds is 1 to ${RUN_WAIT_S}`);
  env.canvas?.showTests();
  const environment = await start(env, input, 'test');
  if (input.wait === false) return { started: true, environmentId: environment.id, note: 'Poll get_test_results until status isn’t "running"' };
  const finished = await waitIdle(environment.id, seconds as number);
  const failed = finished && !runtimeOf(environment.id).lastRun?.passed;
  return {
    ...resultsOf(env.getState(), environment, failed ? 40 : 0),
    note: finished ? undefined : `Still running after ${String(seconds)} s; poll get_test_results`
  };
}

async function stopEnvironment(env: ToolEnv, input: Input) {
  const environment = await start(env, input, input.destroy === true ? 'destroy' : 'stop');
  const finished = await waitIdle(environment.id, STOP_WAIT_S);
  const runtime = runtimeOf(environment.id);
  return {
    environmentId: environment.id,
    finished,
    error: runtime.error ?? undefined,
    hosts: environment.hosts.map(host => ({ name: host.name, state: runtime.hosts[host.id]?.state }))
  };
}

export const TEST_TOOLS: Record<string, Tool> = {
  get_docker_status: () => dockerStatus(),
  list_test_platforms: (env, input) => listPlatforms(env, input),
  get_test_environments: env => getEnvironments(env),
  set_test_environment: (env, input) => setEnvironment(env, input),
  remove_test_environment: (env, input) => removeEnvironment(env, input),
  run_tests: (env, input) => runTests(env, input),
  get_test_results: (env, input) => {
    projectOf(env);
    const state = env.getState();
    return resultsOf(state, environmentOf(state, optionalStr(input, 'environmentId')), logLinesOf(input, 100));
  },
  stop_test_environment: (env, input) => stopEnvironment(env, input)
};
