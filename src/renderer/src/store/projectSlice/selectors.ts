import type { RootState } from '..';

export const selectCurrentProject = (state: RootState) => state.project;
