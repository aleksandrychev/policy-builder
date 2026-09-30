import { createSelector } from '@reduxjs/toolkit';

import type { RootState } from '..';

export const selectCanvasBlocks = (state: RootState) => state.canvas;

// Memoized: returns the same array while nothing changed, so components
// using it don't re-render on every unrelated store update (block dragging
// dispatches a position change per frame).
export const selectBlocksForFile = createSelector([selectCanvasBlocks, (_state: RootState, fileId: string | null) => fileId], (blocks, fileId) =>
  fileId ? blocks.filter(instance => instance.fileId === fileId) : []
);
