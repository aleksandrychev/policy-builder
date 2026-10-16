import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import { projectCreated, projectLoaded } from '../projectSlice';

/** Advice the project ignores (canvas/advice.ts keys, e.g. "python3"): saved with it, undoable. */
const dismissedAdviceSlice = createSlice({
  name: 'dismissedAdvice',
  initialState: [] as string[],
  reducers: {
    adviceDismissed: (state, action: PayloadAction<string>) => (state.includes(action.payload) ? state : [...state, action.payload])
  },
  extraReducers: builder => {
    builder.addCase(projectCreated, () => []).addCase(projectLoaded, (_state, action) => action.payload.content.dismissedAdvice ?? []);
  }
});

export const { adviceDismissed } = dismissedAdviceSlice.actions;
export default dismissedAdviceSlice.reducer;
