import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import { blocksRemovedForFile } from '../canvasSlice';
import { projectCreated, projectLoaded } from '../projectSlice';
import { groupCreated, groupRemoved } from './actions';
import type { BlockGroup, GroupColor } from './types';

const groupsSlice = createSlice({
  name: 'groups',
  initialState: [] as BlockGroup[],
  reducers: {
    groupRenamed(state, action: PayloadAction<{ groupId: string; name: string }>) {
      const group = state.find(item => item.id === action.payload.groupId);
      if (group) group.name = action.payload.name;
    },
    groupFrameResized(state, action: PayloadAction<{ groupId: string; rect: BlockGroup['rect'] }>) {
      const group = state.find(item => item.id === action.payload.groupId);
      if (group) group.rect = action.payload.rect;
    },
    // Back to hugging the members (Tidy up; "Fit to blocks").
    groupFramesFitted(state, action: PayloadAction<{ groupIds: string[] }>) {
      for (const group of state) if (action.payload.groupIds.includes(group.id)) delete group.rect;
    },
    groupColorChanged(state, action: PayloadAction<{ color: GroupColor; groupId: string }>) {
      const group = state.find(item => item.id === action.payload.groupId);
      if (group) group.color = action.payload.color;
    }
  },
  extraReducers: builder => {
    builder
      .addCase(projectCreated, () => [])
      .addCase(projectLoaded, (_state, action) => action.payload.content.groups)
      .addCase(groupCreated, (state, action) => {
        const { color, fileId, id, name } = action.payload;
        state.push({ color, fileId, id, name });
      })
      .addCase(groupRemoved, (state, action) => state.filter(group => group.id !== action.payload.groupId))
      .addCase(blocksRemovedForFile, (state, action) => state.filter(group => group.fileId !== action.payload.fileId));
  }
});

export { groupCreated, groupRemoved };
export const { groupRenamed, groupColorChanged, groupFrameResized, groupFramesFitted } = groupsSlice.actions;
export default groupsSlice.reducer;
