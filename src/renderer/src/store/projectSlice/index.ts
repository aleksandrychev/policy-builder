import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import type { Project } from './types';

const projectSlice = createSlice({
  name: 'project',
  initialState: null as Project | null,
  reducers: {
    // Every content slice resets on this, so nothing from a previous project survives.
    projectCreated: {
      reducer(_state, action: PayloadAction<Project>) {
        return action.payload;
      },
      prepare(project: Omit<Project, 'id'>) {
        return { payload: { ...project, id: crypto.randomUUID() } };
      }
    }
  }
});

export const { projectCreated } = projectSlice.actions;
export default projectSlice.reducer;
