import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import type { TestEnvEvent, TestEnvRequest, TestProblem } from '../../../preload/api';
import { newEnvironment } from '../store/testEnvironmentsSlice';
import type { TestEnvironment } from '../store/testEnvironmentsSlice/types';
import { installApi, renderWithProviders, uninstallApi } from '../test/render';

type Api = NonNullable<Window['api']>;
type Store = typeof import('../store').store;

let store: Store;
let View: typeof import('./TestResultsView').TestResultsView;
let api: Api;
let emit: (event: TestEnvEvent) => void;

const environment: TestEnvironment = {
  ...newEnvironment('Env', { id: 'h1', name: 'hub' }),
  id: 'env',
  hosts: [
    { id: 'h1', name: 'hub', platform: 'ubuntu-22', ports: [], env: {} },
    { id: 'h2', name: 'web', platform: 'ubuntu-22', ports: [{ host: 8080, container: 80 }], env: {} }
  ]
};

const problem: TestProblem = {
  block: 'b1',
  bundle: 'main',
  cause: [],
  count: 1,
  file: './main.cf',
  fileId: 'f1',
  line: 4,
  message: 'Could not install nginx'
};

// The module-level stores (the app store, test runs) start fresh per test.
async function setup({ dockerUp = true, withEnvironment = true, states = { h1: 'running', h2: 'running' } as Record<string, string> } = {}) {
  vi.resetModules();
  api = installApi({
    getMasterfilesVersions: vi.fn(async () => ({ latest: '3.27.0' })),
    onTestEnvEvent: vi.fn((callback: (runId: string, event: TestEnvEvent) => void) => {
      emit = event => act(() => callback('run-1', event));
      return () => {};
    }),
    testEnvDoctor: vi.fn(async () =>
      dockerUp
        ? { available: true, host: null, message: '', problem: null }
        : { available: false, host: null, message: 'down', problem: 'not_running' as const }
    ),
    testEnvPlatforms: vi.fn(async () => ({ platforms: [] })),
    testEnvStart: vi.fn(async () => 'run-1'),
    testEnvStatus: vi.fn(async () => ({
      hosts: Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { state, container: `c-${id}`, ip: `10.0.0.${id.slice(1)}` }]))
    }))
  });
  ({ store } = await import('../store'));
  const { projectCreated } = await import('../store/projectSlice');
  const slice = await import('../store/testEnvironmentsSlice');
  ({ TestResultsView: View } = await import('./TestResultsView'));
  store.dispatch(projectCreated({ name: 'Demo', path: '/p' }));
  if (withEnvironment) store.dispatch(slice.environmentAdded(environment));
  const onShowBlock = vi.fn();
  renderWithProviders(<View onShowBlock={onShowBlock} />, { store });
  if (withEnvironment && dockerUp) await waitFor(() => expect(api.testEnvStatus).toHaveBeenCalled());
  return { onShowBlock };
}

const card = (name: string) => screen.getByText(name, { selector: 'p' }).closest<HTMLElement>('.MuiPaper-root')!;
const startCall = (index = 0) => vi.mocked(api.testEnvStart).mock.calls[index] as [string, TestEnvRequest];
const logTabs = () => screen.getByRole('button', { name: 'All logs' }).parentElement!;
const logFilter = () => screen.getByPlaceholderText('Filter logs…');

async function deployAndRun() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Deploy & run' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Deploy & run' }));
  await waitFor(() => expect(api.testEnvStart).toHaveBeenCalled());
  await screen.findByRole('button', { name: 'Cancel' });
}

