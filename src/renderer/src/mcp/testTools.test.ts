import type { EnvironmentRuntime } from '../project/testRuns';
import { startAction } from '../project/testRuns';
import { undone } from '../store/history';
import { projectCreated } from '../store/projectSlice';
import { type TestStore, addBlock, addFile, makeStore } from '../store/test/storeTestUtils';
import { environmentAdded, newEnvironment } from '../store/testEnvironmentsSlice';
import { installApi, uninstallApi } from '../test/render';
import type { SessionTools, ToolEnv } from './shared';
import { POLL_MS } from './testTools';
import { answerTool } from './tools';

// The view's runtime is outside the store: a fake one the fake startAction drives.
const runtimes = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../project/testRuns', async importOriginal => ({
  ...(await importOriginal<typeof import('../project/testRuns')>()),
  environmentRuntime: (id: string) => runtimes.get(id) ?? EMPTY,
  startAction: vi.fn(),
  refreshStatus: vi.fn(async () => {})
}));

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

let store: TestStore;
const envOf = (): ToolEnv => ({ canvas: null, dispatch: store.dispatch, getState: store.getState, session: {} as SessionTools });

async function call(name: string, input: object = {}) {
  const answer = await answerTool(envOf(), name, input);
  if (!answer.ok) throw new Error(answer.content);
  return JSON.parse(answer.content);
}
const refusal = async (name: string, input: object = {}) => (await answerTool(envOf(), name, input)).content;

const doctor = vi.fn();
beforeEach(() => {
  POLL_MS.value = 5;
  runtimes.clear();
  vi.mocked(startAction).mockReset();
  store = makeStore();
  store.dispatch(projectCreated({ name: 'Demo' }));
  doctor.mockResolvedValue({ available: true, problem: null, message: 'Docker 28', host: 'unix:///docker.sock', version: '28', arch: 'aarch64' });
  installApi({
    testEnvDoctor: doctor,
    getMasterfilesVersions: async () => ({ latest: '3.28.0' }),
    testEnvImages: async () => ({ platforms: [{ id: 'ubuntu-22', label: 'Ubuntu 22.04', image: 'ubuntu:22.04', present: true }] }),
    // Every platform has packages, except an RHEL 7 Enterprise hub.
    testEnvPlatforms: async ({ edition }) => ({
      platforms: ['ubuntu-22', 'ubuntu-24', 'debian-12', 'rhel-7'].map(id => ({
        id,
        label: id,
        client: true,
        hub: !(id === 'rhel-7' && edition === 'enterprise')
      }))
    })
  });
});
afterEach(() => uninstallApi());

describe('Docker and platforms', () => {
  it('reports Docker, and why not when it is down', async () => {
    expect(await call('get_docker_status')).toMatchObject({ available: true, version: '28', socket: 'unix:///docker.sock' });
    doctor.mockRejectedValue(new Error('spawn failed'));
    expect(await call('get_docker_status')).toMatchObject({ available: false, message: 'spawn failed' });
  });

  it('lists every platform with its image and packages', async () => {
    const result = await call('list_test_platforms', { edition: 'enterprise', version: '3.27.1' });
    expect(result).toMatchObject({ edition: 'enterprise', version: '3.27.1', arch: 'x86_64', versions: { latest: '3.28.0' } });
    expect(result.platforms.find((p: { id: string }) => p.id === 'ubuntu-22')).toMatchObject({ image: 'ubuntu:22.04', pulled: true, hubPackage: true });
    expect(result.platforms.find((p: { id: string }) => p.id === 'rhel-7')).toMatchObject({ clientPackage: true, hubPackage: false });
    expect(result.platforms.find((p: { id: string }) => p.id === 'rhel-10')).toMatchObject({ clientPackage: null });
    expect(await refusal('list_test_platforms', { version: 'newest' })).toMatch(/latest/);
  });
});

