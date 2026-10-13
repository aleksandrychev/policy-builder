import { fileConditionClassNameChanged, fileConditionEnabled, fileDescriptionChanged, fileMoved, folderAdded } from '../store/filesSlice';
import { historyCleared } from '../store/history';
import { projectCreated } from '../store/projectSlice';
import { addBlock, addFile, blockOf, makeStore, undoAll } from '../store/test/storeTestUtils';
import type { ToolEnv } from './shared';
import { type ToolAnswer, answerTool } from './tools';

function setup() {
  const store = makeStore();
  store.dispatch(projectCreated({ name: 'Web' }));
  const fileId = addFile(store, 'Main');
  const otherId = addFile(store, 'Other');
  store.dispatch(historyCleared());
  const opened: string[] = [];
  const env: ToolEnv = {
    canvas: {
      openFile: id => opened.push(id),
      selectedInstanceId: null,
      fitView: () => undefined,
      nodeHeight: () => undefined,
      showTests: () => undefined,
      sizeOf: () => ({ width: 200, height: 80 })
    },
    dispatch: store.dispatch,
    getState: store.getState,
    session: { create: vi.fn(), dirty: false, open: vi.fn(), save: vi.fn(), saveAs: vi.fn() }
  };
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const answer: ToolAnswer = await answerTool(env, name, input);
    return { ...answer, result: answer.ok ? JSON.parse(answer.content) : undefined };
  };
  return { call, env, fileId, opened, otherId, store };
}

const report = (fileId: string, label: string, extra: Record<string, unknown> = {}) => ({
  fileId,
  blockType: 'report-message',
  label,
  params: { message: label },
  ...extra
});

