import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import { projectCreated, projectLoaded } from '../projectSlice';

/** A module project's own fields for the CFEngine Build index (its input is its Module Input blocks). */
export interface ThisModuleState {
  // The index entry's author (`by`), e.g. https://github.com/someone.
  by: string;
  version: string;
}

export const emptyThisModule = (): ThisModuleState => ({ by: '', version: '' });

const thisModuleSlice = createSlice({
  name: 'thisModule',
  initialState: emptyThisModule(),
  reducers: {
    moduleVersionChanged: (state, action: PayloadAction<{ value: string }>) => {
      state.version = action.payload.value;
    },
    moduleAuthorChanged: (state, action: PayloadAction<{ value: string }>) => {
      state.by = action.payload.value;
    }
  },
  extraReducers: builder => {
    builder.addCase(projectCreated, emptyThisModule).addCase(projectLoaded, (_state, action) => action.payload.content.thisModule ?? emptyThisModule());
  }
});

export const { moduleAuthorChanged, moduleVersionChanged } = thisModuleSlice.actions;
export default thisModuleSlice.reducer;
