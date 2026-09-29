import { createAppStore } from '..';
import { blockAdded } from '../canvasSlice';
import type { BlockInstance } from '../canvasSlice/types';
import { fileAdded } from '../filesSlice';
import { undone } from '../history';

// Shared helpers for the store's tests: a real store, built the way the app builds it.
export type TestStore = ReturnType<typeof createAppStore>;

export const makeStore = (): TestStore => createAppStore();

export const addFile = (store: TestStore, name = 'Main', parentId: string | null = null) => store.dispatch(fileAdded(name, parentId)).payload.id;

export const addBlock = (store: TestStore, fileId: string, overrides: Partial<Omit<BlockInstance, 'instanceId'>> = {}) =>
  store.dispatch(blockAdded({ blockId: 'report-message', fileId, label: 'Report', params: { message: 'hi' }, ...overrides })).payload.instanceId;

export const blockOf = (store: TestStore, instanceId: string) => store.getState().canvas.find(block => block.instanceId === instanceId);

export const fileOf = (store: TestStore, fileId: string) => store.getState().files.files.find(file => file.id === fileId);

// Undoes until nothing changes; returns how many steps there were.
export function undoAll(store: TestStore): number {
  let steps = 0;
  for (;;) {
    const before = store.getState();
    store.dispatch(undone());
    if (store.getState() === before) return steps;
    steps += 1;
  }
}
