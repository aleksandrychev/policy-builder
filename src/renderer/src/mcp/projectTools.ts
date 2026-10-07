import { DEFAULT_DESCRIPTION, type ProjectFormValues } from '../components/dialogs/NewProjectDialog';
import { projectFolderName } from '../project/cfbsProject';
import type { RootState } from '../store';
import { blocksRemovedForFile } from '../store/canvasSlice';
import type { Condition } from '../store/canvasSlice/types';
import {
  fileAdded,
  fileConditionClassNameChanged,
  fileConditionEnabled,
  fileConditionModeChanged,
  fileConditionRemoved,
  fileDescriptionChanged,
  fileRemoved,
  fileRenamed,
  folderAdded
} from '../store/filesSlice';
import { sanitizeFileSystemName } from '../store/filesSlice/fileTree';
import { groupBlocks, ungroupBlocks } from '../store/groupArrows';
import { groupConditionClassNameChanged, groupConditionEnabled, groupConditionModeChanged, groupConditionRemoved } from '../store/groupsSlice';
import { GROUP_COLORS } from '../store/groupsSlice/types';
import { inOneStep } from '../store/history';
import { type CanvasEnv, type Input, type Tool, type ToolEnv, ToolError, canvasOf, optionalStr, str } from './shared';

/** The project's life cycle, its files and folders, and groups (src/main/mcpTools/project.ts names them). */

const FALLBACK_MASTERFILES = '3.27.1';
const isAbsolute = (path: string) => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path);

function desktopApi() {
  if (!window.api) throw new ToolError('This needs the Policy Builder desktop app');
  return window.api;
}

function fileOf(state: RootState, fileId: string) {
  const file = state.files.files.find(item => item.id === fileId);
  if (!file) throw new ToolError(`No file ${fileId}; get_project_overview lists them`);
  return file;
}

function groupOf(state: RootState, groupId: string) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group) throw new ToolError(`No group ${groupId}; get_file lists a file’s groups`);
  return group;
}

function folderIdOf(state: RootState, input: Input, key: string): string | null {
  const folderId = optionalStr(input, key);
  if (!folderId) return null;
  if (!state.files.folders.some(folder => folder.id === folderId)) throw new ToolError(`No folder ${folderId}`);
  return folderId;
}

// A condition argument: a class expression and mode, or null to remove it.
function conditionOf(input: Input): Condition | null {
  const condition = input.condition as { className?: unknown; mode?: unknown } | null | undefined;
  if (condition === null) return null;
  if (!condition || typeof condition.className !== 'string' || !condition.className.trim() || (condition.mode !== 'if' && condition.mode !== 'unless')) {
    throw new ToolError('condition needs a className and a mode of if or unless, or null to remove it');
  }
  return { kind: 'class', className: condition.className.trim(), mode: condition.mode };
}

function rejectUnsaved(env: ToolEnv, input: Input) {
  if (env.session.dirty && input.discardChanges !== true) {
    throw new ToolError('The open project has unsaved changes. Save them with save_project, or pass discardChanges: true to drop them (ask the user first).');
  }
}

const failure = (result: { details?: string; message?: string }) =>
  new ToolError([result.message || 'It failed', result.details?.trim().slice(-2000)].filter(Boolean).join('\n'));

// Where a project folder would go: refused like the New Project dialog refuses it.
async function checkTarget(parent: string, folderName: string) {
  if (!isAbsolute(parent)) throw new ToolError('parent must be an absolute path');
  if (!folderName) throw new ToolError('The name needs at least one letter or digit');
  const check = await desktopApi().checkProjectTarget(parent, folderName);
  if (!check.parentWritable) throw new ToolError(`Can’t create a folder in ${parent}; choose another parent`);
  if (check.targetState === 'nonEmpty') throw new ToolError(`${folderName} already exists in ${parent} and isn’t empty; choose another name or parent`);
}

async function latestMasterfiles() {
  try {
    return (await desktopApi().getMasterfilesVersions()).latest;
  } catch {
    return FALLBACK_MASTERFILES;
  }
}

function projectStatus(env: ToolEnv) {
  const state = env.getState();
  const { project } = state;
  if (!project) return { open: false };
  return {
    open: true,
    name: project.name,
    path: project.path,
    type: project.type,
    masterfiles: project.masterfiles,
    unsavedChanges: env.session.dirty,
    files: state.files.files.length,
    folders: state.files.folders.length
  };
}

