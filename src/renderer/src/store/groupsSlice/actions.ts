import { createAction } from '@reduxjs/toolkit';

import type { GroupColor } from './types';

// Shared by groupsSlice (the records) and canvasSlice (members' `groupId`),
// so neither slice imports the other.
export const groupCreated = createAction('groups/groupCreated', (group: { color: GroupColor; fileId: string; instanceIds: string[]; name: string }) => ({
  payload: { ...group, id: crypto.randomUUID() }
}));
// Ungroup: the frame goes, its blocks stay.
export const groupRemoved = createAction<{ groupId: string }>('groups/groupRemoved');
