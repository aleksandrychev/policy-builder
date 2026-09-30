import { createSelector } from '@reduxjs/toolkit';

import type { RootState } from '..';

export const selectGroups = (state: RootState) => state.groups;

export const selectGroupsForFile = createSelector([selectGroups, (_state: RootState, fileId: string | null) => fileId], (groups, fileId) =>
  fileId ? groups.filter(group => group.fileId === fileId) : []
);
