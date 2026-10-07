import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import { projectLoaded } from '../projectSlice';
import { deriveNamespace } from './deriveNamespace';
import { collectFolderDescendants, sanitizeFileSystemName, uniqueSiblingName } from './fileTree';
import type { PolicyFile, PolicyFolder } from './types';

interface FilesState {
  currentFileId: string | null;
  files: PolicyFile[];
  folders: PolicyFolder[];
}

const initialState: FilesState = { files: [], folders: [], currentFileId: null };

const DEFAULT_NAME = 'Untitled';

function siblingFileNames(state: FilesState, parentId: string | null, excludeId?: string): string[] {
  return state.files.filter(file => file.parentId === parentId && file.id !== excludeId).map(file => file.name);
}

function siblingFolderNames(state: FilesState, parentId: string | null, excludeId?: string): string[] {
  return state.folders.filter(folder => folder.parentId === parentId && folder.id !== excludeId).map(folder => folder.name);
}

const filesSlice = createSlice({
  name: 'files',
  initialState,
  reducers: {
    // Replaces the whole file list: called once, when a project is created,
    // so a previous project's files can't leak into the new one.
    projectFilesInitialized: {
      reducer(_state, action: PayloadAction<{ id: string; name: string; taken: string[] }>) {
        const name = sanitizeFileSystemName(action.payload.name) || DEFAULT_NAME;
        const file: PolicyFile = { id: action.payload.id, name, namespace: deriveNamespace(name, action.payload.taken), parentId: null };
        return { files: [file], folders: [], currentFileId: file.id };
      },
      // `taken`: names the file's namespace (and so its ./<namespace>.cf) must not have.
      prepare(name: string, taken: string[] = []) {
        return { payload: { id: crypto.randomUUID(), name, taken } };
      }
    },
    fileAdded: {
      reducer(state, action: PayloadAction<{ id: string; name: string; parentId: string | null }>) {
        const sanitized = sanitizeFileSystemName(action.payload.name) || DEFAULT_NAME;
        const name = uniqueSiblingName(siblingFileNames(state, action.payload.parentId), sanitized);
        const file: PolicyFile = {
          id: action.payload.id,
          name,
          namespace: deriveNamespace(
            name,
            state.files.map(item => item.namespace)
          ),
          parentId: action.payload.parentId
        };
        state.files.push(file);
        state.currentFileId = file.id;
      },
      prepare(name: string, parentId: string | null = null) {
        return { payload: { id: crypto.randomUUID(), name, parentId } };
      }
    },
    folderAdded: {
      reducer(state, action: PayloadAction<{ id: string; name: string; parentId: string | null }>) {
        const sanitized = sanitizeFileSystemName(action.payload.name) || DEFAULT_NAME;
        const name = uniqueSiblingName(siblingFolderNames(state, action.payload.parentId), sanitized);
        state.folders.push({ id: action.payload.id, name, parentId: action.payload.parentId });
      },
      prepare(name: string, parentId: string | null = null) {
        return { payload: { id: crypto.randomUUID(), name, parentId } };
      }
    },
    fileConditionEnabled(state, action: PayloadAction<{ fileId: string }>) {
      const file = state.files.find(item => item.id === action.payload.fileId);
      if (file && !file.condition) file.condition = { kind: 'class', mode: 'if', className: '' };
    },
    fileConditionRemoved(state, action: PayloadAction<{ fileId: string }>) {
      const file = state.files.find(item => item.id === action.payload.fileId);
      if (file) delete file.condition;
    },
    fileConditionModeChanged(state, action: PayloadAction<{ fileId: string; mode: 'if' | 'unless' }>) {
      const file = state.files.find(item => item.id === action.payload.fileId);
      if (file?.condition) file.condition.mode = action.payload.mode;
    },
    fileConditionClassNameChanged(state, action: PayloadAction<{ className: string; fileId: string }>) {
      const file = state.files.find(item => item.id === action.payload.fileId);
      if (file?.condition) file.condition.className = action.payload.className;
    },
    fileDescriptionChanged(state, action: PayloadAction<{ description: string; fileId: string }>) {
      const file = state.files.find(item => item.id === action.payload.fileId);
      if (!file) return;
      if (action.payload.description.trim()) file.description = action.payload.description;
      else delete file.description;
    },
    fileSelected(state, action: PayloadAction<{ fileId: string }>) {
      state.currentFileId = action.payload.fileId;
    },
    // Renaming never touches the namespace — see the field comment in types.ts.
    fileRenamed(state, action: PayloadAction<{ fileId: string; name: string }>) {
      const file = state.files.find(item => item.id === action.payload.fileId);
      if (!file) return;
      const sanitized = sanitizeFileSystemName(action.payload.name);
      if (!sanitized) return;
      file.name = uniqueSiblingName(siblingFileNames(state, file.parentId, file.id), sanitized);
    },
    folderRenamed(state, action: PayloadAction<{ folderId: string; name: string }>) {
      const folder = state.folders.find(item => item.id === action.payload.folderId);
      if (!folder) return;
      const sanitized = sanitizeFileSystemName(action.payload.name);
      if (!sanitized) return;
      folder.name = uniqueSiblingName(siblingFolderNames(state, folder.parentId, folder.id), sanitized);
    },
    // The caller is responsible for also dispatching
    // canvasSlice's blocksRemovedForFile — this slice doesn't know about blocks.
    fileRemoved(state, action: PayloadAction<{ fileId: string }>) {
      state.files = state.files.filter(file => file.id !== action.payload.fileId);
      if (state.currentFileId === action.payload.fileId) {
        state.currentFileId = state.files[0]?.id ?? null;
      }
    },
    // Recursive: removes the folder and everything nested under it (sub-
    // folders and files, at any depth). As with fileRemoved, the caller must
    // also dispatch blocksRemovedForFile for every removed file id — use
    // collectFolderDescendants (fileTree.ts) beforehand to know which.
    folderRemoved(state, action: PayloadAction<{ folderId: string }>) {
      const { fileIds, folderIds } = collectFolderDescendants(state.files, state.folders, action.payload.folderId);
      const removedFolderIds = new Set([action.payload.folderId, ...folderIds]);
      const removedFileIds = new Set(fileIds);
      state.folders = state.folders.filter(folder => !removedFolderIds.has(folder.id));
      state.files = state.files.filter(file => !removedFileIds.has(file.id));
      if (state.currentFileId && removedFileIds.has(state.currentFileId)) {
        state.currentFileId = state.files[0]?.id ?? null;
      }
    }
  },
  extraReducers: builder => {
    builder.addCase(projectLoaded, (_state, action) => action.payload.content.files);
  }
});

export const {
  projectFilesInitialized,
  fileAdded,
  folderAdded,
  fileConditionEnabled,
  fileConditionRemoved,
  fileConditionModeChanged,
  fileConditionClassNameChanged,
  fileDescriptionChanged,
  fileSelected,
  fileRenamed,
  folderRenamed,
  fileRemoved,
  folderRemoved
} = filesSlice.actions;
export default filesSlice.reducer;