async function createProject(env: ToolEnv, input: Input) {
  rejectUnsaved(env, input);
  const name = str(input, 'name').trim();
  const parent = str(input, 'parent');
  const folderName = projectFolderName(name);
  await checkTarget(parent, folderName);
  const type = input.type === 'module' ? 'module' : 'policy-set';
  const masterfiles = type === 'module' ? 'no' : input.masterfiles === 'master' ? 'master' : await latestMasterfiles();
  const values: ProjectFormValues = {
    name,
    description: optionalStr(input, 'description')?.trim() || DEFAULT_DESCRIPTION,
    parent,
    folderName,
    masterfiles,
    git: input.git !== false,
    type
  };
  const result = await env.session.create(values);
  if (!result.ok) throw failure(result);
  const project = env.getState().project;
  return { path: project?.path ?? null, name, type, masterfiles: project?.masterfiles ?? null, fileId: env.getState().files.files[0]?.id };
}

async function openProject(env: ToolEnv, input: Input) {
  rejectUnsaved(env, input);
  const path = str(input, 'path');
  if (!isAbsolute(path)) throw new ToolError('path must be an absolute path');
  desktopApi();
  const failure = await env.session.open(path);
  if (failure) throw new ToolError(failure);
  const project = env.getState().project;
  if (!project) throw new ToolError(`Couldn’t open ${path}. Is it a project folder with a cfbs.json?`);
  return { path: project.path, name: project.name, type: project.type, files: env.getState().files.files.length };
}

async function saveProject(env: ToolEnv, input: Input) {
  const project = env.getState().project;
  if (!project) throw new ToolError('No project is open in Policy Builder; open or create one first');
  if (project.path) {
    const failure = await env.session.save();
    if (failure) throw new ToolError(failure);
    return { path: project.path, saved: true };
  }
  const parent = optionalStr(input, 'parent');
  if (!parent) throw new ToolError('This project was never saved: give parent, the folder to create it in');
  const name = optionalStr(input, 'name')?.trim() || project.name;
  const folderName = optionalStr(input, 'folderName')?.trim() || projectFolderName(name);
  await checkTarget(parent, folderName);
  const result = await env.session.saveAs({
    name,
    description: project.description.trim() || DEFAULT_DESCRIPTION,
    parent,
    folderName,
    masterfiles: project.type === 'module' ? 'no' : await latestMasterfiles(),
    git: input.git !== false,
    type: project.type
  });
  if (!result.ok) throw failure(result);
  return { path: env.getState().project?.path ?? null, saved: true };
}

function addFile(env: CanvasEnv, input: Input) {
  const name = str(input, 'name');
  if (!sanitizeFileSystemName(name)) throw new ToolError('That name has no usable characters');
  const parentId = folderIdOf(env.getState(), input, 'folderId');
  let fileId = '';
  inOneStep(env.dispatch, () => {
    fileId = env.dispatch(fileAdded(name, parentId)).payload.id;
  });
  env.openFile(fileId);
  const file = fileOf(env.getState(), fileId);
  return { id: file.id, name: file.name, namespace: file.namespace };
}

function renameFile(env: CanvasEnv, input: Input) {
  const file = fileOf(env.getState(), str(input, 'fileId'));
  const name = str(input, 'name');
  if (!sanitizeFileSystemName(name)) throw new ToolError('That name has no usable characters');
  inOneStep(env.dispatch, () => env.dispatch(fileRenamed({ fileId: file.id, name })));
  env.openFile(file.id);
  return { id: file.id, name: fileOf(env.getState(), file.id).name, namespace: file.namespace };
}

// As the file tree's delete: the file, its blocks, arrows and groups, in one step.
function removeFile(env: CanvasEnv, input: Input) {
  const state = env.getState();
  const file = fileOf(state, str(input, 'fileId'));
  if (state.files.files.length < 2) throw new ToolError('A project keeps at least one policy file; add another before removing this one');
  const blocks = state.canvas.filter(block => block.fileId === file.id).length;
  inOneStep(env.dispatch, () => {
    env.dispatch(fileRemoved({ fileId: file.id }));
    env.dispatch(blocksRemovedForFile({ fileId: file.id }));
  });
  return { removed: file.id, name: file.name, blocksRemoved: blocks };
}

function addFolder(env: CanvasEnv, input: Input) {
  const name = str(input, 'name');
  if (!sanitizeFileSystemName(name)) throw new ToolError('That name has no usable characters');
  const parentId = folderIdOf(env.getState(), input, 'parentId');
  let folderId = '';
  inOneStep(env.dispatch, () => {
    folderId = env.dispatch(folderAdded(name, parentId)).payload.id;
  });
  const folder = env.getState().files.folders.find(item => item.id === folderId);
  return { id: folderId, name: folder?.name };
}

