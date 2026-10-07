import { act, renderHook } from '@testing-library/react';

import type { TestEnvEvent, TestProblem } from '../../../preload/api';
import { newEnvironment } from '../store/testEnvironmentsSlice';
import type { TestEnvironment } from '../store/testEnvironmentsSlice/types';

type Api = NonNullable<Window['api']>;
type TestRuns = typeof import('./testRuns');

let runs: TestRuns;
let emit: (runId: string, event: TestEnvEvent) => void;
let api: { cancelTestEnvRun: ReturnType<typeof vi.fn>; testEnvStart: ReturnType<typeof vi.fn>; testEnvStatus: ReturnType<typeof vi.fn> };

const environment: TestEnvironment = { ...newEnvironment('Env', { id: 'h1', name: 'web' }), id: 'env' };
const request = { environment };

const problem = (block: string | null): TestProblem => ({ block, bundle: null, cause: [], count: 1, file: null, fileId: null, line: null, message: 'boom' });

// testRuns keeps its state at module level: each test gets a fresh copy.
beforeEach(async () => {
  vi.resetModules();
  api = { cancelTestEnvRun: vi.fn(async () => {}), testEnvStart: vi.fn(async () => 'run-1'), testEnvStatus: vi.fn() };
  const onTestEnvEvent: Api['onTestEnvEvent'] = callback => {
    emit = (runId, event) => act(() => callback(runId, event));
    return () => {};
  };
  window.api = { ...api, onTestEnvEvent } as unknown as Api;
  runs = await import('./testRuns');
});

afterEach(() => {
  delete window.api;
});

function watch(environmentId = environment.id) {
  return renderHook(() => runs.useEnvironmentRuntime(environmentId)).result;
}

async function start(action: Parameters<TestRuns['startAction']>[1] = 'up') {
  await act(() => runs.startAction(environment, action, request));
}

