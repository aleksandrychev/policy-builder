import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import { decoratorsById } from '../../blocks/decorators';
import { blockDescriptorsById } from '../../blocks/loadBlocks';
import { groupCreated, groupRemoved } from '../groupsSlice/actions';
import { projectCreated } from '../projectSlice';
import type { BlockInstance, ClassReference, Condition, DecoratorInstance, DefinitionEntry, EditableSubject, ParamBinding } from './types';

// Field-level edits target the instance itself, one of its entries
// (`entryId`, multi-entry blocks like Define Variable), or one of its data-fed
// parameters (`entryId` = BINDING_TARGET_PREFIX + param name). All three have
// the EditableSubject shape, so one set of reducers serves them all.
export const BINDING_TARGET_PREFIX = 'param:';

interface SubjectRef {
  entryId?: string;
  instanceId: string;
}

function findSubject(state: BlockInstance[], { instanceId, entryId }: SubjectRef): EditableSubject | undefined {
  const instance = state.find(item => item.instanceId === instanceId);
  if (!instance) return undefined;
  if (entryId?.startsWith(BINDING_TARGET_PREFIX)) return instance.paramBindings?.[entryId.slice(BINDING_TARGET_PREFIX.length)];
  return entryId ? instance.entries?.find(entry => entry.id === entryId) : instance;
}