describe('set_test_environment', () => {
  it('creates an environment in one undo step', async () => {
    const { environmentId } = await call('set_test_environment', {
      name: 'Web',
      edition: 'enterprise',
      hosts: [
        { name: 'web', platform: 'debian-12', ports: [{ host: 8080, container: 80 }], env: { ROLE: 'web' } },
        { name: 'hub', platform: 'ubuntu-24' }
      ],
      hub: 'hub',
      env: { STAGE: 'test' }
    });
    const [created] = store.getState().testEnvironments;
    expect(created).toMatchObject({ id: environmentId, name: 'Web', edition: 'enterprise', version: 'latest', env: { STAGE: 'test' } });
    expect(created.hub).toBe(created.hosts[1].id);
    expect(created.hosts[0]).toMatchObject({ name: 'web', ports: [{ host: 8080, container: 80 }], env: { ROLE: 'web' } });
    store.dispatch(undone());
    expect(store.getState().testEnvironments).toEqual([]);
  });

  it('refuses what the view would refuse', async () => {
    expect(await refusal('set_test_environment', { hosts: [{ name: 'a', platform: 'solaris' }] })).toMatch(/no platform solaris/);
    expect(
      await refusal('set_test_environment', {
        hosts: [
          { name: 'A', platform: 'ubuntu-22' },
          { name: 'a', platform: 'ubuntu-22' }
        ]
      })
    ).toMatch(/same name/);
    expect(await refusal('set_test_environment', { hosts: [{ name: 'a b', platform: 'ubuntu-22' }] })).toMatch(/letters, digits and dashes/);
    expect(await refusal('set_test_environment', { edition: 'enterprise', hosts: [{ name: 'hub', platform: 'rhel-7' }] })).toMatch(/enterprise hub package/);
    expect(await refusal('set_test_environment', { hub: 'nope' })).toMatch(/isn’t one of the hosts/);
    expect(store.getState().testEnvironments).toEqual([]);
  });

  it('changes an environment: keeps hosts by name, adds and removes the others', async () => {
    const start = newEnvironment('Test');
    store.dispatch(environmentAdded({ ...start, hosts: [...start.hosts, { ...start.hosts[0], id: 'old', name: 'old' }] }));
    const hubId = start.hosts[0].id;
    await call('set_test_environment', {
      environmentId: start.id,
      version: '3.27.1',
      hosts: [
        { name: 'hub', platform: 'debian-12' },
        { name: 'client1', platform: 'ubuntu-24', env: { X: '1' } }
      ],
      hub: 'client1'
    });
    const [changed] = store.getState().testEnvironments;
    expect(changed.version).toBe('3.27.1');
    expect(changed.hosts.map(host => [host.name, host.platform])).toEqual([
      ['hub', 'debian-12'],
      ['client1', 'ubuntu-24']
    ]);
    expect(changed.hosts[0].id).toBe(hubId);
    expect(changed.hub).toBe(changed.hosts[1].id);
    expect(changed.hosts[1].env).toEqual({ X: '1' });
    store.dispatch(undone());
    expect(store.getState().testEnvironments[0].hosts.map(host => host.name)).toEqual(['hub', 'old']);
  });
});

it('lists environments with their hosts and roles', async () => {
  const environment = newEnvironment('Test');
  store.dispatch(environmentAdded(environment));
  runtimes.set(environment.id, { ...EMPTY, hosts: { [environment.hosts[0].id]: { state: 'ready' } } });
  const { environments } = await call('get_test_environments');
  expect(environments).toEqual([
    expect.objectContaining({
      id: environment.id,
      name: 'Test',
      hosts: [expect.objectContaining({ name: 'hub', role: 'hub', platform: 'ubuntu-22', state: 'ready' })]
    })
  ]);
});

it('removes an environment', async () => {
  const environment = newEnvironment('Test');
  store.dispatch(environmentAdded(environment));
  expect(await call('remove_test_environment', { environmentId: environment.id })).toMatchObject({ removed: environment.id });
  expect(store.getState().testEnvironments).toEqual([]);
});

