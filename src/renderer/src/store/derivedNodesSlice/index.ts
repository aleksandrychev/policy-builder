import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import { blockRemoved, blocksRemovedForFile, dataChainRemoved, entryRemoved } from '../canvasSlice';
import { projectCreated } from '../projectSlice';

type Position = { x: number; y: number };

/**
 * Where derived canvas nodes sit — condition gates (canvas/gates.ts) and
 * data-chain nodes (canvas/dataChains.ts) — keyed by `${fileId}|...`. Those
 * nodes are drawn from block data, so this only remembers positions the user
 * dragged one to; without an entry a node sits at its default spot beside
 * the block it belongs to.
 */
const derivedNodesSlice = createSlice({
  name: 'derivedNodes',
  initialState: {} as Record<string, Position>,
  reducers: {
    derivedNodeMoved(state, action: PayloadAction<{ key: string; position: Position }>) {
      state[action.payload.key] = action.payload.position;
    },
    derivedNodeForgotten(state, action: PayloadAction<{ key: string }>) {
      delete state[action.payload.key];
    },
    // Several at once — the pills and chain nodes travelling with a dragged group.
    derivedNodesMoved(state, action: PayloadAction<{ positions: Record<string, Position> }>) {
      Object.assign(state, action.payload.positions);
    },
    // After auto-layout moves the blocks, derived nodes go back beside them.
    derivedNodePositionsClearedForFile(state, action: PayloadAction<{ fileId: string }>) {
      for (const key of Object.keys(state)) if (key.startsWith(`${action.payload.fileId}|`)) delete state[key];
    }
  },
  extraReducers: builder => {
    // Chain keys are `${fileId}|data|${instanceId}|${entryId}` (canvas/dataChains.ts).
    const dropMatching = (state: Record<string, Position>, part: string) => {
      for (const key of Object.keys(state)) if (key.includes(part)) delete state[key];
    };
    builder
      .addCase(projectCreated, () => ({}))
      .addCase(blocksRemovedForFile, (state, action) => {
        for (const key of Object.keys(state)) if (key.startsWith(`${action.payload.fileId}|`)) delete state[key];
      })
      .addCase(blockRemoved, (state, action) => dropMatching(state, `|data|${action.payload.instanceId}|`))
      .addCase(entryRemoved, (state, action) => dropMatching(state, `|data|${action.payload.instanceId}|${action.payload.entryId}`))
      .addCase(dataChainRemoved, (state, action) => dropMatching(state, `|data|${action.payload.instanceId}|${action.payload.entryId}`));
  }
});

export const { derivedNodeMoved, derivedNodeForgotten, derivedNodesMoved, derivedNodePositionsClearedForFile } = derivedNodesSlice.actions;
export default derivedNodesSlice.reducer;
