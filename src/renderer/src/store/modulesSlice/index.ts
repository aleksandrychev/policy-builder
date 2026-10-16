import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import { projectCreated, projectLoaded } from '../projectSlice';

/** A CFEngine Build module in the project, in build order; a dependency names the module it came with. */
export interface ProjectModule {
  addedBy?: string;
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
    modulesRemoved: (state, action: PayloadAction<string[]>) => state.filter(module => !action.payload.includes(module.name))
  },
  extraReducers: builder => {
    builder.addCase(projectCreated, () => []).addCase(projectLoaded, () => []);
  }
});

export const { modulesAdded, modulesRemoved } = modulesSlice.actions;
export default modulesSlice.reducer;
