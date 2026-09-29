import {
  BINDING_TARGET_PREFIX,
  blockGroupChanged,
  blockParamChanged,
  blockRemoved,
  blocksRemovedForFile,
  conditionClassNameChanged,
  conditionEnabled,
  conditionModeChanged,
  conditionRemoved,
  conditionSet,
  dataChainRemoved,
  decoratorAdded,
  decoratorMoved,
  decoratorRemoved,
  entryAdded,
  entryMoved,
  entryRemoved,
  paramBound,
  paramUnbound
} from '.';
import { groupCreated, groupRemoved } from '../groupsSlice';
import { projectCreated } from '../projectSlice';
import { addBlock, addFile, blockOf, makeStore } from '../test/storeTestUtils';
import type { ParamBinding } from './types';

function setup() {
  const store = makeStore();
  const fileId = addFile(store);
  return { store, fileId, instanceId: addBlock(store, fileId) };
}

function setupDefineVariable() {
  const store = makeStore();
  const fileId = addFile(store);
  const instanceId = addBlock(store, fileId, {
    blockId: 'define-variable',
    params: {},
    entries: [{ id: 'e1', params: { variable_name: 'first', value: '' }, valueSourceId: 'literal' }]
  });
  return { store, fileId, instanceId };
}

const entriesOf = (store: ReturnType<typeof makeStore>, instanceId: string) => blockOf(store, instanceId)?.entries ?? [];
const decoratorIdsOf = (store: ReturnType<typeof makeStore>, instanceId: string, entryId?: string) => {
  const block = blockOf(store, instanceId);
  const subject = entryId ? block?.entries?.find(entry => entry.id === entryId) : block;
  return (subject?.decorators ?? []).map(decorator => decorator.decoratorId);
};

