import type { PolicyFile, PolicyFolder } from './types';

// Matches the filename length limit most filesystems enforce (255 bytes,
// rounded down here for a plain character count) — shared by files and
// folders, and by both create and rename.
export const MAX_NAME_LENGTH = 256;

// Files/folders eventually become real paths on disk (policy/<folder>/<name>.cf,
// per the cfbs integration plan in .claude/architecture-plan.md), so path
// separators and the extension dot can't be part of a name — everything else
// a real filesystem tolerates is left alone.
const FORBIDDEN_CHARS = /[/\\:.]/g;

export function sanitizeFileSystemName(name: string): string {
  return name.replace(FORBIDDEN_CHARS, '').trim().slice(0, MAX_NAME_LENGTH);
}

// Uniqueness is scoped to same-kind siblings in the same folder (a file
// "Common.cf" and a folder "Common" don't collide on a real filesystem, so
// neither do they here) — appends " 2", " 3", ... until the name is free,
// mirroring the "Policy 1"/"Policy 2" convention this app already used for
// "+ New" before folders existed. Case-insensitive, as macOS/Windows filesystems are.
export function uniqueSiblingName(existingNames: string[], desired: string): string {
  const taken = new Set(existingNames.map(name => name.toLowerCase()));
  if (!taken.has(desired.toLowerCase())) return desired;
  let suffix = 2;
  while (taken.has(`${desired} ${suffix}`.toLowerCase())) suffix += 1;
  return `${desired} ${suffix}`;
}

export interface FolderDescendants {
  fileIds: string[];
  folderIds: string[];
}

// Every file and folder nested (at any depth) under folderId — used both to
// preview a folder deletion's impact (confirm-dialog message) and to know
// which files' blocks need cleaning up in canvasSlice when the delete is
// confirmed (this slice doesn't know about blocks, same convention as the
// existing single-file fileRemoved).
export function collectFolderDescendants(files: PolicyFile[], folders: PolicyFolder[], folderId: string): FolderDescendants {
  const childFolderIds = folders.filter(folder => folder.parentId === folderId).map(folder => folder.id);
  const nested = childFolderIds.map(childId => collectFolderDescendants(files, folders, childId));
  const directFileIds = files.filter(file => file.parentId === folderId).map(file => file.id);
  return {
    fileIds: [...directFileIds, ...nested.flatMap(descendants => descendants.fileIds)],
    folderIds: [...childFolderIds, ...nested.flatMap(descendants => descendants.folderIds)]
  };
}

export type FileTreeNode =
  { children: FileTreeNode[]; id: string; kind: 'folder'; name: string } | { file: PolicyFile; id: string; kind: 'file'; name: string };

// Folders first, then files, each group alphabetized — the conventional
// file-explorer sort (matches VSCode's default Explorer ordering).
function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function buildFileTree(files: PolicyFile[], folders: PolicyFolder[], parentId: string | null = null): FileTreeNode[] {
  const childFolders: FileTreeNode[] = folders
    .filter(folder => folder.parentId === parentId)
    .map(folder => ({ id: folder.id, kind: 'folder', name: folder.name, children: buildFileTree(files, folders, folder.id) }));
  const childFiles: FileTreeNode[] = files.filter(file => file.parentId === parentId).map(file => ({ id: file.id, kind: 'file', name: file.name, file }));
  return sortNodes([...childFolders, ...childFiles]);
}