describe('runs', () => {
  let environment: ReturnType<typeof newEnvironment>;
  let blockId: string;
  beforeEach(() => {
    environment = newEnvironment('Test');
    store.dispatch(environmentAdded(environment));
    blockId = addBlock(store, addFile(store, 'web'), { label: 'Install nginx' });
  });

  // A Deploy & run that ends after a moment with a not-kept promise traced to the block.
  function finishesWithProblem() {
    const host = environment.hosts[0].id;
    vi.mocked(startAction).mockImplementation(async env => {
      runtimes.set(env.id, { ...EMPTY, action: 'test', lastRun: { at: 0, content: '', hosts: 1, passed: null } });
      setTimeout(() => {
        runtimes.set(env.id, {
          ...EMPTY,
          hosts: { [host]: { state: 'done', converged: false } },
          lastRun: { at: 0, content: '', hosts: 1, passed: false },
          results: [{ host, run: 1, exit: 0, kept: 90, repaired: 5, notKept: 5 }],
          problems: {
            [host]: [{ block: blockId, bundle: 'web', cause: [], count: 1, file: './web.cf', fileId: null, line: 12, message: 'Package nginx not installed' }]
          },
          lines: [{ host, kind: 'agent', text: 'error: Package nginx not installed', time: 0 }]
        });
      }, 20);
    });
  }

  it('runs Deploy & run, waits, and traces problems to blocks', async () => {
    finishesWithProblem();
    const result = await call('run_tests');
    expect(vi.mocked(startAction).mock.calls[0][1]).toBe('test');
    expect(vi.mocked(startAction).mock.calls[0][2]).toMatchObject({ environment, masterfiles: '3.28.0', envFile: null });
    expect(result).toMatchObject({ status: 'failed', hosts: [{ name: 'hub', role: 'hub', compliance: { kept: 90, notKept: 5 }, converged: false }] });
    expect(result.hosts[0].problems[0]).toMatchObject({
      message: 'Package nginx not installed',
      line: 12,
      block: { id: blockId, label: 'Install nginx', file: 'web.cf' }
    });
    expect(result.log).toEqual(['[hub] error: Package nginx not installed']);
  });

  it('only starts when not waiting, and refuses while busy', async () => {
    finishesWithProblem();
    expect(await call('run_tests', { wait: false, hosts: ['HUB'] })).toMatchObject({ started: true });
    expect(vi.mocked(startAction).mock.calls[0][2]).toMatchObject({ hosts: [environment.hosts[0].id] });
    expect(await refusal('run_tests')).toMatch(/busy/);
    expect((await call('get_test_results')).status).toBe('running');
  });

  it('refuses without Docker or with an unknown host', async () => {
    expect(await refusal('run_tests', { hosts: ['web9'] })).toMatch(/No host web9/);
    doctor.mockResolvedValue({ available: false, problem: 'not_running', message: 'Start Docker, then retry.', host: null });
    expect(await refusal('run_tests')).toMatch(/Docker isn’t running/);
    expect(startAction).not.toHaveBeenCalled();
  });

  it('reports the latest results with the log tail', async () => {
    expect((await call('get_test_results')).status).toBe('not run');
    runtimes.set(environment.id, {
      ...EMPTY,
      lastRun: { at: 0, content: '', hosts: 1, passed: true },
      lines: ['a', 'b', 'c'].map(text => ({ kind: 'step', text, time: 0 }))
    });
    expect(await call('get_test_results', { logLines: 2 })).toMatchObject({ status: 'passed', policyChangedSince: true, log: ['b', 'c'] });
    runtimes.set(environment.id, { ...(runtimes.get(environment.id) as object), hosts: { [environment.hosts[0].id]: { state: 'done', converged: false } } });
    expect((await call('get_test_results')).status).toBe('not converged');
  });

  it('stops or destroys the containers', async () => {
    vi.mocked(startAction).mockImplementation(async env => {
      runtimes.set(env.id, { ...EMPTY, hosts: { [environment.hosts[0].id]: { state: 'absent' } } });
    });
    expect(await call('stop_test_environment', { destroy: true })).toMatchObject({ finished: true, hosts: [{ name: 'hub', state: 'absent' }] });
    expect(vi.mocked(startAction).mock.calls[0][1]).toBe('destroy');
  });

  it('needs an open project', async () => {
    store = makeStore();
    expect(await refusal('get_test_results')).toMatch(/No project is open/);
  });
});
