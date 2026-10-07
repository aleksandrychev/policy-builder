import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import { moduleNameFor } from '../../project/moduleName';
import type { Project, ProjectContentState, ProjectType } from './types';

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
      prepare({ description = '', masterfiles = null, moduleName, name, path = null, type = 'policy-set' }: NewProject) {
        return { payload: { description, id: crypto.randomUUID(), masterfiles, moduleName: moduleName ?? moduleNameFor(name), name, path, type } };
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
    projectLocated(state, action: PayloadAction<Pick<Project, 'description' | 'masterfiles' | 'moduleName' | 'name' | 'path' | 'type'>>) {
      if (state) Object.assign(state, action.payload);
    },
    // Project Settings: stored as a policy set or a module from now on (the next save rewrites cfbs.json).
    projectTypeChanged(state, action: PayloadAction<{ masterfiles?: string | null; type: ProjectType }>) {
      if (!state) return;
      state.type = action.payload.type;
      if (action.payload.masterfiles !== undefined) state.masterfiles = action.payload.masterfiles;
    }
  }
});

export const { projectCreated, projectLoaded, projectLocated, projectTypeChanged } = projectSlice.actions;
export default projectSlice.reducer;