describe('canvasSlice', () => {
  describe('blocks', () => {
    it('adds a block with a fresh instance id', () => {
      const { store, fileId, instanceId } = setup();
      const second = addBlock(store, fileId);
      expect(second).not.toBe(instanceId);
      expect(store.getState().canvas.map(block => block.instanceId)).toEqual([instanceId, second]);
    });

    it('removes only the given block', () => {
      const { store, fileId, instanceId } = setup();
      const other = addBlock(store, fileId);
      store.dispatch(blockRemoved({ instanceId }));
      expect(store.getState().canvas.map(block => block.instanceId)).toEqual([other]);
    });

    it('removes every block of a file, and only that file', () => {
      const { store, fileId, instanceId } = setup();
      const otherFile = addFile(store, 'Other');
      const survivor = addBlock(store, otherFile);
      addBlock(store, fileId);
      store.dispatch(blocksRemovedForFile({ fileId }));
      expect(blockOf(store, instanceId)).toBeUndefined();
      expect(store.getState().canvas.map(block => block.instanceId)).toEqual([survivor]);
    });

    it('resets when a project is created', () => {
      const { store } = setup();
      store.dispatch(projectCreated({ name: 'New' }));
      expect(store.getState().canvas).toEqual([]);
    });
  });

  describe('entries', () => {
    it('adds, moves and removes entries', () => {
      const { store, instanceId } = setupDefineVariable();
      store.dispatch(entryAdded({ instanceId, entry: { id: 'e2', params: { variable_name: 'second' } } }));
      store.dispatch(entryAdded({ instanceId, entry: { id: 'e3', params: { variable_name: 'third' } } }));
      store.dispatch(entryMoved({ instanceId, fromIndex: 2, toIndex: 0 }));
      expect(entriesOf(store, instanceId).map(entry => entry.id)).toEqual(['e3', 'e1', 'e2']);
      store.dispatch(entryRemoved({ instanceId, entryId: 'e1' }));
      expect(entriesOf(store, instanceId).map(entry => entry.id)).toEqual(['e3', 'e2']);
    });

    it('never removes the last entry', () => {
      const { store, instanceId } = setupDefineVariable();
      store.dispatch(entryRemoved({ instanceId, entryId: 'e1' }));
      expect(entriesOf(store, instanceId).map(entry => entry.id)).toEqual(['e1']);
    });

    it('ignores a move past either end', () => {
      const { store, instanceId } = setupDefineVariable();
      store.dispatch(entryAdded({ instanceId, entry: { id: 'e2', params: {} } }));
      store.dispatch(entryMoved({ instanceId, fromIndex: 0, toIndex: -1 }));
      store.dispatch(entryMoved({ instanceId, fromIndex: 1, toIndex: 2 }));
      expect(entriesOf(store, instanceId).map(entry => entry.id)).toEqual(['e1', 'e2']);
    });
  });

  describe('decorators', () => {
    it('adds a decorator with its parameter defaults', () => {
      const { store, instanceId } = setupDefineVariable();
      store.dispatch(decoratorAdded(instanceId, 'string-head', 'e1'));
      expect(entriesOf(store, instanceId)[0].decorators).toEqual([{ id: expect.any(String), decoratorId: 'string-head', params: { length: '9' } }]);
    });

    it('moves and removes decorators', () => {
      const { store, instanceId } = setupDefineVariable();
      for (const id of ['string-trim', 'string-head', 'string-downcase']) store.dispatch(decoratorAdded(instanceId, id, 'e1'));
      store.dispatch(decoratorMoved({ instanceId, entryId: 'e1', fromIndex: 0, toIndex: 2 }));
      expect(decoratorIdsOf(store, instanceId, 'e1')).toEqual(['string-head', 'string-downcase', 'string-trim']);

      const headId = entriesOf(store, instanceId)[0].decorators![0].id;
      store.dispatch(decoratorRemoved({ instanceId, entryId: 'e1', decoratorInstanceId: headId }));
      expect(decoratorIdsOf(store, instanceId, 'e1')).toEqual(['string-downcase', 'string-trim']);
    });

    it('targets a data-fed parameter through the binding prefix', () => {
      const { store, instanceId } = setup();
      store.dispatch(paramBound({ instanceId, param: 'message', binding: { valueSourceId: 'file-content', params: {} } }));
      store.dispatch(decoratorAdded(instanceId, 'string-trim', `${BINDING_TARGET_PREFIX}message`));
      expect(blockOf(store, instanceId)?.paramBindings?.message.decorators?.map(decorator => decorator.decoratorId)).toEqual(['string-trim']);
      expect(blockOf(store, instanceId)?.decorators).toBeUndefined();
    });

    it('ignores a move past either end, like entryMoved', () => {
      const { store, instanceId } = setupDefineVariable();
      for (const id of ['string-trim', 'string-head', 'string-downcase']) store.dispatch(decoratorAdded(instanceId, id, 'e1'));
      store.dispatch(decoratorMoved({ instanceId, entryId: 'e1', fromIndex: 0, toIndex: -1 }));
      expect(decoratorIdsOf(store, instanceId, 'e1')).toEqual(['string-trim', 'string-head', 'string-downcase']);
    });
  });

  describe('param bindings and data chains', () => {
    const binding: ParamBinding = { valueSourceId: 'file-content', params: { path: '/etc/motd' } };

    it('binds and unbinds a parameter, keeping its typed text', () => {
      const { store, instanceId } = setup();
      store.dispatch(paramBound({ instanceId, param: 'message', binding }));
      expect(blockOf(store, instanceId)?.paramBindings?.message).toEqual(binding);

      store.dispatch(paramUnbound({ instanceId, param: 'message' }));
      expect(blockOf(store, instanceId)?.paramBindings?.message).toBeUndefined();
      expect(blockOf(store, instanceId)?.params.message).toBe('hi');
    });

    it('edits a binding’s params through the binding prefix', () => {
      const { store, instanceId } = setup();
      store.dispatch(paramBound({ instanceId, param: 'message', binding }));
      store.dispatch(blockParamChanged({ instanceId, entryId: `${BINDING_TARGET_PREFIX}message`, paramName: 'path', value: '/etc/issue' }));
      expect(blockOf(store, instanceId)?.paramBindings?.message.params.path).toBe('/etc/issue');
      expect(blockOf(store, instanceId)?.params.path).toBeUndefined();
    });

    it('drops a parameter’s binding when its chain is removed', () => {
      const { store, instanceId } = setup();
      store.dispatch(paramBound({ instanceId, param: 'message', binding }));
      store.dispatch(dataChainRemoved({ instanceId, entryId: `${BINDING_TARGET_PREFIX}message` }));
      expect(blockOf(store, instanceId)?.paramBindings?.message).toBeUndefined();
      expect(blockOf(store, instanceId)?.params.message).toBe('hi');
    });

    it('turns a computed entry back into a literal, clearing its steps but keeping its params', () => {
      const { store, instanceId } = setupDefineVariable();
      store.dispatch(entryAdded({ instanceId, entry: { id: 'e2', params: { variable_name: 'motd', path: '/etc/motd' }, valueSourceId: 'file-content' } }));
      store.dispatch(decoratorAdded(instanceId, 'string-trim', 'e2'));
      store.dispatch(dataChainRemoved({ instanceId, entryId: 'e2' }));
      expect(entriesOf(store, instanceId)[1]).toMatchObject({
        valueSourceId: 'literal',
        decorators: [],
        params: { variable_name: 'motd', path: '/etc/motd' }
      });
    });
  });

  describe('conditions', () => {
    it('enables, changes and removes a block condition', () => {
      const { store, instanceId } = setup();
      store.dispatch(conditionEnabled({ instanceId }));
      expect(blockOf(store, instanceId)?.condition).toEqual({ mode: 'if', kind: 'class', className: '' });

      store.dispatch(conditionModeChanged({ instanceId, mode: 'unless' }));
      store.dispatch(conditionClassNameChanged({ instanceId, className: 'linux' }));
      expect(blockOf(store, instanceId)?.condition).toEqual({ mode: 'unless', kind: 'class', className: 'linux' });

      store.dispatch(conditionRemoved({ instanceId }));
      expect(blockOf(store, instanceId)?.condition).toBeUndefined();
    });

    it('gates a single entry without touching the block', () => {
      const { store, instanceId } = setupDefineVariable();
      store.dispatch(conditionEnabled({ instanceId, entryId: 'e1' }));
      store.dispatch(conditionClassNameChanged({ instanceId, entryId: 'e1', className: 'debian' }));
      expect(entriesOf(store, instanceId)[0].condition).toEqual({ mode: 'if', kind: 'class', className: 'debian' });
      expect(blockOf(store, instanceId)?.condition).toBeUndefined();
    });

    it('ignores mode and class-name edits when no condition is set', () => {
      const { store, instanceId } = setup();
      store.dispatch(conditionModeChanged({ instanceId, mode: 'unless' }));
      store.dispatch(conditionClassNameChanged({ instanceId, className: 'linux' }));
      expect(blockOf(store, instanceId)?.condition).toBeUndefined();
    });

    it('replaces the condition wholesale on conditionSet', () => {
      const { store, instanceId } = setup();
      store.dispatch(conditionEnabled({ instanceId }));
      store.dispatch(conditionSet({ instanceId, condition: { mode: 'unless', kind: 'class', className: 'windows' } }));
      expect(blockOf(store, instanceId)?.condition).toEqual({ mode: 'unless', kind: 'class', className: 'windows' });
    });
  });

  describe('groups', () => {
    it('sets groupId on the new group’s members only', () => {
      const { store, fileId, instanceId } = setup();
      const outsider = addBlock(store, fileId);
      const groupId = store.dispatch(groupCreated({ color: 'info', fileId, instanceIds: [instanceId], name: 'G' })).payload.id;
      expect(blockOf(store, instanceId)?.groupId).toBe(groupId);
      expect(blockOf(store, outsider)?.groupId).toBeUndefined();
    });

    it('clears groupId from the removed group’s members only', () => {
      const { store, fileId, instanceId } = setup();
      const other = addBlock(store, fileId);
      const removed = store.dispatch(groupCreated({ color: 'info', fileId, instanceIds: [instanceId], name: 'A' })).payload.id;
      const kept = store.dispatch(groupCreated({ color: 'error', fileId, instanceIds: [other], name: 'B' })).payload.id;
      store.dispatch(groupRemoved({ groupId: removed }));
      expect(blockOf(store, instanceId)).toBeDefined();
      expect(blockOf(store, instanceId)?.groupId).toBeUndefined();
      expect(blockOf(store, other)?.groupId).toBe(kept);
    });

    it('joins and leaves a group', () => {
      const { store, instanceId } = setup();
      store.dispatch(blockGroupChanged({ instanceIds: [instanceId], groupId: 'g1' }));
      expect(blockOf(store, instanceId)?.groupId).toBe('g1');
      store.dispatch(blockGroupChanged({ instanceIds: [instanceId], groupId: null }));
      expect(blockOf(store, instanceId)).not.toHaveProperty('groupId');
    });
  });
});
