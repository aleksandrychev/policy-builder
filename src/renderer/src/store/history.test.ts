import { blockLabelChanged, blockMoved, blockParamChanged } from './canvasSlice';
import { clipboardCopied } from './clipboardSlice';
import { fileSelected } from './filesSlice';
import { groupCreated, groupRenamed } from './groupsSlice';
import { historyBatchEnded, historyBatchStarted, historyCleared, inOneStep, redone, undone } from './history';
import { type TestStore, addBlock, addFile, blockOf, makeStore, undoAll } from './test/storeTestUtils';

function setup() {
  const store = makeStore();
  const fileId = addFile(store);
  const instanceId = addBlock(store, fileId, { label: 'Start' });
  store.dispatch(historyCleared());
  return { store, fileId, instanceId };
}

const moveTo = (store: TestStore, instanceId: string, x: number) => store.dispatch(blockMoved({ instanceId, position: { x, y: 0 } }));

describe('history', () => {
  describe('undo / redo', () => {
    it('makes each tracked action one undo step', () => {
      const { store, instanceId } = setup();
      moveTo(store, instanceId, 1);
      moveTo(store, instanceId, 2);
      expect(undoAll(store)).toBe(2);
      expect(blockOf(store, instanceId)?.position).toBeUndefined();
    });

    it('restores the previous slice references on undo, and the undone ones on redo', () => {
      const { store, instanceId } = setup();
      const before = store.getState();
      moveTo(store, instanceId, 1);
      const after = store.getState();

      store.dispatch(undone());
      expect(store.getState().canvas).toBe(before.canvas);
      expect(store.getState().files).toBe(before.files);

      store.dispatch(redone());
      expect(store.getState().canvas).toBe(after.canvas);
    });

    it('leaves state untouched when there is nothing to undo or redo', () => {
      const { store } = setup();
      const before = store.getState();
      store.dispatch(undone());
      store.dispatch(redone());
      expect(store.getState()).toBe(before);
    });

    it('clears redo once a new change is made', () => {
      const { store, instanceId } = setup();
      moveTo(store, instanceId, 1);
      store.dispatch(undone());
      moveTo(store, instanceId, 5);
      const afterNewChange = store.getState();
      store.dispatch(redone());
      expect(store.getState()).toBe(afterNewChange);
      expect(blockOf(store, instanceId)?.position).toEqual({ x: 5, y: 0 });
    });

    it('does not record an action that changes nothing', () => {
      const { store } = setup();
      moveTo(store, 'no-such-block', 1);
      expect(undoAll(store)).toBe(0);
    });

    it('leaves non-undoable slices (clipboard) alone', () => {
      const { store, instanceId } = setup();
      moveTo(store, instanceId, 1);
      store.dispatch(clipboardCopied({ instance: blockOf(store, instanceId)! }));
      store.dispatch(undone());
      expect(store.getState().clipboard.mode).toBe('copy');
      expect(blockOf(store, instanceId)?.position).toBeUndefined();
    });

    it('does not make selecting a file its own step', () => {
      const store = makeStore();
      const first = addFile(store, 'First');
      addFile(store, 'Second');
      store.dispatch(fileSelected({ fileId: first }));
      expect(store.getState().files.currentFileId).toBe(first);
      expect(undoAll(store)).toBe(2);
    });

    it('keeps at most 100 steps', () => {
      const { store, instanceId } = setup();
      for (let x = 1; x <= 105; x += 1) moveTo(store, instanceId, x);
      expect(undoAll(store)).toBe(100);
      expect(blockOf(store, instanceId)?.position).toEqual({ x: 5, y: 0 });
    });
  });

  describe('typing merges', () => {
    const typeLabel = (store: TestStore, instanceId: string, text: string) => {
      for (let length = 1; length <= text.length; length += 1) store.dispatch(blockLabelChanged({ instanceId, label: text.slice(0, length) }));
    };

    it('merges consecutive edits to the same field into one step', () => {
      const { store, instanceId } = setup();
      typeLabel(store, instanceId, 'Hello');
      expect(blockOf(store, instanceId)?.label).toBe('Hello');
      store.dispatch(undone());
      expect(blockOf(store, instanceId)?.label).toBe('Start');
      expect(undoAll(store)).toBe(0);
    });

    it('does not merge edits to a different block', () => {
      const { store, fileId, instanceId } = setup();
      const other = addBlock(store, fileId);
      store.dispatch(historyCleared());
      typeLabel(store, instanceId, 'ab');
      typeLabel(store, other, 'cd');
      expect(undoAll(store)).toBe(2);
    });

    it('does not merge edits to a different parameter of the same block', () => {
      const { store, instanceId } = setup();
      store.dispatch(blockParamChanged({ instanceId, paramName: 'message', value: 'a' }));
      store.dispatch(blockParamChanged({ instanceId, paramName: 'message', value: 'ab' }));
      store.dispatch(blockParamChanged({ instanceId, paramName: 'run_interval', value: '5' }));
      expect(undoAll(store)).toBe(2);
    });

    it('does not merge edits to a different entry', () => {
      const { store, fileId } = setup();
      const entries = [
        { id: 'e1', params: { variable_name: 'a' } },
        { id: 'e2', params: { variable_name: 'b' } }
      ];
      const instanceId = addBlock(store, fileId, { blockId: 'define-variable', entries, params: {} });
      store.dispatch(historyCleared());
      const edit = (entryId: string, value: string) => store.dispatch(blockParamChanged({ instanceId, entryId, paramName: 'variable_name', value }));
      edit('e1', 'ax');
      edit('e1', 'axy');
      edit('e2', 'bx');
      expect(undoAll(store)).toBe(2);
    });

    it('starts a new step when typing resumes after another action', () => {
      const { store, instanceId } = setup();
      typeLabel(store, instanceId, 'ab');
      moveTo(store, instanceId, 1);
      typeLabel(store, instanceId, 'abc');
      expect(undoAll(store)).toBe(3);
    });

    it('starts a new step when typing resumes after an undo', () => {
      const { store, instanceId } = setup();
      typeLabel(store, instanceId, 'ab');
      store.dispatch(undone());
      typeLabel(store, instanceId, 'cd');
      store.dispatch(undone());
      expect(blockOf(store, instanceId)?.label).toBe('Start');
    });

    it('merges group renames', () => {
      const { store, fileId, instanceId } = setup();
      const groupId = store.dispatch(groupCreated({ color: 'info', fileId, instanceIds: [instanceId], name: 'G' })).payload.id;
      for (const name of ['W', 'We', 'Web']) store.dispatch(groupRenamed({ groupId, name }));
      store.dispatch(undone());
      expect(store.getState().groups[0].name).toBe('G');
    });
  });

  describe('batches', () => {
    it('makes everything between batch start and end one step', () => {
      const { store, instanceId } = setup();
      store.dispatch(historyBatchStarted());
      moveTo(store, instanceId, 1);
      moveTo(store, instanceId, 2);
      store.dispatch(blockLabelChanged({ instanceId, label: 'Dragged' }));
      store.dispatch(historyBatchEnded());
      expect(undoAll(store)).toBe(1);
      expect(blockOf(store, instanceId)?.label).toBe('Start');
      expect(blockOf(store, instanceId)?.position).toBeUndefined();
    });

    it('makes an inOneStep run one step, nested runs included', () => {
      const { store, instanceId } = setup();
      inOneStep(store.dispatch, () => {
        moveTo(store, instanceId, 1);
        inOneStep(store.dispatch, () => moveTo(store, instanceId, 2));
        moveTo(store, instanceId, 3);
      });
      expect(blockOf(store, instanceId)?.position).toEqual({ x: 3, y: 0 });
      expect(undoAll(store)).toBe(1);
    });

    it('records nothing for an empty batch', () => {
      const { store } = setup();
      inOneStep(store.dispatch, () => {});
      expect(undoAll(store)).toBe(0);
    });

    it('closes the batch even if the run throws', () => {
      const { store, instanceId } = setup();
      expect(() =>
        inOneStep(store.dispatch, () => {
          moveTo(store, instanceId, 1);
          throw new Error('boom');
        })
      ).toThrow('boom');
      moveTo(store, instanceId, 2);
      expect(undoAll(store)).toBe(2);
    });

    it('ignores undo and redo while a batch is open', () => {
      const { store, instanceId } = setup();
      moveTo(store, instanceId, 1);
      store.dispatch(historyBatchStarted());
      moveTo(store, instanceId, 2);
      store.dispatch(undone());
      expect(blockOf(store, instanceId)?.position).toEqual({ x: 2, y: 0 });
      store.dispatch(historyBatchEnded());
      store.dispatch(undone());
      expect(blockOf(store, instanceId)?.position).toEqual({ x: 1, y: 0 });
    });

    it('does not merge typing across a batch boundary', () => {
      const { store, instanceId } = setup();
      store.dispatch(blockLabelChanged({ instanceId, label: 'a' }));
      inOneStep(store.dispatch, () => moveTo(store, instanceId, 1));
      store.dispatch(blockLabelChanged({ instanceId, label: 'ab' }));
      expect(undoAll(store)).toBe(3);
    });
  });

  describe('historyCleared', () => {
    it('empties both undo and redo', () => {
      const { store, instanceId } = setup();
      moveTo(store, instanceId, 1);
      moveTo(store, instanceId, 2);
      store.dispatch(undone());
      store.dispatch(historyCleared());
      const cleared = store.getState();
      store.dispatch(undone());
      store.dispatch(redone());
      expect(store.getState()).toBe(cleared);
      expect(blockOf(store, instanceId)?.position).toEqual({ x: 1, y: 0 });
    });
  });
});