describe('TestResultsView', () => {
  afterEach(uninstallApi);

  it('offers to create a test environment', async () => {
    await setup({ withEnvironment: false });
    expect(screen.getByText(/^Run this project.s policy on Docker containers/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create test environment' }));
    expect(store.getState().testEnvironments).toHaveLength(1);
    expect(await screen.findByText('Topology nodes')).toBeInTheDocument();
  });

  it('shows a card per host, the hub first, with its state', async () => {
    await setup({ states: { h1: 'running', h2: 'exited' } });
    expect(screen.getByText('2 hosts')).toBeInTheDocument();
    await waitFor(() => expect(within(card('hub')).getByText('Ready')).toBeInTheDocument());
    expect(within(card('hub')).getByText('HUB')).toBeInTheDocument();
    expect(within(card('web')).getByText('Stopped')).toBeInTheDocument();
    expect(within(card('web')).getByText('localhost:8080')).toBeInTheDocument();
  });

  it('runs Deploy & run on every host', async () => {
    await setup();
    await deployAndRun();
    const [action, request] = startCall();
    expect(action).toBe('test');
    expect(request.environment.id).toBe('env');
    expect(request.hosts).toBeUndefined();
    expect(request.masterfiles).toBe('3.27.0');
    expect(screen.getByText('Deploying & running…')).toBeInTheDocument();
  });

  it('cancels the running action', async () => {
    await setup();
    await deployAndRun();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.cancelTestEnvRun).toHaveBeenCalledWith('run-1');
  });

  it('stops all hosts', async () => {
    await setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(api.testEnvStart).toHaveBeenCalled());
    expect(startCall()[0]).toBe('stop');
    expect(startCall()[1].hosts).toBeUndefined();
  });

  it('runs a host card action on that host only', async () => {
    await setup({ states: { h1: 'running', h2: 'exited' } });
    await waitFor(() => expect(within(card('web')).getByRole('button', { name: 'Start the container' })).toBeEnabled());
    fireEvent.click(within(card('web')).getByRole('button', { name: 'Start the container' }));
    await waitFor(() => expect(api.testEnvStart).toHaveBeenCalledTimes(1));
    expect(startCall(0)[0]).toBe('start');
    expect(startCall(0)[1].hosts).toEqual(['h2']);
    emit({ t: 'exit', ok: true });

    await waitFor(() => expect(within(card('hub')).getByRole('button', { name: 'Deploy & run on this host' })).toBeEnabled());
    fireEvent.click(within(card('hub')).getByRole('button', { name: 'Deploy & run on this host' }));
    await waitFor(() => expect(api.testEnvStart).toHaveBeenCalledTimes(2));
    expect(startCall(1)).toEqual(['run', expect.objectContaining({ hosts: ['h1'] })]);
  });

  it('stops and recreates one host', async () => {
    await setup();
    const hub = () => card('hub');
    await waitFor(() => expect(within(hub()).getByRole('button', { name: 'Stop the container (keeps what is installed)' })).toBeEnabled());
    fireEvent.click(within(hub()).getByRole('button', { name: 'Stop the container (keeps what is installed)' }));
    await waitFor(() => expect(api.testEnvStart).toHaveBeenCalledTimes(1));
    expect(startCall(0)).toEqual(['stop', expect.objectContaining({ hosts: ['h1'] })]);
    emit({ t: 'exit', ok: true });

    const recreate = /^Recreate/;
    await waitFor(() => expect(within(hub()).getByRole('button', { name: recreate })).toBeEnabled());
    fireEvent.click(within(hub()).getByRole('button', { name: recreate }));
    await waitFor(() => expect(api.testEnvStart).toHaveBeenCalledTimes(2));
    expect(startCall(1)).toEqual(['reset', expect.objectContaining({ hosts: ['h1'] })]);
  });

  it('sets up a host that has no container', async () => {
    await setup({ states: { h1: 'running' } });
    const setUp = within(card('web')).getByRole('button', { name: /^Set up this host/ });
    await waitFor(() => expect(setUp).toBeEnabled());
    expect(within(card('web')).getByText('Not set up')).toBeInTheDocument();
    fireEvent.click(setUp);
    await waitFor(() => expect(api.testEnvStart).toHaveBeenCalled());
    expect(startCall()).toEqual(['test', expect.objectContaining({ hosts: ['h2'] })]);
  });

  it('updates host states, steps and compliance from streamed events', async () => {
    await setup();
    await deployAndRun();
    emit({ t: 'host', host: 'h2', state: 'provisioning' });
    emit({ t: 'step', host: 'h2', step: 'bootstrap', message: 'Bootstrapping to hub' });
    expect(within(card('web')).getByText('Setting up')).toBeInTheDocument();
    expect(within(card('web')).getByText('Bootstrapping to hub', { selector: 'p' })).toBeInTheDocument();

    emit({ t: 'result', host: 'h2', exit: 0, run: 1, kept: 90, repaired: 10, notKept: 0 });
    emit({ t: 'host', host: 'h2', state: 'done', converged: true });
    expect(within(card('web')).getByText('Converged')).toBeInTheDocument();
    expect(within(card('web')).getByText('90% kept · 10% repaired · 0% not kept')).toBeInTheDocument();

    emit({ t: 'host', host: 'h1', state: 'failed' });
    expect(within(card('hub')).getByText('Failed')).toBeInTheDocument();
  });

  it('summarises the last run', async () => {
    await setup();
    await deployAndRun();
    emit({ t: 'result', host: 'h1', exit: 0, run: 1, kept: 100, repaired: 0, notKept: 0 });
    emit({ t: 'host', host: 'h1', state: 'done', converged: true });
    emit({ t: 'exit', ok: true });
    expect(await screen.findByText('Last run: converged · 1 host')).toBeInTheDocument();
  });

  it('shows an action failing to start', async () => {
    await setup();
    vi.mocked(api.testEnvStart).mockRejectedValueOnce(new Error('Docker is not running'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Deploy & run' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Deploy & run' }));
    expect(await screen.findAllByText('Docker is not running')).toHaveLength(2);
  });

  it('streams the log and filters it by host and text', async () => {
    await setup();
    expect(screen.getByText(/^Nothing yet/)).toBeInTheDocument();
    await deployAndRun();
    emit({ t: 'log', host: 'h1', line: 'R: hub says hi', stream: 'agent' });
    emit({ t: 'log', host: 'h2', line: 'R: web says hi', stream: 'agent' });
    expect(screen.getByText('── Deploy & run ──')).toBeInTheDocument();
    expect(screen.getByText('hub says hi')).toBeInTheDocument();
    expect(screen.getByText('web says hi')).toBeInTheDocument();

    fireEvent.click(within(logTabs()).getByRole('button', { name: 'web' }));
    expect(screen.queryByText('hub says hi')).not.toBeInTheDocument();
    expect(screen.getByText('web says hi')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All logs' }));
    fireEvent.change(logFilter(), { target: { value: 'HUB SAYS' } });
    expect(screen.getByText('hub says hi')).toBeInTheDocument();
    expect(screen.queryByText('web says hi')).not.toBeInTheDocument();
  });

  it('folds container setup output into one row', async () => {
    await setup();
    await deployAndRun();
    emit({ t: 'log', host: 'h1', line: 'apt-get install' });
    emit({ t: 'log', host: 'h1', line: 'unpacking' });
    expect(screen.queryByText('unpacking')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Container setup — 2 lines'));
    expect(screen.getByText('unpacking')).toBeInTheDocument();
  });

  it('clears the log', async () => {
    await setup();
    await deployAndRun();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the log' }));
    expect(screen.queryByText('── Deploy & run ──')).not.toBeInTheDocument();
  });

  it('lists problems: Show block calls back, Show in log filters the log', async () => {
    const { onShowBlock } = await setup();
    await deployAndRun();
    emit({ t: 'log', host: 'h1', line: 'error: Could not install nginx', stream: 'agent' });
    emit({ t: 'log', host: 'h2', line: 'R: unrelated', stream: 'agent' });
    emit({ t: 'problems', host: 'h1', problems: [problem] });
    expect(screen.getByText('1 problem in the last run')).toBeInTheDocument();
    expect(screen.getByText('Bundle main')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show block' }));
    expect(onShowBlock).toHaveBeenCalledWith('f1', 'b1');

    fireEvent.click(screen.getByRole('button', { name: 'Show in log' }));
    expect(logFilter()).toHaveValue('Could not install nginx');
    expect(screen.queryByText('unrelated')).not.toBeInTheDocument();
  });

  it('resets the log filter when a new action starts', async () => {
    await setup();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled());
    fireEvent.change(logFilter(), { target: { value: 'something' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(logFilter()).toHaveValue(''));
  });

  it('says when Docker is not running, and checks again on Retry', async () => {
    await setup({ dockerUp: false });
    expect(await screen.findByText('Docker isn’t running')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deploy & run' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.testEnvDoctor).toHaveBeenCalledTimes(2));
  });
});
