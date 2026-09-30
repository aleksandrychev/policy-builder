import {
  fileConditionClassNameChanged,
  fileConditionEnabled,
  fileConditionModeChanged,
  fileConditionRemoved,
  fileRemoved,
  fileRenamed,
  fileSelected,
  folderAdded,
  folderRemoved,
  folderRenamed,
  projectFilesInitialized
} from '.';
import { projectCreated } from '../projectSlice';
import { addFile, fileOf, makeStore } from '../test/storeTestUtils';
import { deriveNamespace } from './deriveNamespace';
import { selectCurrentFile } from './selectors';

const addFolder = (store: ReturnType<typeof makeStore>, name: string, parentId: string | null = null) => store.dispatch(folderAdded(name, parentId)).payload.id;

describe('filesSlice', () => {
  describe('fileAdded', () => {
    it('adds the file and makes it current', () => {
      const store = makeStore();
      const fileId = addFile(store, 'Web Server');
      expect(fileOf(store, fileId)).toMatchObject({ name: 'Web Server', namespace: 'web_server', parentId: null });
      expect(selectCurrentFile(store.getState())?.id).toBe(fileId);
    });

    it('keeps namespaces unique project-wide, even across folders', () => {
      const store = makeStore();
      const folder = addFolder(store, 'Sub');
      const first = addFile(store, 'Web');
      const second = addFile(store, 'web', folder);
      const third = addFile(store, 'WEB!', folder);
      expect([first, second, third].map(id => fileOf(store, id)?.namespace)).toEqual(['web', 'web_2', 'web_3']);
    });

    it('never derives an empty or reserved namespace', () => {
      const store = makeStore();
      const ids = ['***', 'Default', 'sys', 'this'].map(name => addFile(store, name));
      const namespaces = ids.map(id => fileOf(store, id)?.namespace);
      expect(namespaces).toEqual(['file', 'default_2', 'sys_2', 'this_2']);
    });

    it('names siblings uniquely, case-insensitively, but not across folders', () => {
      const store = makeStore();
      const folder = addFolder(store, 'Sub');
      const ids = [addFile(store, 'Policy'), addFile(store, 'policy'), addFile(store, 'POLICY'), addFile(store, 'Policy', folder)];
      expect(ids.map(id => fileOf(store, id)?.name)).toEqual(['Policy', 'policy 2', 'POLICY 3', 'Policy']);
    });

    it('strips path characters and falls back to Untitled', () => {
      const store = makeStore();
      expect(fileOf(store, addFile(store, 'a/b.c'))?.name).toBe('abc');
      expect(fileOf(store, addFile(store, ' ./ '))?.name).toBe('Untitled');
    });
  });

  describe('deriveNamespace', () => {
    it('slugs, lowercases and trims underscores', () => {
      expect(deriveNamespace('  My Cool--Policy!  ')).toBe('my_cool_policy');
    });

    it('skips taken and reserved suffixed candidates', () => {
      expect(deriveNamespace('web', ['web', 'web_2'])).toBe('web_3');
      expect(deriveNamespace('', ['file'])).toBe('file_2');
    });
  });

  describe('fileRenamed', () => {
    it('keeps the namespace', () => {
      const store = makeStore();
      const fileId = addFile(store, 'Old');
      store.dispatch(fileRenamed({ fileId, name: 'New' }));
      expect(fileOf(store, fileId)).toMatchObject({ name: 'New', namespace: 'old' });
    });

    it('stays unique among siblings, ignoring the file itself', () => {
      const store = makeStore();
      addFile(store, 'Taken');
      const fileId = addFile(store, 'Mine');
      store.dispatch(fileRenamed({ fileId, name: 'taken' }));
      expect(fileOf(store, fileId)?.name).toBe('taken 2');
      store.dispatch(fileRenamed({ fileId, name: 'TAKEN 2' }));
      expect(fileOf(store, fileId)?.name).toBe('TAKEN 2');
    });

    it('ignores a name that sanitizes to nothing', () => {
      const store = makeStore();
      const fileId = addFile(store, 'Keep');
      store.dispatch(fileRenamed({ fileId, name: '/.' }));
      expect(fileOf(store, fileId)?.name).toBe('Keep');
    });
  });

  describe('fileRemoved', () => {
    it('makes another file current when the current one goes', () => {
      const store = makeStore();
      const first = addFile(store, 'First');
      const second = addFile(store, 'Second');
      store.dispatch(fileRemoved({ fileId: second }));
      expect(store.getState().files.currentFileId).toBe(first);
      store.dispatch(fileRemoved({ fileId: first }));
      expect(store.getState().files.currentFileId).toBeNull();
    });

    it('keeps the current file when another one goes', () => {
      const store = makeStore();
      const first = addFile(store, 'First');
      const second = addFile(store, 'Second');
      store.dispatch(fileSelected({ fileId: first }));
      store.dispatch(fileRemoved({ fileId: second }));
      expect(store.getState().files.currentFileId).toBe(first);
    });
  });

  describe('folders', () => {
    it('names sibling folders uniquely, separately from files', () => {
      const store = makeStore();
      addFile(store, 'Common');
      const ids = [addFolder(store, 'Common'), addFolder(store, 'common')];
      expect(store.getState().files.folders.map(folder => folder.name)).toEqual(['Common', 'common 2']);
      store.dispatch(folderRenamed({ folderId: ids[1], name: 'COMMON' }));
      expect(store.getState().files.folders[1].name).toBe('COMMON 2');
    });

    it('removes a folder with all its descendants and picks another current file', () => {
      const store = makeStore();
      const outside = addFile(store, 'Outside');
      const top = addFolder(store, 'Top');
      const nested = addFolder(store, 'Nested', top);
      const sibling = addFolder(store, 'Sibling');
      addFile(store, 'In top', top);
      addFile(store, 'Deep', nested);

      store.dispatch(folderRemoved({ folderId: top }));

      const { files, folders, currentFileId } = store.getState().files;
      expect(files.map(file => file.id)).toEqual([outside]);
      expect(folders.map(folder => folder.id)).toEqual([sibling]);
      expect(currentFileId).toBe(outside);
    });
  });

  describe('file condition', () => {
    it('enables, edits and removes the file-wide condition', () => {
      const store = makeStore();
      const fileId = addFile(store);
      store.dispatch(fileConditionEnabled({ fileId }));
      expect(fileOf(store, fileId)?.condition).toEqual({ kind: 'class', mode: 'if', className: '' });

      store.dispatch(fileConditionModeChanged({ fileId, mode: 'unless' }));
      store.dispatch(fileConditionClassNameChanged({ fileId, className: 'windows' }));
      expect(fileOf(store, fileId)?.condition).toEqual({ kind: 'class', mode: 'unless', className: 'windows' });

      store.dispatch(fileConditionEnabled({ fileId }));
      expect(fileOf(store, fileId)?.condition?.className).toBe('windows');

      store.dispatch(fileConditionRemoved({ fileId }));
      expect(fileOf(store, fileId)).not.toHaveProperty('condition');
    });

    it('ignores edits while no condition is set', () => {
      const store = makeStore();
      const fileId = addFile(store);
      store.dispatch(fileConditionModeChanged({ fileId, mode: 'unless' }));
      store.dispatch(fileConditionClassNameChanged({ fileId, className: 'x' }));
      expect(fileOf(store, fileId)?.condition).toBeUndefined();
    });
  });

  it('replaces every file and folder on projectFilesInitialized', () => {
    const store = makeStore();
    addFile(store, 'Old');
    addFolder(store, 'Old folder');
    store.dispatch(projectCreated({ name: 'Web' }));
    store.dispatch(projectFilesInitialized('Web'));
    const { files, folders, currentFileId } = store.getState().files;
    expect(files).toEqual([{ id: currentFileId, name: 'Web', namespace: 'web', parentId: null }]);
    expect(folders).toEqual([]);
  });
});
