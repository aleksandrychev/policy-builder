import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';
import type { PolicyFile } from '../store/filesSlice/types';
import type { BlockGroup } from '../store/groupsSlice/types';
import type { ProjectData } from './cfbsProject';
import { type ProjectChange, commitMessage, projectChanges } from './projectChanges';

const file = (id: string, parts: Partial<PolicyFile> = {}): PolicyFile => ({ bundle: id, id, name: id, parentId: null, ...parts });
const block = (instanceId: string, parts: Partial<BlockInstance> = {}): BlockInstance => ({
  blockId: 'install-package',
  fileId: 'main',
  instanceId,
  label: instanceId,
  params: {},
  ...parts
});
const edge = (id: string, parts: Partial<BlockEdge> = {}): BlockEdge => ({ fileId: 'main', id, outcomes: ['kept'], source: 'a', target: 'b', ...parts });
const group = (id: string, parts: Partial<BlockGroup> = {}): BlockGroup => ({ color: 'primary', fileId: 'main', id, name: id, ...parts });

const project = ({
  canvas = [],
  edges = [],
  files = [file('main')],
  groups = []
}: { canvas?: BlockInstance[]; edges?: BlockEdge[]; files?: PolicyFile[]; groups?: BlockGroup[] } = {}): ProjectData => ({
  canvas,
  derivedNodes: {},
  edges,
  files: { currentFileId: null, files, folders: [] },
  groups,
  testEnvironments: []
});

describe('projectChanges', () => {
  it('lists everything as added without a last commit', () => {
    const now = project({ canvas: [block('nginx', { label: 'Nginx' })], edges: [edge('e1')], groups: [group('g', { name: 'Web' })] });
    expect(projectChanges(null, now)).toEqual([
      { kind: 'added', what: 'File main.cf' },
      { kind: 'added', what: 'Nginx (Install Package)' },
      { kind: 'added', what: 'Group Web' },
      { kind: 'added', what: '1 arrow' }
    ]);
  });

  it('finds no changes in an identical project', () => {
    const data = project({ canvas: [block('a')], edges: [edge('e1')], groups: [group('g')] });
    expect(projectChanges(data, structuredClone(data))).toEqual([]);
  });

  it('lists added, changed and removed blocks', () => {
    const before = project({ canvas: [block('a', { label: 'A' }), block('b', { label: 'B' })] });
    const after = project({ canvas: [block('a', { label: 'A', params: { package_name: 'nginx' } }), block('c', { label: 'C' })] });
    expect(projectChanges(before, after)).toEqual([
      { kind: 'changed', what: 'A (Install Package)', detail: 'params' },
      { kind: 'added', what: 'C (Install Package)' },
      { kind: 'removed', what: 'B (Install Package)' }
    ]);
  });

  it('names a changed block by its old label, with every changed part', () => {
    const condition = { className: 'linux', kind: 'class', mode: 'if' } as const;
    const after = project({ canvas: [block('a', { label: 'Renamed', condition, groupId: 'g' })] });
    expect(projectChanges(project({ canvas: [block('a', { label: 'Old' })] }), after)).toEqual([
      { kind: 'changed', what: 'Old (Install Package)', detail: 'label, condition, group' }
    ]);
  });

  it('falls back to the block id for an unknown block', () => {
    expect(projectChanges(project(), project({ canvas: [block('x', { blockId: 'no-such-block', label: 'X' })] }))).toEqual([
      { kind: 'added', what: 'X (no-such-block)' }
    ]);
  });

  it('ignores key order, missing-vs-undefined fields and canvas position', () => {
    const before = project({ canvas: [block('a', { params: { a: '1', b: '2' }, position: { x: 0, y: 0 } })] });
    const after = project({ canvas: [block('a', { params: { b: '2', a: '1' }, position: { x: 50, y: 90 }, condition: undefined })] });
    expect(projectChanges(before, after)).toEqual([]);
  });

  it('notices reordered entries, which is not just key order', () => {
    const entry = (id: string) => ({ id, params: {} });
    const before = project({ canvas: [block('a', { entries: [entry('1'), entry('2')] })] });
    const after = project({ canvas: [block('a', { entries: [entry('2'), entry('1')] })] });
    expect(projectChanges(before, after)).toEqual([{ kind: 'changed', what: 'a (Install Package)', detail: 'values' }]);
  });

  it('lists file renames, condition changes and removals', () => {
    const before = project({ files: [file('main'), file('web'), file('old')] });
    const after = project({ files: [file('main', { name: 'site' }), file('web', { condition: { className: 'linux', kind: 'class', mode: 'if' } })] });
    expect(projectChanges(before, after)).toEqual([
      { kind: 'changed', what: 'File main.cf', detail: 'renamed to site.cf' },
      { kind: 'changed', what: 'File web.cf', detail: 'condition' },
      { kind: 'removed', what: 'File old.cf' }
    ]);
  });

  it('ignores a group frame’s size and colour', () => {
    const before = project({ groups: [group('g', { name: 'Web' }), group('h')] });
    const after = project({ groups: [group('g', { name: 'Web', rect: { x: 0, y: 0, width: 10, height: 10 }, color: 'error' })] });
    expect(projectChanges(before, after)).toEqual([{ kind: 'removed', what: 'Group h' }]);
    expect(projectChanges(before, project({ groups: [group('g', { name: 'App' }), group('h')] }))).toEqual([{ kind: 'changed', what: 'Group Web' }]);
  });

  it('counts arrows', () => {
    const before = project({ edges: [edge('e1'), edge('e2'), edge('e3')] });
    const after = project({ edges: [edge('e1', { outcomes: ['repaired'] }), edge('e4'), edge('e5')] });
    expect(projectChanges(before, after)).toEqual([
      { kind: 'added', what: '2 arrows' },
      { kind: 'changed', what: '1 arrow', detail: 'outcomes' },
      { kind: 'removed', what: '2 arrows' }
    ]);
  });
});

describe('commitMessage', () => {
  const change = (kind: ProjectChange['kind'], what: string, detail?: string): ProjectChange => ({ kind, what, ...(detail ? { detail } : {}) });

  it('is empty without changes', () => {
    expect(commitMessage([])).toBe('');
  });

  it('titles by kind, without block types, and lists every change', () => {
    const message = commitMessage([
      change('changed', 'Nginx (Install Package)', 'params'),
      change('added', 'Harden SSH (Set Config Values)'),
      change('removed', 'File old.cf')
    ]);
    expect(message).toBe(
      'Added Harden SSH; changed Nginx; removed File old.cf\n\n' +
        '- Changed Nginx (Install Package): params\n- Added Harden SSH (Set Config Values)\n- Removed File old.cf'
    );
  });

  it('names three per kind, then an ellipsis', () => {
    const title = commitMessage(['A', 'B', 'C', 'D'].map(name => change('added', name))).split('\n')[0];
    expect(title).toBe('Added A, B, C …');
  });

  it('shortens a long title to 78 characters', () => {
    const title = commitMessage([change('added', 'x'.repeat(50)), change('removed', 'y'.repeat(50))]).split('\n')[0];
    expect(title).toHaveLength(78);
    expect(title.endsWith('…')).toBe(true);
  });
});
