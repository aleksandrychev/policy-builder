import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import type { Project, ProjectContentState } from './types';

type NewProject = Pick<Project, 'name'> & Partial<Omit<Project, 'id' | 'name'>>;

const projectSlice = createSlice({
  name: 'project',
  initialState: null as Project | null,
  reducers: {
    // Every content slice resets on this, so nothing from a previous project survives.
    projectCreated: {
      reducer(_state, action: PayloadAction<Project>) {
        return action.payload;
      },
      prepare({ description = '', masterfiles = null, name, path = null }: NewProject) {
        return { payload: { description, id: crypto.randomUUID(), masterfiles, name, path } };
      }
    },
    // An existing project opened from disk: every content slice takes its part of `content`.
    projectLoaded: {
      reducer(_state, action: PayloadAction<{ content: ProjectContentState; project: Project }>) {
        return action.payload.project;
      },
      prepare(project: Omit<Project, 'id'>, content: ProjectContentState) {
        return { payload: { content, project: { ...project, id: crypto.randomUUID() } } };
      }
    },
    // An in-memory project got its folder on disk ("Save Project As"); content stays as is.
    projectLocated(state, action: PayloadAction<Pick<Project, 'description' | 'masterfiles' | 'name' | 'path'>>) {
      if (state) Object.assign(state, action.payload);
    }
  }
});

export const { projectCreated, projectLoaded, projectLocated } = projectSlice.actions;
export default projectSlice.reducer;
