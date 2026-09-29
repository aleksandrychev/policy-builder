import { type Action, type Dispatch, type Reducer, type UnknownAction, createAction } from '@reduxjs/toolkit';

export const undone = createAction('history/undone');
export const redone = createAction('history/redone');
// Everything dispatched between these two is one undo step (a drag, a batch delete, Tidy up…).
export const historyBatchStarted = createAction('history/batchStarted');
export const historyBatchEnded = createAction('history/batchEnded');
// Dispatched once a project is fully set up, so its creation isn't itself undoable.
export const historyCleared = createAction('history/cleared');

// Several dispatches that undo as one step; nests, and ends the batch even if `run` throws.
export function inOneStep(dispatch: Dispatch, run: () => void) {
  dispatch(historyBatchStarted());
  try {
    run();
  } finally {
    dispatch(historyBatchEnded());
  }
}

const LIMIT = 100;
const UNDOABLE_KEYS = ['canvas', 'derivedNodes', 'edges', 'files', 'groups'] as const;
type UndoableKey = (typeof UNDOABLE_KEYS)[number];

// Text edits dispatch per keystroke: consecutive ones to the same field merge
// into one step. The value is the payload field being typed into.
const TYPING_FIELDS: Record<string, string> = {
  'canvas/blockLabelChanged': 'label',
  'canvas/blockParamChanged': 'value',
  'canvas/classRefChanged': 'name',
  'canvas/conditionClassNameChanged': 'className',
  'canvas/decoratorParamChanged': 'value',
  'canvas/inventoryAttributeNameChanged': 'attributeName',
  'canvas/sampleInputChanged': 'value',
  'files/fileConditionClassNameChanged': 'className',
  'groups/groupRenamed': 'name'
};
// Change undoable state without being worth a step of their own.
const UNTRACKED = new Set(['files/fileSelected']);

export interface HistoryState<Snapshot> {
  // Open batches (they nest); > 0 while batching.
  batching: number;
  batchPushed: boolean;
  future: Snapshot[];
  mergeKey: string | null;
  past: Snapshot[];
}

type WithHistory<S> = S & { history: HistoryState<Pick<S, UndoableKey & keyof S>> };

const emptyHistory = <Snapshot>(): HistoryState<Snapshot> => ({ batchPushed: false, batching: 0, future: [], mergeKey: null, past: [] });

function mergeKeyOf(action: UnknownAction): string | null {
  const field = TYPING_FIELDS[action.type];
  const payload = action.payload as Record<string, unknown> | undefined;
  if (!field || !payload || !(field in payload)) return null;
  const { [field]: _typed, ...target } = payload;
  return `${action.type}${JSON.stringify(target)}`;
}

/**
 * Undo/redo over the project's content slices. Redux state is immutable, so
 * a step is just the previous slice references — no per-action inverse logic.
 */
export function withHistory<S extends Record<UndoableKey, unknown>>(reducer: Reducer<S>): Reducer<WithHistory<S>> {
  type Snapshot = Pick<S, UndoableKey>;
  const snapshot = (state: S): Snapshot => Object.fromEntries(UNDOABLE_KEYS.map(key => [key, state[key]])) as Snapshot;

  // Undo/redo: swap the present with the nearest snapshot on the other side.
  const travel = (present: S, history: HistoryState<Snapshot>, back: boolean): WithHistory<S> | undefined => {
    const target = back ? history.past.at(-1) : history.future[0];
    if (!target) return undefined;
    const past = back ? history.past.slice(0, -1) : [...history.past, snapshot(present)];
    const future = back ? [snapshot(present), ...history.future] : history.future.slice(1);
    return { ...present, ...target, history: { ...emptyHistory<Snapshot>(), past, future } };
  };

  // Whether a change starts a new step, or joins the batch / typing run in progress.
  const record = (present: S, next: S, history: HistoryState<Snapshot>, action: UnknownAction): WithHistory<S> => {
    const push = (patch: Partial<HistoryState<Snapshot>>) => ({
      ...next,
      history: { ...history, ...patch, past: [...history.past, snapshot(present)].slice(-LIMIT), future: [] }
    });
    if (history.batching > 0) return history.batchPushed ? { ...next, history } : push({ batchPushed: true });
    const mergeKey = mergeKeyOf(action);
    if (mergeKey && mergeKey === history.mergeKey) return { ...next, history };
    return push({ mergeKey });
  };

  return (state: WithHistory<S> | undefined, action: Action) => {
    const { history = emptyHistory<Snapshot>(), ...rest } = state ?? {};
    const present = (state ? rest : undefined) as S | undefined;

    // Not mid-batch (e.g. during a drag): the batch would keep writing over what was undone.
    if (present && (undone.match(action) || redone.match(action))) {
      return (history.batching === 0 && travel(present, history, undone.match(action))) || (state as WithHistory<S>);
    }
    if (historyCleared.match(action)) return { ...(present as S), history: emptyHistory<Snapshot>() };
    if (historyBatchStarted.match(action)) {
      const outermost = history.batching === 0;
      return {
        ...(present as S),
        history: { ...history, batching: history.batching + 1, batchPushed: outermost ? false : history.batchPushed, mergeKey: null }
      };
    }
    if (historyBatchEnded.match(action)) return { ...(present as S), history: { ...history, batching: Math.max(0, history.batching - 1), mergeKey: null } };

    const next = reducer(present, action as UnknownAction);
    const changed = present !== undefined && UNDOABLE_KEYS.some(key => next[key] !== present[key]);
    if (!present || !changed || UNTRACKED.has(action.type)) return { ...next, history };
    return record(present, next, history, action as UnknownAction);
  };
}