describe('testRuns', () => {
  it('starts an action: a step line, the action and its run id', async () => {
    const runtime = watch();
    await start('up');
    expect(api.testEnvStart).toHaveBeenCalledWith('up', request);
    expect(runtime.current).toMatchObject({ action: 'up', runId: 'run-1', error: null, outcome: null });
    expect(runtime.current.lines.map(line => [line.kind, line.text])).toEqual([['step', '── Start ──']]);
  });

  it('logs no step line for a terminal command', async () => {
    const runtime = watch();
    await start('exec');
    expect(runtime.current.lines).toEqual([]);
  });

  it('records a failure to start as an error', async () => {
    api.testEnvStart.mockRejectedValueOnce(new Error('Docker is not running'));
    const runtime = watch();
    await start('up');
    expect(runtime.current).toMatchObject({ action: null, error: 'Docker is not running', runId: null });
    expect(runtime.current.lines.at(-1)).toMatchObject({ kind: 'error', text: 'Docker is not running' });
  });

  it('ignores events of an unknown run', async () => {
    const runtime = watch();
    await start();
    const before = runtime.current;
    emit('other', { t: 'error', message: 'x' });
    expect(runtime.current).toBe(before);
  });

  it('appends log lines by stream', async () => {
    const runtime = watch();
    await start();
    emit('run-1', { t: 'log', line: 'installing', host: 'h1' });
    emit('run-1', { t: 'log', line: 'R: hi', host: 'h1', stream: 'agent' });
    emit('run-1', { t: 'log', line: 'ls', stream: 'command' });
    expect(runtime.current.lines.slice(1).map(line => [line.kind, line.text])).toEqual([
      ['setup', 'installing'],
      ['agent', 'R: hi'],
      ['command', 'ls']
    ]);
  });

  it('keeps at most 5000 log lines', async () => {
    const runtime = watch();
    await start();
    for (let index = 0; index < 5005; index += 1) emit('run-1', { t: 'log', line: String(index) });
    expect(runtime.current.lines).toHaveLength(5000);
    expect(runtime.current.lines.at(-1)?.text).toBe('5004');
  });

  it('shows a host step while it is busy, and drops it once it is not', async () => {
    const runtime = watch();
    await start();
    emit('run-1', { t: 'step', host: 'h1', step: 'bootstrap', message: 'Bootstrapping' });
    expect(runtime.current.hosts.h1).toEqual({ state: 'provisioning', step: 'Bootstrapping' });
    expect(runtime.current.lines.at(-1)).toMatchObject({ kind: 'step', text: 'Bootstrapping', host: 'h1' });

    emit('run-1', { t: 'host', host: 'h1', state: 'running', container: 'c1', ip: '10.0.0.2' });
    expect(runtime.current.hosts.h1).toMatchObject({ state: 'running', step: 'Bootstrapping', container: 'c1', ip: '10.0.0.2' });

    emit('run-1', { t: 'host', host: 'h1', state: 'done', converged: true });
    expect(runtime.current.hosts.h1).toEqual({ state: 'done', step: undefined, container: 'c1', ip: '10.0.0.2', converged: true });
  });

  it('collects results, problems and the hub', async () => {
    const runtime = watch();
    await start('run');
    emit('run-1', { t: 'result', host: 'h1', run: 1, exit: 0, kept: 3, repaired: 1 });
    emit('run-1', { t: 'problems', host: 'h1', problems: [problem('b1')] });
    emit('run-1', { t: 'hub', host: 'h1', url: 'https://localhost', setup_code: '1234' });
    expect(runtime.current.results).toEqual([{ t: 'result', host: 'h1', run: 1, exit: 0, kept: 3, repaired: 1 }]);
    expect(runtime.current.problems).toEqual({ h1: [problem('b1')] });
    expect(runtime.current.hub).toEqual({ url: 'https://localhost', setupCode: '1234' });
  });

  it('logs a failed command exit, not a clean one', async () => {
    const runtime = watch();
    await start('exec');
    emit('run-1', { t: 'exec', host: 'h1', exit: 0 });
    emit('run-1', { t: 'exec', host: 'h1', exit: 2 });
    expect(runtime.current.lines).toEqual([expect.objectContaining({ kind: 'error', text: 'exit 2', host: 'h1' })]);
  });

  it('ends an action ok', async () => {
    const runtime = watch();
    await start();
    emit('run-1', { t: 'exit', ok: true });
    expect(runtime.current).toMatchObject({ action: null, runId: null, outcome: 'ok', error: null });
    // The run is over: its late events are ignored.
    emit('run-1', { t: 'error', message: 'late' });
    expect(runtime.current.error).toBeNull();
  });

  it('keeps the first error when the action fails', async () => {
    const runtime = watch();
    await start();
    emit('run-1', { t: 'error', message: 'pull failed' });
    expect(runtime.current.lines.at(-1)).toMatchObject({ kind: 'error', text: 'pull failed' });
    emit('run-1', { t: 'exit', ok: false, message: 'Exited 1' });
    expect(runtime.current).toMatchObject({ action: null, outcome: 'error', error: 'pull failed' });
  });

  it('falls back to the exit message, then "Failed"', async () => {
    const runtime = watch();
    await start();
    emit('run-1', { t: 'exit', ok: false, message: 'Exited 1' });
    expect(runtime.current.error).toBe('Exited 1');
    await start();
    emit('run-1', { t: 'exit', ok: false });
    expect(runtime.current.error).toBe('Failed');
  });

  describe('Deploy & run', () => {
    it('records the run, and passes it when it ends clean', async () => {
      const runtime = watch();
      await act(() => runs.startAction(environment, 'run', { ...request, hosts: ['h1'] }));
      expect(runtime.current.lastRun).toMatchObject({ content: 'null', hosts: 1, passed: null });
      emit('run-1', { t: 'result', host: 'h1', run: 1, exit: 0, kept: 2 });
      emit('run-1', { t: 'exit', ok: true });
      expect(runtime.current.lastRun?.passed).toBe(true);
    });

    it('fails it on a problem or a promise not kept', async () => {
      const runtime = watch();
      await start('test');
      emit('run-1', { t: 'problems', host: 'h1', problems: [problem(null)] });
      emit('run-1', { t: 'exit', ok: true });
      expect(runtime.current.lastRun?.passed).toBe(false);

      await start('run');
      emit('run-1', { t: 'result', host: 'h1', run: 1, exit: 0, notKept: 1 });
      emit('run-1', { t: 'exit', ok: true });
      expect(runtime.current.lastRun?.passed).toBe(false);
    });

    it('clears the previous results and problems', async () => {
      const runtime = watch();
      await start('run');
      emit('run-1', { t: 'result', host: 'h1', run: 1, exit: 0, notKept: 1 });
      emit('run-1', { t: 'problems', host: 'h1', problems: [problem('b1')] });
      emit('run-1', { t: 'exit', ok: true });
      await start('run');
      expect(runtime.current).toMatchObject({ results: [], problems: {} });
    });

    it('leaves the last run alone on other actions', async () => {
      const runtime = watch();
      await start('run');
      emit('run-1', { t: 'exit', ok: true });
      const lastRun = runtime.current.lastRun;
      await start('stop');
      emit('run-1', { t: 'exit', ok: false });
      expect(runtime.current.lastRun).toBe(lastRun);
    });
  });

  it('cancels the running action only', async () => {
    runs.cancelAction(environment.id);
    expect(api.cancelTestEnvRun).not.toHaveBeenCalled();
    await start();
    runs.cancelAction(environment.id);
    expect(api.cancelTestEnvRun).toHaveBeenCalledWith('run-1');
  });

  it('clears the log', async () => {
    const runtime = watch();
    await start();
    act(() => runs.clearLog(environment.id));
    expect(runtime.current.lines).toEqual([]);
  });

  describe('refreshStatus', () => {
    it('maps a running container to ready, keeping a finished host as it was', async () => {
      const runtime = watch();
      await start();
      emit('run-1', { t: 'host', host: 'h1', state: 'done' });
      emit('run-1', { t: 'exit', ok: true });
      api.testEnvStatus.mockResolvedValue({
        hosts: { h1: { state: 'running', container: 'c1', ip: '10.0.0.2' }, h2: { state: 'running' }, h3: { state: 'exited' } }
      });
      await act(() => runs.refreshStatus(environment, request));
      expect(runtime.current.hosts).toEqual({
        h1: { state: 'done', container: 'c1', ip: '10.0.0.2', converged: undefined, step: undefined },
        h2: { state: 'ready', container: undefined, ip: undefined },
        h3: { state: 'exited', container: undefined, ip: undefined }
      });
    });

    it('does nothing while an action runs', async () => {
      await start();
      await runs.refreshStatus(environment, request);
      expect(api.testEnvStatus).not.toHaveBeenCalled();
    });
  });

  it('reports activity across environments until seen', async () => {
    const activity = renderHook(() => runs.useTestActivity()).result;
    await start();
    expect(activity.current).toEqual({ running: true, outcome: null });
    emit('run-1', { t: 'exit', ok: false });
    expect(activity.current).toEqual({ running: false, outcome: 'error' });
    act(() => runs.markTestActivitySeen());
    expect(activity.current).toEqual({ running: false, outcome: null });
  });

  it('lists the hosts each block failed on, by host name', async () => {
    const hostNames = new Map([['h1', 'web']]);
    const problems = renderHook(() => runs.useBlockProblems(hostNames)).result;
    await start('run');
    emit('run-1', { t: 'problems', host: 'h1', problems: [problem('b1'), problem('b1'), problem(null)] });
    emit('run-1', { t: 'problems', host: 'h2', problems: [problem('b1'), problem('b2')] });
    expect(problems.current).toEqual({ b1: ['web', 'h2'], b2: ['h2'] });
  });
});
