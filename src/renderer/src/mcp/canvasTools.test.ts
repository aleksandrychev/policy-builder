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
  return { call, fileId, opened, otherId, store };
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