function setFileDescription(env: CanvasEnv, input: Input) {
  const file = fileOf(env.getState(), str(input, 'fileId'));
  if (typeof input.description !== 'string') throw new ToolError('description is required (empty removes it)');
  const description = input.description;
  inOneStep(env.dispatch, () => env.dispatch(fileDescriptionChanged({ fileId: file.id, description })));
  env.openFile(file.id);
  return { id: file.id, description: description.trim() || null };
}

function setFileCondition(env: CanvasEnv, input: Input) {
  const file = fileOf(env.getState(), str(input, 'fileId'));
  const condition = conditionOf(input);
  const fileId = file.id;
  inOneStep(env.dispatch, () => {
    if (!condition) return void env.dispatch(fileConditionRemoved({ fileId }));
    env.dispatch(fileConditionEnabled({ fileId }));
    env.dispatch(fileConditionModeChanged({ fileId, mode: condition.mode }));
    env.dispatch(fileConditionClassNameChanged({ fileId, className: condition.className }));
  });
  env.openFile(fileId);
  return { id: fileId, condition: condition ? `${condition.mode} ${condition.className}` : null };
}

function groupTheBlocks(env: CanvasEnv, input: Input) {
  const state = env.getState();
  const ids = Array.isArray(input.blockIds) ? [...new Set(input.blockIds.filter((id): id is string => typeof id === 'string'))] : [];
  if (!ids.length) throw new ToolError('blockIds needs at least one block id');
  const blocks = ids.map(id => {
    const block = state.canvas.find(item => item.instanceId === id);
    if (!block) throw new ToolError(`No block ${id}`);
    return block;
  });
  const fileId = blocks[0].fileId;
  if (blocks.some(block => block.fileId !== fileId)) throw new ToolError('A group holds blocks of one file');
  // Named like the canvas names them: the first free "Group <n>" among the file's shown groups.
  const live = new Set(
    state.groups.filter(group => group.fileId === fileId && state.canvas.some(block => block.groupId === group.id)).map(group => group.name)
  );
  let number = 1;
  while (live.has(`Group ${number}`)) number += 1;
  const name = optionalStr(input, 'name')?.trim() || `Group ${number}`;
  const color = GROUP_COLORS[(number - 1) % GROUP_COLORS.length];
  env.openFile(fileId);
  const groupId = env.dispatch(groupBlocks({ fileId, instanceIds: ids, name, color }));
  if (!groupId)
    throw new ToolError(
      'Can’t group these blocks: their arrows, re-attached to the group, would make a loop. Group the blocks between them too, or disconnect first.'
    );
  return { id: groupId, name, fileId, blocks: ids.length };
}

function ungroup(env: CanvasEnv, input: Input) {
  const group = groupOf(env.getState(), str(input, 'groupId'));
  env.openFile(group.fileId);
  env.dispatch(ungroupBlocks(group.fileId, group.id));
  return { ungrouped: group.id, name: group.name };
}

function setGroupCondition(env: CanvasEnv, input: Input) {
  const group = groupOf(env.getState(), str(input, 'groupId'));
  const condition = conditionOf(input);
  const groupId = group.id;
  env.openFile(group.fileId);
  inOneStep(env.dispatch, () => {
    if (!condition) return void env.dispatch(groupConditionRemoved({ groupId }));
    env.dispatch(groupConditionEnabled({ groupId }));
    env.dispatch(groupConditionModeChanged({ groupId, mode: condition.mode }));
    env.dispatch(groupConditionClassNameChanged({ groupId, className: condition.className }));
  });
  return { id: groupId, condition: condition ? `${condition.mode} ${condition.className}` : null };
}

export const PROJECT_TOOLS: Record<string, Tool> = {
  get_project_status: env => projectStatus(env),
  create_project: createProject,
  open_project: openProject,
  save_project: saveProject,
  add_file: (env, input) => addFile(canvasOf(env), input),
  rename_file: (env, input) => renameFile(canvasOf(env), input),
  remove_file: (env, input) => removeFile(canvasOf(env), input),
  add_folder: (env, input) => addFolder(canvasOf(env), input),
  set_file_description: (env, input) => setFileDescription(canvasOf(env), input),
  set_file_condition: (env, input) => setFileCondition(canvasOf(env), input),
  group_blocks: (env, input) => groupTheBlocks(canvasOf(env), input),
  ungroup: (env, input) => ungroup(canvasOf(env), input),
  set_group_condition: (env, input) => setGroupCondition(canvasOf(env), input)
};
