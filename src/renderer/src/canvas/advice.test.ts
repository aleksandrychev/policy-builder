import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';
import { blockAdvice } from './advice';

const block = (blockId: string, params: Record<string, string>, extra: Partial<BlockInstance> = {}): BlockInstance => ({
  instanceId: 'b',
  blockId,
  fileId: 'f',
  label: 'x',
  params,
  ...extra
});
const arrow = (target: string, outcomes: BlockEdge['outcomes']): BlockEdge => ({ id: 'e', fileId: 'f', source: 'a', target, outcomes });

describe('block advice', () => {
  it('flags a directory mode that can be read but not entered', () => {
    expect(blockAdvice(block('create-directory', { mode: '644' }), [])).toEqual([
      'Mode 644 lets owner, group, others read the directory but not enter it (no x). Directories usually take 755.'
    ]);
    expect(blockAdvice(block('create-directory', { mode: '0750' }), [])).toEqual([]);
    expect(blockAdvice(block('create-directory', { mode: '700' }), [])).toEqual([]);
    expect(blockAdvice(block('create-directory', { mode: '640' }), [])[0]).toMatch(/owner, group read .* take 750/);
    expect(blockAdvice(block('create-directory', { mode: '' }), [])).toEqual([]);
    // Files: 644 is normal.
    expect(blockAdvice(block('create-edit-file', { mode: '644' }), [])).toEqual([]);
  });

  it('flags a restart that would run on every agent run', () => {
    const restart = block('manage-service', { service_name: 'nginx', action: 'restart' });
    expect(blockAdvice(restart, [])[0]).toMatch(/^A restart with no arrow on "repaired"/);
    expect(blockAdvice(restart, [arrow('b', ['kept', 'repaired'])])).toHaveLength(1);
    expect(blockAdvice(restart, [arrow('b', ['repaired'])])).toEqual([]);
    // Behind its group's arrow.
    expect(blockAdvice({ ...restart, groupId: 'g' }, [arrow('g', ['repaired'])])).toEqual([]);
    expect(blockAdvice(block('manage-service', { service_name: 'nginx', action: 'start' }), [])).toEqual([]);
    expect(blockAdvice(undefined, [])).toEqual([]);
  });
});
