import { type ComponentProps, type ReactNode, createElement } from 'react';
import { Provider } from 'react-redux';

import { act, renderHook } from '@testing-library/react';

import { useAppSelector } from '../store';
import { selectCanvasBlocks } from '../store/canvasSlice/selectors';
import type { BlockInstance } from '../store/canvasSlice/types';
import { inOneStep, undone } from '../store/history';
import { type TestStore, addBlock, addFile, blockOf, fileOf, makeStore } from '../store/test/storeTestUtils';
import { useClipboardActions } from './useClipboardActions';

const HEIGHT = 100;

// The hook as ProjectView uses it: `instances` are the open file's blocks.
function setUp(store: TestStore, fileId: string) {
  const announce = vi.fn();
  const onPasted = vi.fn();
  const hook = renderHook(
    ({ currentFileId }: { currentFileId: string }) => {
      const instances = useAppSelector(selectCanvasBlocks).filter(instance => instance.fileId === currentFileId);
      return useClipboardActions({
        announce,
        asOneStep: run => inOneStep(store.dispatch, run),
        currentFileId,
        instances,
        onPasted,
        sizeOf: () => ({ width: 200, height: HEIGHT })
      });
    },
    {
      initialProps: { currentFileId: fileId },
      wrapper: ({ children }: { children: ReactNode }) => createElement(Provider, { store } as ComponentProps<typeof Provider>, children)
    }
  );
  const run = (action: (actions: ReturnType<typeof useClipboardActions>) => void) => act(() => action(hook.result.current));
  return { announce, onPasted, hook, run };
}

const blocksIn = (store: TestStore, fileId: string) => store.getState().canvas.filter(instance => instance.fileId === fileId);

const variables = (names: string[]): Partial<BlockInstance> => ({
  blockId: 'define-variable',
  label: 'Variables',
  params: {},
  entries: names.map((name, index) => ({ id: `e${index}`, valueSourceId: 'literal', params: { variable_name: name, value: 'x' } }))
});

describe('useClipboardActions', () => {
  it('pastes a copy next to the original in the same file', () => {
    const store = makeStore();
    const fileId = addFile(store);
    const original = addBlock(store, fileId, { position: { x: 100, y: 60 } });
    const { announce, onPasted, run } = setUp(store, fileId);

    run(actions => actions.handleCopyBlock(original));
    run(actions => actions.handlePasteBlock());

    const [, pasted] = blocksIn(store, fileId);
    expect(blockOf(store, original)).toBeDefined();
    expect(pasted).toMatchObject({ blockId: 'report-message', params: { message: 'hi' }, position: { x: 140, y: 100 } });
    expect(pasted.instanceId).not.toBe(original);
    expect(onPasted).toHaveBeenCalledWith(pasted.instanceId);
    expect(announce).toHaveBeenLastCalledWith('Pasted "Report"');
  });

  it('moves a cut block to another file, under its lowest block, as one undo step', () => {
    const store = makeStore();
    const source = addFile(store, 'Source');
    const target = addFile(store, 'Target');
    const original = addBlock(store, source);
    addBlock(store, target, { position: { x: 40, y: 200 } });
    const { hook, run } = setUp(store, source);

    run(actions => actions.handleCutBlock(original));
    hook.rerender({ currentFileId: target });
    const before = store.getState().canvas;
    run(actions => actions.handlePasteBlock());

    expect(blocksIn(store, source)).toEqual([]);
    expect(blocksIn(store, target)[1].position).toEqual({ x: 40, y: 200 + HEIGHT + 40 });

    act(() => void store.dispatch(undone()));
    expect(store.getState().canvas).toBe(before);
  });

  it('removes a cut block only on the first paste; later pastes are copies', () => {
    const store = makeStore();
    const source = addFile(store, 'Source');
    const target = addFile(store, 'Target');
    const original = addBlock(store, source);
    const kept = addBlock(store, source);
    const { hook, run } = setUp(store, source);

    run(actions => actions.handleCutBlock(original));
    hook.rerender({ currentFileId: target });
    run(actions => actions.handlePasteBlock());
    run(actions => actions.handlePasteBlock());

    expect(blocksIn(store, source).map(item => item.instanceId)).toEqual([kept]);
    expect(blocksIn(store, target)).toHaveLength(2);
    expect(store.getState().clipboard.mode).toBe('copy');
  });

  it('renames the names a pasted copy defines, but not those of a cut moved within its file', () => {
    const store = makeStore();
    const fileId = addFile(store);
    const copied = addBlock(store, fileId, variables(['port', 'port_copy']));
    const { run } = setUp(store, fileId);
    const names = () => blocksIn(store, fileId).map(item => item.entries?.map(entry => entry.params.variable_name));

    run(actions => actions.handleCopyBlock(copied));
    run(actions => actions.handlePasteBlock());
    expect(names()).toEqual([
      ['port', 'port_copy'],
      ['port_copy2', 'port_copy_copy']
    ]);

    run(actions => actions.handleCutBlock(copied));
    run(actions => actions.handlePasteBlock());
    expect(names()).toEqual([
      ['port_copy2', 'port_copy_copy'],
      ['port', 'port_copy']
    ]);
  });

  it('qualifies what the block refers to in its own file when pasted into another', () => {
    const store = makeStore();
    const source = addFile(store, 'Source');
    const target = addFile(store, 'Target');
    const namespace = fileOf(store, source)!.namespace;
    addBlock(store, source, {
      blockId: 'define-class',
      label: 'Classes',
      params: {},
      entries: [{ id: 'c1', params: { class_name: 'web_ready' } }]
    });
    const original = addBlock(store, source, {
      params: { message: 'Port $(vars.port)' },
      classRefs: [
        { id: 'r1', name: 'web_ready', negate: false },
        { id: 'r2', name: 'linux', negate: false }
      ]
    });
    const { hook, run } = setUp(store, source);

    run(actions => actions.handleCopyBlock(original));
    run(actions => actions.handlePasteBlock());
    expect(blocksIn(store, source)[2]).toMatchObject({ params: { message: 'Port $(vars.port)' }, classRefs: [{ name: 'web_ready' }, { name: 'linux' }] });

    hook.rerender({ currentFileId: target });
    run(actions => actions.handlePasteBlock());
    expect(blocksIn(store, target)[0]).toMatchObject({
      params: { message: `Port $(${namespace}:vars.port)` },
      classRefs: [{ name: `${namespace}:web_ready` }, { name: 'linux' }]
    });
  });

  it('pastes nothing from an empty clipboard', () => {
    const store = makeStore();
    const fileId = addFile(store);
    addBlock(store, fileId);
    const { onPasted, run } = setUp(store, fileId);
    const before = store.getState();

    run(actions => actions.handlePasteBlock());
    expect(store.getState()).toBe(before);
    expect(onPasted).not.toHaveBeenCalled();
  });
});