describe('MCP canvas tools: adding blocks', () => {
  it('adds a block with its condition, group and arrow in one step', async () => {
    const { call, fileId, opened, store } = setup();
    const first = addBlock(store, fileId);
    const group = (await call('group_blocks', { blockIds: [first] })).result.id;
    store.dispatch(historyCleared());

    const { id } = (
      await call('add_block', report(fileId, 'Done', { condition: { className: 'debian', mode: 'if' }, groupId: group, after: first, outcomes: ['repaired'] }))
    ).result;
    expect(blockOf(store, id)).toMatchObject({ label: 'Done', groupId: group, condition: { className: 'debian', mode: 'if' } });
    expect(store.getState().edges).toContainEqual(expect.objectContaining({ source: first, target: id, outcomes: ['repaired'] }));
    expect(opened.at(-1)).toBe(fileId);
    expect(undoAll(store)).toBe(1);
  });

  it('keeps a note on a block, changed or removed with update_block', async () => {
    const { call, fileId, store } = setup();
    const { id } = (await call('add_block', report(fileId, 'Backup', { note: ' Daily, not weekly ' }))).result;
    expect(blockOf(store, id)?.note).toBe('Daily, not weekly');
    expect((await call('get_file', { fileId })).result.blocks[0]).toMatchObject({ id, note: 'Daily, not weekly' });
    await call('update_block', { blockId: id, note: 'Hourly' });
    expect(blockOf(store, id)?.note).toBe('Hourly');
    await call('update_block', { blockId: id, note: '' });
    expect(blockOf(store, id)).not.toHaveProperty('note');
  });

  it('refuses an arrow or group that breaks the canvas rules', async () => {
    const { call, fileId, otherId, store } = setup();
    const inOther = addBlock(store, otherId);
    const first = addBlock(store, fileId);
    const group = (await call('group_blocks', { blockIds: [first] })).result.id;

    expect((await call('add_block', report(fileId, 'x', { after: inOther }))).content).toMatch(/same file/);
    expect((await call('add_block', report(fileId, 'x', { after: first }))).content).toMatch(/group’s edge/);
    expect((await call('add_block', report(otherId, 'x', { groupId: group }))).content).toMatch(/its own file/);
    expect((await call('add_block', report(fileId, 'x', { condition: { className: 'linux' } }))).content).toMatch(/mode of if or unless/);
    expect((await call('add_block', { fileId, blockType: 'define-variable', groupId: group })).content).toMatch(/don’t go in groups/);
  });

  it('adds a batch in one step, chaining blocks by their index', async () => {
    const { call, fileId, otherId, store } = setup();
    const { added } = (
      await call('add_blocks', {
        blocks: [
          report(fileId, 'One'),
          report(fileId, 'Two', { after: 0 }),
          report(fileId, 'Three', { after: 1, outcomes: ['not_kept'] }),
          report(otherId, 'Elsewhere')
        ]
      })
    ).result;
    expect(added.map((block: { label: string }) => block.label)).toEqual(['One', 'Two', 'Three', 'Elsewhere']);
    const [one, two, three] = added.map((block: { id: string }) => block.id);
    expect(store.getState().edges).toEqual([
      expect.objectContaining({ source: one, target: two, outcomes: ['kept', 'repaired'] }),
      expect.objectContaining({ source: two, target: three, outcomes: ['not_kept'] })
    ]);
    expect(blockOf(store, added[3].id)?.fileId).toBe(otherId);
    // Stacked one below the other, not on top of each other.
    expect(new Set(added.slice(0, 3).map((block: { id: string }) => blockOf(store, block.id)?.position?.y)).size).toBe(3);
    expect(undoAll(store)).toBe(1);
  });

  it('adds nothing when one block of the batch is invalid, and says which', async () => {
    const { call, fileId, store } = setup();
    const answer = await call('add_blocks', { blocks: [report(fileId, 'One'), { fileId, blockType: 'no-such-block' }, report(fileId, 'Three')] });
    expect(answer.ok).toBe(false);
    expect(answer.content).toMatch(/^blocks\[1\]: No block type no-such-block.*Nothing was added\.$/);
    expect(store.getState().canvas).toEqual([]);

    expect((await call('add_blocks', { blocks: [report(fileId, 'One', { after: 0 })] })).content).toMatch(/blocks\[0\]: after as a number/);
    expect((await call('add_blocks', { blocks: [] })).content).toMatch(/at least one block/);
  });

  it('reports advice in get_warnings', async () => {
    const { call, fileId } = setup();
    const { id } = (await call('add_block', { fileId, blockType: 'create-directory', params: { path: '/srv/data', mode: '644' } })).result;
    const answer = await call('get_warnings');
    expect(answer.result.blocks).toEqual([expect.objectContaining({ blockId: id, advice: [expect.stringMatching(/^Mode 644/)] })]);
  });

  it('describes a number with suggested values as taking others too', async () => {
    const { call, fileId } = setup();
    const { parameters } = (await call('get_block_type', { blockType: 'run-command' })).result;
    expect(parameters.find((param: { name: string }) => param.name === 'run_interval')).toMatchObject({
      options: ['', '60', '1440', '10080'],
      otherValues: 'any whole number from 1 too (Minutes between runs); options are suggestions'
    });
    expect((await call('add_block', { fileId, blockType: 'run-command', params: { command: '/bin/true', run_interval: '20160' } })).ok).toBe(true);
    expect((await call('add_block', { fileId, blockType: 'run-command', params: { command: '/bin/true', run_interval: '0' } })).ok).toBe(false);
  });

  it('names a Call Method promise after the block, with no label parameter of its own', async () => {
    const { call } = setup();
    const { parameters } = (await call('get_block_type', { blockType: 'call-method' })).result;
    expect(parameters.map((param: { name: string }) => param.name)).toEqual(['bundle_name', 'arguments']);
  });
});

describe('MCP canvas tools: reading the project', () => {
  it('gives an overview: files with their folder, gate, description, blocks by type and groups; the open file and selection', async () => {
    const { call, env, fileId, otherId, store } = setup();
    const folder = store.dispatch(folderAdded('Web', null)).payload.id;
    store.dispatch(fileMoved({ fileId: otherId, parentId: folder }));
    store.dispatch(fileConditionEnabled({ fileId }));
    store.dispatch(fileConditionClassNameChanged({ fileId, className: 'debian' }));
    store.dispatch(fileDescriptionChanged({ fileId, description: 'Packages' }));
    const first = addBlock(store, fileId);
    addBlock(store, fileId);
    addBlock(store, fileId, { blockId: 'define-variable', label: 'Vars', params: {} });
    const group = (await call('group_blocks', { blockIds: [first], name: 'Reports' })).result.id;
    env.canvas!.selectedInstanceId = first;

    const { result } = await call('get_project_overview');
    expect(result).toMatchObject({ project: 'Web', openFileId: store.getState().files.currentFileId, selectedBlock: { id: first, fileId } });
    const [main, other] = result.files;
    expect(main).toMatchObject({ id: fileId, condition: expect.stringContaining('debian'), description: 'Packages', groups: [{ id: group }] });
    expect(main.folder).toBeUndefined();
    expect(main.blocks).toEqual({ 'Report Message': 2, 'Define Variable': 1 });
    expect(other).toMatchObject({ id: otherId, folder: 'Web', blocks: {} });
  });

  it('generates one file’s policy with the lines each block made, or every file', async () => {
    const { call, fileId, store } = setup();
    const block = addBlock(store, fileId);
    const compilePolicy = vi.fn(async () => ({
      files: { './main.cf': 'bundle agent main {}', './other.cf': '' },
      sourceMap: { './main.cf': { [block]: [[3, 5]] } }
    }));
    window.api = { compilePolicy } as unknown as typeof window.api;
    try {
      expect((await call('get_generated_policy', { fileId })).result).toEqual({
        path: './main.cf',
        policy: 'bundle agent main {}',
        blocks: [{ id: block, lines: [[3, 5]] }]
      });
      expect(Object.keys((await call('get_generated_policy')).result.files)).toEqual(['./main.cf', './other.cf']);
      expect((await call('get_generated_policy', { fileId: 'nope' })).ok).toBe(false);
    } finally {
      delete window.api;
    }
    expect((await call('get_generated_policy')).content).toMatch(/couldn’t be generated/);
  });
});

