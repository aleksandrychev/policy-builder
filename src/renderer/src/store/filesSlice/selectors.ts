import type { RootState } from '..';

export const selectFiles = (state: RootState) => state.files.files;

export const selectFolders = (state: RootState) => state.files.folders;

export const selectCurrentFileId = (state: RootState) => state.files.currentFileId;

export const selectCurrentFile = (state: RootState) => {
  const { files, currentFileId } = state.files;
  return files.find(file => file.id === currentFileId);
};
