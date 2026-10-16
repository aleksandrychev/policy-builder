import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import { projectCreated, projectLoaded } from '../projectSlice';

// An input question's answer: text, a list of texts, or a list's rows (field key → text).
export type ModuleInputResponse = Record<string, string>[] | string[] | string;

/** A CFEngine Build module in the project, in build order; a dependency names the module it came with. */
export interface ProjectModule {
  addedBy?: string;
  // Its input questions' answers, by variable (saved as <name>/input.json).
  input?: Record<string, ModuleInputResponse>;
  name: string;
  version?: string;
}

const modulesSlice = createSlice({
  name: 'modules',
  initialState: [] as ProjectModule[],
  reducers: {
    // A module and the dependencies it brings, at the end of the build.
    modulesAdded: (state, action: PayloadAction<ProjectModule[]>) => {
      const present = new Set(state.map(module => module.name));
      state.push(...action.payload.filter(module => !present.has(module.name)));
    },
    modulesRemoved: (state, action: PayloadAction<string[]>) => state.filter(module => !action.payload.includes(module.name)),
    moduleInputChanged: (state, action: PayloadAction<{ name: string; response: ModuleInputResponse; variable: string }>) => {
      const module = state.find(candidate => candidate.name === action.payload.name);
      if (module) module.input = { ...module.input, [action.payload.variable]: action.payload.response };
    }
  },
  extraReducers: builder => {
    builder.addCase(projectCreated, () => []).addCase(projectLoaded, (_state, action) => action.payload.content.modules ?? []);
  }
});

export const { moduleInputChanged, modulesAdded, modulesRemoved } = modulesSlice.actions;
export default modulesSlice.reducer;