const canvasSlice = createSlice({
  name: 'canvas',
  initialState: [] as BlockInstance[],
  reducers: {
    blockAdded: {
      reducer(state, action: PayloadAction<BlockInstance>) {
        state.push(action.payload);
      },
      prepare(instance: Omit<BlockInstance, 'instanceId'>) {
        return { payload: { ...instance, instanceId: crypto.randomUUID() } };
      }
    },
    blockRemoved(state, action: PayloadAction<{ instanceId: string }>) {
      return state.filter(instance => instance.instanceId !== action.payload.instanceId);
    },
    // Deleting a file has nothing sensible to leave behind for its blocks —
    // they're only ever addressed via fileId, so an orphaned instance would
    // just be dead weight in the array.
    blocksRemovedForFile(state, action: PayloadAction<{ fileId: string }>) {
      return state.filter(instance => instance.fileId !== action.payload.fileId);
    },
    blockMoved(state, action: PayloadAction<{ instanceId: string; position: { x: number; y: number } }>) {
      const instance = state.find(item => item.instanceId === action.payload.instanceId);
      if (instance) instance.position = action.payload.position;
    },
    // Bulk variant for auto-layout ("Tidy up").
    blocksMoved(state, action: PayloadAction<{ positions: Record<string, { x: number; y: number }> }>) {
      for (const instance of state) {
        const position = action.payload.positions[instance.instanceId];
        if (position) instance.position = position;
      }
    },
    // Join a group (groupId) or leave one (null).
    blockGroupChanged(state, action: PayloadAction<{ groupId: string | null; instanceIds: string[] }>) {
      for (const instance of state) {
        if (!action.payload.instanceIds.includes(instance.instanceId)) continue;
        if (action.payload.groupId) instance.groupId = action.payload.groupId;
        else delete instance.groupId;
      }
    },
    incomingModeChanged(state, action: PayloadAction<{ instanceId: string; mode: 'all' | 'any' }>) {
      const instance = state.find(item => item.instanceId === action.payload.instanceId);
      if (instance) instance.incomingMode = action.payload.mode;
    },
    blockLabelChanged(state, action: PayloadAction<{ instanceId: string; label: string }>) {
      const instance = state.find(item => item.instanceId === action.payload.instanceId);
      if (instance) instance.label = action.payload.label;
    },
    blockParamChanged(state, action: PayloadAction<SubjectRef & { paramName: string; value: string }>) {
      const subject = findSubject(state, action.payload);
      if (subject) subject.params[action.payload.paramName] = action.payload.value;
    },
    // Old params for the previously-selected source are left in place rather
    // than cleared: harmless (only the active source's params get read/
    // rendered), and it means flipping back restores what was there before.
    blockValueSourceChanged(state, action: PayloadAction<SubjectRef & { valueSourceId: string }>) {
      const subject = findSubject(state, action.payload);
      if (subject) subject.valueSourceId = action.payload.valueSourceId;
    },
    // Starts computing `param` from data (a value source + steps).
    paramBound(state, action: PayloadAction<{ binding: ParamBinding; instanceId: string; param: string }>) {
      const instance = state.find(item => item.instanceId === action.payload.instanceId);
      if (instance) (instance.paramBindings ??= {})[action.payload.param] = action.payload.binding;
    },
    // Back to a typed value; the old text in params is still there.
    paramUnbound(state, action: PayloadAction<{ instanceId: string; param: string }>) {
      const instance = state.find(item => item.instanceId === action.payload.instanceId);
      if (instance?.paramBindings) delete instance.paramBindings[action.payload.param];
    },
    // Drops a data chain: a data-fed parameter goes back to its typed value, a
    // computed variable to a literal (steps cleared, old params kept).
    dataChainRemoved(state, action: PayloadAction<SubjectRef & { entryId: string }>) {
      const { instanceId, entryId } = action.payload;
      const instance = state.find(item => item.instanceId === instanceId);
      if (!instance) return;
      if (entryId.startsWith(BINDING_TARGET_PREFIX)) {
        if (instance.paramBindings) delete instance.paramBindings[entryId.slice(BINDING_TARGET_PREFIX.length)];
        return;
      }
      const entry = instance.entries?.find(item => item.id === entryId);
      if (!entry) return;
      const sources = blockDescriptorsById.get(instance.blockId)?.value_sources ?? [];
      entry.valueSourceId = sources.find(source => source.literal && source.value_type === 'string')?.id ?? entry.valueSourceId;
      entry.decorators = [];
    },
    sampleInputChanged(state, action: PayloadAction<SubjectRef & { value: string }>) {
      const subject = findSubject(state, action.payload);
      if (subject) subject.sampleInput = action.payload.value;
    },
    entryAdded(state, action: PayloadAction<{ entry: DefinitionEntry; instanceId: string }>) {
      const instance = state.find(item => item.instanceId === action.payload.instanceId);
      if (instance) (instance.entries ??= []).push(action.payload.entry);
    },
    // A multi-entry block always keeps at least one entry — removing the
    // last one is "delete the block", which the canvas card already offers.
    entryRemoved(state, action: PayloadAction<{ entryId: string; instanceId: string }>) {
      const instance = state.find(item => item.instanceId === action.payload.instanceId);
      if (!instance?.entries || instance.entries.length <= 1) return;
      instance.entries = instance.entries.filter(entry => entry.id !== action.payload.entryId);
    },
    entryMoved(state, action: PayloadAction<{ fromIndex: number; instanceId: string; toIndex: number }>) {
      const instance = state.find(item => item.instanceId === action.payload.instanceId);
      if (!instance?.entries) return;
      const { fromIndex, toIndex } = action.payload;
      if (toIndex < 0 || toIndex >= instance.entries.length) return;
      const [moved] = instance.entries.splice(fromIndex, 1);
      instance.entries.splice(toIndex, 0, moved);
    },
    decoratorAdded: {
      reducer(state, action: PayloadAction<SubjectRef & { decoratorInstance: DecoratorInstance }>) {
        const subject = findSubject(state, action.payload);
        if (subject) (subject.decorators ??= []).push(action.payload.decoratorInstance);
      },
      prepare(instanceId: string, decoratorId: string, entryId?: string) {
        const decorator = decoratorsById.get(decoratorId);
        const params = Object.fromEntries((decorator?.parameters ?? []).map(parameter => [parameter.name, String(parameter.default ?? '')]));
        return { payload: { instanceId, entryId, decoratorInstance: { id: crypto.randomUUID(), decoratorId, params } } };
      }
    },
    decoratorRemoved(state, action: PayloadAction<SubjectRef & { decoratorInstanceId: string }>) {
      const subject = findSubject(state, action.payload);
      if (subject?.decorators) subject.decorators = subject.decorators.filter(entry => entry.id !== action.payload.decoratorInstanceId);
    },
    decoratorParamChanged(state, action: PayloadAction<SubjectRef & { decoratorInstanceId: string; paramName: string; value: string }>) {
      const entry = findSubject(state, action.payload)?.decorators?.find(candidate => candidate.id === action.payload.decoratorInstanceId);
      if (entry) entry.params[action.payload.paramName] = action.payload.value;
    },
    decoratorMoved(state, action: PayloadAction<SubjectRef & { fromIndex: number; toIndex: number }>) {
      const subject = findSubject(state, action.payload);
      if (!subject?.decorators) return;
      const { fromIndex, toIndex } = action.payload;
      const [moved] = subject.decorators.splice(fromIndex, 1);
      subject.decorators.splice(toIndex, 0, moved);
    },
    classRefAdded: {
      reducer(state, action: PayloadAction<SubjectRef & { classRef: ClassReference }>) {
        const subject = findSubject(state, action.payload);
        if (subject) (subject.classRefs ??= []).push(action.payload.classRef);
      },
      prepare(instanceId: string, entryId?: string) {
        return { payload: { instanceId, entryId, classRef: { id: crypto.randomUUID(), name: '', negate: false } } };
      }
    },
    classRefRemoved(state, action: PayloadAction<SubjectRef & { classRefId: string }>) {
      const subject = findSubject(state, action.payload);
      if (subject?.classRefs) subject.classRefs = subject.classRefs.filter(entry => entry.id !== action.payload.classRefId);
    },
    classRefChanged(state, action: PayloadAction<SubjectRef & { classRefId: string; name?: string; negate?: boolean }>) {
      const entry = findSubject(state, action.payload)?.classRefs?.find(candidate => candidate.id === action.payload.classRefId);
      if (!entry) return;
      if (action.payload.name !== undefined) entry.name = action.payload.name;
      if (action.payload.negate !== undefined) entry.negate = action.payload.negate;
    },
    conditionEnabled(state, action: PayloadAction<SubjectRef>) {
      const subject = findSubject(state, action.payload);
      if (subject) subject.condition = { mode: 'if', kind: 'class', className: '' };
    },
    // Wholesale replace — linking a condition gate on the canvas to a block
    // gives it exactly that gate's condition (a block has at most one).
    conditionSet(state, action: PayloadAction<{ condition: Condition; instanceId: string }>) {
      const instance = state.find(item => item.instanceId === action.payload.instanceId);
      if (instance) instance.condition = { ...action.payload.condition };
    },
    conditionRemoved(state, action: PayloadAction<SubjectRef>) {
      const subject = findSubject(state, action.payload);
      if (subject) subject.condition = undefined;
    },
    conditionModeChanged(state, action: PayloadAction<SubjectRef & { mode: 'if' | 'unless' }>) {
      const subject = findSubject(state, action.payload);
      if (subject?.condition) subject.condition.mode = action.payload.mode;
    },
    conditionClassNameChanged(state, action: PayloadAction<SubjectRef & { className: string }>) {
      const subject = findSubject(state, action.payload);
      if (!subject?.condition) return;
      subject.condition = { mode: subject.condition.mode, kind: 'class', className: action.payload.className };
    },
    inventoryEnabled(state, action: PayloadAction<SubjectRef>) {
      const subject = findSubject(state, action.payload);
      if (subject) subject.inventory = { attributeName: '' };
    },
    inventoryRemoved(state, action: PayloadAction<SubjectRef>) {
      const subject = findSubject(state, action.payload);
      if (subject) subject.inventory = undefined;
    },
    inventoryAttributeNameChanged(state, action: PayloadAction<SubjectRef & { attributeName: string }>) {
      const subject = findSubject(state, action.payload);
      if (subject?.inventory) subject.inventory.attributeName = action.payload.attributeName;
    }
  },
  extraReducers: builder => {
    builder
      .addCase(projectCreated, () => [])
      .addCase(groupCreated, (state, action) => {
        for (const instance of state) if (action.payload.instanceIds.includes(instance.instanceId)) instance.groupId = action.payload.id;
      })
      .addCase(groupRemoved, (state, action) => {
        for (const instance of state) if (instance.groupId === action.payload.groupId) delete instance.groupId;
      });
  }
});

export const {
  blockAdded,
  blockRemoved,
  blocksRemovedForFile,
  blockMoved,
  blocksMoved,
  incomingModeChanged,
  blockLabelChanged,
  blockParamChanged,
  blockValueSourceChanged,
  paramBound,
  paramUnbound,
  dataChainRemoved,
  sampleInputChanged,
  entryAdded,
  entryRemoved,
  entryMoved,
  decoratorAdded,
  decoratorRemoved,
  decoratorParamChanged,
  decoratorMoved,
  classRefAdded,
  classRefRemoved,
  classRefChanged,
  conditionEnabled,
  conditionSet,
  conditionRemoved,
  conditionModeChanged,
  conditionClassNameChanged,
  inventoryEnabled,
  inventoryRemoved,
  inventoryAttributeNameChanged,
  blockGroupChanged
} = canvasSlice.actions;
export default canvasSlice.reducer;
