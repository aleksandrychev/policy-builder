import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import type { BlockInstance } from '../canvasSlice/types';
import { projectCreated, projectLoaded } from '../projectSlice';
import type { ClipboardState } from './types';

const initialState: ClipboardState = { mode: null, snapshot: null };

const clipboardSlice = createSlice({
  name: 'clipboard',
  initialState,
  reducers: {
    // structuredClone, not a spread — BlockInstance nests classRefs/
    // decorators/condition/inventory, and the snapshot must be independent
    // of any later edit to the original before it's pasted.
    clipboardCopied(state, action: PayloadAction<{ instance: BlockInstance }>) {
      state.mode = 'copy';
      state.snapshot = structuredClone(action.payload.instance);
    },
    clipboardCut(state, action: PayloadAction<{ instance: BlockInstance }>) {
      state.mode = 'cut';
      state.snapshot = structuredClone(action.payload.instance);
    },
    // The first paste of a cut removes the source and calls the cut done —
    // this keeps the same snapshot around so further Ctrl+V still pastes
    // (as a copy, no further removal), rather than clearing the clipboard.
    clipboardDowngradedToCopy(state) {
      if (state.mode === 'cut') state.mode = 'copy';
    },
    clipboardCleared(state) {
      state.mode = null;
      state.snapshot = null;
    }
  },
  extraReducers: builder => {
    builder.addCase(projectCreated, () => initialState).addCase(projectLoaded, () => initialState);
  }
});

export const { clipboardCopied, clipboardCut, clipboardDowngradedToCopy, clipboardCleared } = clipboardSlice.actions;
export default clipboardSlice.reducer;
