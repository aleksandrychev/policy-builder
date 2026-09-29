import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import { blockRemoved, blocksRemovedForFile } from '../canvasSlice';
import { projectCreated } from '../projectSlice';
import type { BlockEdge, BlockOutcome } from './types';

const edgesSlice = createSlice({
  name: 'edges',
  initialState: [] as BlockEdge[],
  reducers: {
    edgeAdded: {
      reducer(state, action: PayloadAction<BlockEdge>) {
        const { source, target } = action.payload;
        if (state.some(edge => edge.source === source && edge.target === target)) return;
        state.push(action.payload);
      },
      prepare(edge: Omit<BlockEdge, 'id'>) {
        return { payload: { ...edge, id: crypto.randomUUID() } };
      }
    },
    edgeRemoved(state, action: PayloadAction<{ edgeId: string }>) {
      return state.filter(edge => edge.id !== action.payload.edgeId);
    },
    edgeOutcomesChanged(state, action: PayloadAction<{ edgeId: string; outcomes: BlockOutcome[] }>) {
      const edge = state.find(item => item.id === action.payload.edgeId);
      if (edge && action.payload.outcomes.length > 0) edge.outcomes = action.payload.outcomes;
    }
  },
  // An arrow can't outlive either end, so removing a block (or a file's
  // blocks) takes its arrows with it — callers never need to remember.
  extraReducers: builder => {
    builder
      .addCase(projectCreated, () => [])
      .addCase(blockRemoved, (state, action) => state.filter(edge => edge.source !== action.payload.instanceId && edge.target !== action.payload.instanceId))
      .addCase(blocksRemovedForFile, (state, action) => state.filter(edge => edge.fileId !== action.payload.fileId));
  }
});

export const { edgeAdded, edgeRemoved, edgeOutcomesChanged } = edgesSlice.actions;
export default edgesSlice.reducer;
