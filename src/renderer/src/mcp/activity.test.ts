import { createAppStore } from '../store';
import {
  ABANDONED_MS,
  IMPLICIT_MS,
  agentActivity,
  callEnded,
  callStarted,
  isWorking,
  logCleared,
  paused,
  resetActivity,
  resumed,
  stopNoteChanged,
  workBegan,
  workEnded
} from './activity';
import { describeCall } from './describe';
import { answerLogged } from './useMcpTools';

describe('agent activity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetActivity();
  });
  afterEach(() => vi.useRealTimers());

  it('is working while a call runs, and for a while after it without begin_work', () => {
    const id = callStarted('add_block', 'Add a block');
    expect(isWorking(agentActivity())).toBe(true);
    callEnded(id, true);
    expect(agentActivity().log).toMatchObject([{ text: 'Add a block', ok: true }]);
    expect(isWorking(agentActivity(), Date.now() + IMPLICIT_MS - 1)).toBe(true);
    expect(isWorking(agentActivity(), Date.now() + IMPLICIT_MS + 1)).toBe(false);
  });

  it('stays working from begin_work to end_work, or until it goes quiet too long', () => {
    workBegan('Adding nginx');
    expect(isWorking(agentActivity(), Date.now() + IMPLICIT_MS * 3)).toBe(true);
    expect(isWorking(agentActivity(), Date.now() + ABANDONED_MS + 1)).toBe(false);
    workEnded();
    expect(isWorking(agentActivity())).toBe(false);
  });

  it('releases the editor as soon as end_work answers', () => {
    workBegan('Adding nginx');
    const id = callStarted('end_work', 'Finished');
    workEnded();
    callEnded(id, true);
    expect(isWorking(agentActivity())).toBe(false);
  });

  it('stops working when paused, until resumed', () => {
    workBegan('Adding nginx');
    paused();
    expect(agentActivity()).toMatchObject({ paused: true, task: null });
    expect(isWorking(agentActivity())).toBe(false);
    resumed();
    expect(agentActivity().paused).toBe(false);
  });

  it('keeps failures with what failed, and clears', () => {
    callEnded(callStarted('connect', 'Connect a → b'), false, 'That arrow would create a loop');
    expect(agentActivity().log[0]).toMatchObject({ ok: false, outcome: 'That arrow would create a loop' });
    logCleared();
    expect(agentActivity().log).toEqual([]);
  });
});

describe('describeCall', () => {
  it('names files and blocks instead of ids', () => {
    const store = createAppStore();
    expect(describeCall('add_block', { fileId: 'nope', blockType: 'install-package', label: 'Install nginx' }, store.getState())).toBe(
      'Add Install Package “Install nginx” to a file'
    );
    expect(describeCall('begin_work', { task: 'Adding nginx' }, store.getState())).toBe('Started: Adding nginx');
    expect(describeCall('mystery', {}, store.getState())).toBe('mystery');
  });
});

describe('a stopped agent', () => {
  beforeEach(() => resetActivity());

  it('is refused, except end_work and get_project_status', async () => {
    const getState = createAppStore().getState;
    const answer = vi.fn(async () => ({ ok: true, content: '{}' }));
    paused();
    for (const tool of ['add_block', 'begin_work', 'get_file']) {
      expect(await answerLogged(tool, {}, getState, answer)).toMatchObject({ ok: false, content: expect.stringMatching(/^Stopped by the user/) });
    }
    expect(answer).not.toHaveBeenCalled();
    for (const tool of ['end_work', 'get_project_status']) expect((await answerLogged(tool, {}, getState, answer)).ok).toBe(true);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(agentActivity().paused).toBe(true);
  });

  it('is told the user’s note, until it is allowed again', async () => {
    const getState = createAppStore().getState;
    const answer = vi.fn(async () => ({ ok: true, content: '{}' }));
    paused();
    stopNoteChanged('wrong project');
    expect((await answerLogged('add_block', {}, getState, answer)).content).toMatch(/The user’s note: “wrong project”$/);
    resumed();
    expect(agentActivity().stopNote).toBe('');
  });
});