describe('MCP canvas tools: changing the canvas', () => {
  it('removes a block in one undo step, showing its file', async () => {
    const { call, fileId, opened, store } = setup();
    const block = addBlock(store, fileId, { label: 'Old' });
    store.dispatch(historyCleared());
    expect((await call('remove_block', { blockId: block })).result).toEqual({ removed: block, label: 'Old' });
    expect(blockOf(store, block)).toBeUndefined();
    expect(opened.at(-1)).toBe(fileId);
    expect(undoAll(store)).toBe(1);
    expect((await call('remove_block', { blockId: 'gone' })).content).toMatch(/No block gone/);
  });

  it('connects two blocks in one undo step, and disconnects them', async () => {
    const { call, fileId, store } = setup();
    const [first, second] = [addBlock(store, fileId), addBlock(store, fileId)];
    store.dispatch(historyCleared());
    expect((await call('connect', { sourceId: first, targetId: second, outcomes: ['repaired'] })).result).toEqual({
      connected: { source: first, target: second, outcomes: ['repaired'] }
    });
    expect(store.getState().edges).toContainEqual(expect.objectContaining({ fileId, source: first, target: second, outcomes: ['repaired'] }));
    expect(undoAll(store)).toBe(1);

    await call('connect', { sourceId: first, targetId: second });
    expect((await call('disconnect', { sourceId: first, targetId: second })).result).toEqual({ disconnected: { source: first, target: second } });
    expect(store.getState().edges).toEqual([]);
    expect((await call('disconnect', { sourceId: first, targetId: second })).content).toMatch(/no arrow/);
  });

  it('refuses arrows that break the canvas rules', async () => {
    const { call, fileId, otherId, store } = setup();
    const [a, b, c] = [addBlock(store, fileId), addBlock(store, fileId), addBlock(store, fileId)];
    const inOther = addBlock(store, otherId);
    const variable = addBlock(store, fileId, { blockId: 'define-variable', label: 'Vars', params: {} });
    await call('connect', { sourceId: a, targetId: b });
    await call('connect', { sourceId: b, targetId: c });
    const grouped = addBlock(store, fileId);
    await call('group_blocks', { blockIds: [grouped] });
    const refusal = async (sourceId: string, targetId: string) => (await call('connect', { sourceId, targetId })).content;

    expect(await refusal(a, a)).toMatch(/two different blocks/);
    expect(await refusal(a, inOther)).toMatch(/same file/);
    expect(await refusal(a, variable)).toMatch(/can’t take arrows/);
    expect(await refusal(a, grouped)).toMatch(/group’s edge/);
    expect(await refusal(a, b)).toMatch(/already connected/);
    expect(await refusal(c, a)).toMatch(/loop/);
    expect(store.getState().edges).toHaveLength(2);
  });

  it('tidies a file in one undo step and fits the view', async () => {
    const { call, env, fileId, store } = setup();
    const blocks = [addBlock(store, fileId, { position: { x: 500, y: 0 } }), addBlock(store, fileId, { position: { x: 0, y: 900 } })];
    store.dispatch(historyCleared());
    const fitView = vi.spyOn(env.canvas!, 'fitView');
    expect((await call('tidy_file', { fileId })).result).toEqual({ tidied: fileId, blocks: 2 });
    const [first, second] = blocks.map(id => blockOf(store, id)!.position!);
    expect(first.x).toBe(second.x);
    expect(first.y).toBeLessThan(second.y);
    expect(fitView).toHaveBeenCalled();
    expect(undoAll(store)).toBe(1);
    expect((await call('tidy_file', { fileId: 'nope' })).ok).toBe(false);
  });
});
