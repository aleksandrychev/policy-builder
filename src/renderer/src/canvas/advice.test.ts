import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';
import { PYTHON_ADVICE, blockAdvice, needsPython } from './advice';

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

describe('python3 for promise modules', () => {
  const clone = block('git-checkout', { destination: '/srv/a' });

  it('is advised on a block whose promise type runs with Python, until something installs it', () => {
    expect(blockAdvice(clone, [], [clone])).toEqual([PYTHON_ADVICE]);
    const install = block('install-package', { package_name: 'curl\npython3' }, { instanceId: 'p' });
    expect(blockAdvice(clone, [], [clone, install])).toEqual([]);
    expect(blockAdvice(clone, [], [clone], ['python3'])).toEqual([]);
  });

  it('isn’t for promise types without Python, or blocks of CFEngine’s own', () => {
    expect(needsPython(block('custom-promise', { promise_type: 'docker_compose' }), [])).toBe(false);
    expect(needsPython(block('custom-promise', { promise_type: 'json' }), [])).toBe(true);
    expect(needsPython(block('install-package', { package_name: 'git' }), [])).toBe(false);
  });
});
