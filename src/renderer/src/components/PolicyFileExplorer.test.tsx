import { fireEvent, screen, within } from '@testing-library/react';

import { useAppDispatch, useAppSelector } from '../store';
import { blocksRemovedForFile } from '../store/canvasSlice';
import {
  fileAdded,
  fileConditionClassNameChanged,
  fileConditionEnabled,
  fileConditionModeChanged,
  fileDescriptionChanged,
  fileRemoved,
  fileRenamed,
  fileSelected,
  folderAdded,
  folderRemoved,
  folderRenamed
} from '../store/filesSlice';
import { collectFolderDescendants } from '../store/filesSlice/fileTree';
import { inOneStep } from '../store/history';
import { type TestStore, addBlock, addFile, fileOf, makeStore } from '../store/test/storeTestUtils';
import { renderWithProviders } from '../test/render';
import { PolicyFileExplorer } from './PolicyFileExplorer';

// Wired to the store the way ProjectView wires it.
function ConnectedExplorer() {
  const dispatch = useAppDispatch();
  const { files, folders, currentFileId } = useAppSelector(state => state.files);
  const instances = useAppSelector(state => state.canvas);
  return (
    <PolicyFileExplorer
      files={files}
      folders={folders}
      currentFileId={currentFileId}
      instances={instances}
      onSelectFile={fileId => dispatch(fileSelected({ fileId }))}
      onAddFile={(name, parentId) => dispatch(fileAdded(name, parentId))}
      onAddFolder={(name, parentId) => dispatch(folderAdded(name, parentId))}
      onRenameFile={(fileId, name) => dispatch(fileRenamed({ fileId, name }))}
      onRenameFolder={(folderId, name) => dispatch(folderRenamed({ folderId, name }))}
      onDeleteFile={fileId =>
        inOneStep(dispatch, () => {
          dispatch(fileRemoved({ fileId }));
          dispatch(blocksRemovedForFile({ fileId }));
        })
      }
      onDeleteFolder={folderId => {
        const { fileIds } = collectFolderDescendants(files, folders, folderId);
        inOneStep(dispatch, () => {
          dispatch(folderRemoved({ folderId }));
          for (const fileId of fileIds) dispatch(blocksRemovedForFile({ fileId }));
        });
      }}
    />
  );
}

const renderExplorer = (store: TestStore) => renderWithProviders(<ConnectedExplorer />, { store });

const addFolder = (store: TestStore, name: string, parentId: string | null = null) => store.dispatch(folderAdded(name, parentId)).payload.id;

const fileNames = (store: TestStore) => store.getState().files.files.map(file => file.name);

// The inline name field that replaces a row's label while renaming / creating.
const nameField = () => screen.getByRole('textbox');

describe('PolicyFileExplorer', () => {
  let store: TestStore;
  let mainId: string;
  let webId: string;

  beforeEach(() => {
    store = makeStore();
    mainId = addFile(store, 'Main');
    webId = addFile(store, 'Web');
    store.dispatch(fileSelected({ fileId: mainId }));
  });

  describe('tree', () => {
    it('lists files with their block counts', () => {
      addBlock(store, mainId);
      addBlock(store, mainId);
      renderExplorer(store);
      const main = screen.getByRole('treeitem', { name: /Main\.cf/ });
      expect(within(main).getByText('2 blocks')).toBeInTheDocument();
      expect(within(screen.getByRole('treeitem', { name: /Web\.cf/ })).getByText('0 blocks')).toBeInTheDocument();
    });

    it('shows folders before files, and their files once expanded', () => {
      const folderId = addFolder(store, 'Servers');
      addFile(store, 'Nginx', folderId);
      store.dispatch(fileSelected({ fileId: mainId }));
      renderExplorer(store);

      const items = screen.getAllByRole('treeitem');
      expect(items[0]).toHaveTextContent('Servers');
      expect(screen.queryByText('Nginx.cf')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Servers'));
      const folder = screen.getByRole('treeitem', { name: /Servers/ });
      expect(within(folder).getByText('Nginx.cf')).toBeInTheDocument();
    });

    it('reveals the current file inside a collapsed folder', async () => {
      const folderId = addFolder(store, 'Servers');
      addFile(store, 'Nginx', folderId);
      renderExplorer(store);
      expect(await screen.findByText('Nginx.cf')).toBeInTheDocument();
    });

    it('selects a file on click', () => {
      renderExplorer(store);
      fireEvent.click(screen.getByText('Web.cf'));
      expect(store.getState().files.currentFileId).toBe(webId);
    });

    it('shows the description as a tooltip on hover', async () => {
      store.dispatch(fileDescriptionChanged({ fileId: webId, description: 'Serves the site' }));
      renderExplorer(store);
      fireEvent.mouseOver(screen.getByText('Web.cf'));
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Serves the site');
    });

    it('marks a gated file with its condition', () => {
      store.dispatch(fileConditionEnabled({ fileId: webId }));
      store.dispatch(fileConditionModeChanged({ fileId: webId, mode: 'unless' }));
      store.dispatch(fileConditionClassNameChanged({ fileId: webId, className: 'windows' }));
      renderExplorer(store);
      expect(screen.getByTitle('The whole file skipped if windows')).toHaveTextContent('windows');
      expect(within(screen.getByRole('treeitem', { name: /Main\.cf/ })).queryByTitle(/The whole file/)).not.toBeInTheDocument();
    });

    it('shows no marker for a condition without a class yet', () => {
      store.dispatch(fileConditionEnabled({ fileId: webId }));
      renderExplorer(store);
      expect(screen.queryByTitle(/The whole file/)).not.toBeInTheDocument();
    });
  });

  describe('rename', () => {
    it('renames a file on double-click and Enter', () => {
      renderExplorer(store);
      fireEvent.doubleClick(screen.getByText('Web.cf'));
      expect(nameField()).toHaveValue('Web');
      fireEvent.change(nameField(), { target: { value: 'Frontend' } });
      fireEvent.keyDown(nameField(), { key: 'Enter' });
      expect(fileOf(store, webId)?.name).toBe('Frontend');
      expect(screen.getByText('Frontend.cf')).toBeInTheDocument();
    });

    it('renames from the row action, committing on blur', () => {
      renderExplorer(store);
      fireEvent.click(screen.getByRole('button', { name: 'Rename Web.cf' }));
      fireEvent.change(nameField(), { target: { value: 'Api' } });
      fireEvent.blur(nameField());
      expect(fileOf(store, webId)?.name).toBe('Api');
    });

    it('keeps the old name on Escape', () => {
      renderExplorer(store);
      fireEvent.doubleClick(screen.getByText('Web.cf'));
      fireEvent.change(nameField(), { target: { value: 'Discarded' } });
      fireEvent.keyDown(nameField(), { key: 'Escape' });
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(fileOf(store, webId)?.name).toBe('Web');
    });

    it('ignores a blank name', () => {
      renderExplorer(store);
      fireEvent.doubleClick(screen.getByText('Web.cf'));
      fireEvent.change(nameField(), { target: { value: '   ' } });
      fireEvent.keyDown(nameField(), { key: 'Enter' });
      expect(fileOf(store, webId)?.name).toBe('Web');
    });

    it('strips path separators and dots from a name', () => {
      renderExplorer(store);
      fireEvent.doubleClick(screen.getByText('Web.cf'));
      fireEvent.change(nameField(), { target: { value: 'a/b.c' } });
      fireEvent.keyDown(nameField(), { key: 'Enter' });
      expect(fileOf(store, webId)?.name).toBe('abc');
    });

    it('keeps sibling names unique', () => {
      renderExplorer(store);
      fireEvent.doubleClick(screen.getByText('Web.cf'));
      fireEvent.change(nameField(), { target: { value: 'main' } });
      fireEvent.keyDown(nameField(), { key: 'Enter' });
      expect(fileOf(store, webId)?.name).toBe('main 2');
    });

    it('renames a folder', () => {
      const folderId = addFolder(store, 'Servers');
      renderExplorer(store);
      fireEvent.doubleClick(screen.getByText('Servers'));
      fireEvent.change(nameField(), { target: { value: 'Hosts' } });
      fireEvent.keyDown(nameField(), { key: 'Enter' });
      expect(store.getState().files.folders.find(folder => folder.id === folderId)?.name).toBe('Hosts');
    });

    it('renames from the context menu', () => {
      renderExplorer(store);
      fireEvent.contextMenu(screen.getByText('Web.cf'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
      expect(nameField()).toHaveValue('Web');
    });
  });

  describe('delete', () => {
    it('deletes a file and its blocks after confirming', () => {
      addBlock(store, webId);
      renderExplorer(store);
      fireEvent.click(screen.getByRole('button', { name: 'Delete Web.cf' }));
      const dialog = screen.getByRole('dialog', { name: 'Delete policy file' });
      expect(dialog).toHaveTextContent('"Web.cf" and its 1 block(s) will be removed.');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      expect(fileNames(store)).toEqual(['Main']);
      expect(store.getState().canvas).toEqual([]);
    });

    it('keeps the file when cancelled', () => {
      renderExplorer(store);
      fireEvent.click(screen.getByRole('button', { name: 'Delete Web.cf' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      expect(fileNames(store)).toEqual(['Main', 'Web']);
    });

    it('cannot delete the last file', () => {
      store.dispatch(fileRemoved({ fileId: webId }));
      renderExplorer(store);
      expect(screen.getByRole('button', { name: 'Delete Main.cf' })).toBeDisabled();
      fireEvent.contextMenu(screen.getByText('Main.cf'));
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true');
    });

    it('cannot delete a folder holding every file', () => {
      const folderId = addFolder(store, 'All');
      store.dispatch(fileRemoved({ fileId: webId }));
      store.dispatch(fileRemoved({ fileId: mainId }));
      addFile(store, 'Only', folderId);
      renderExplorer(store);
      expect(screen.getByRole('button', { name: 'Delete All' })).toBeDisabled();
    });

    it('deletes a folder with its files', () => {
      const folderId = addFolder(store, 'Servers');
      const nginxId = addFile(store, 'Nginx', folderId);
      addBlock(store, nginxId);
      store.dispatch(fileSelected({ fileId: mainId }));
      renderExplorer(store);
      fireEvent.click(screen.getByRole('button', { name: 'Delete Servers' }));
      const dialog = screen.getByRole('dialog', { name: 'Delete folder' });
      expect(dialog).toHaveTextContent('"Servers" and its 1 file(s) (1 total block(s))');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      expect(store.getState().files.folders).toEqual([]);
      expect(fileNames(store)).toEqual(['Main', 'Web']);
      expect(store.getState().canvas).toEqual([]);
    });
  });

  describe('create', () => {
    it('adds a file from the toolbar', () => {
      renderExplorer(store);
      fireEvent.click(screen.getByTitle('New file'));
      expect(nameField()).toHaveValue('New file');
      fireEvent.change(nameField(), { target: { value: 'Db' } });
      fireEvent.keyDown(nameField(), { key: 'Enter' });
      expect(fileNames(store)).toEqual(['Main', 'Web', 'Db']);
      expect(screen.getByText('Db.cf')).toBeInTheDocument();
    });

    it('adds a folder from the toolbar', () => {
      renderExplorer(store);
      fireEvent.click(screen.getByTitle('New folder'));
      expect(nameField()).toHaveValue('New folder');
      fireEvent.blur(nameField());
      expect(store.getState().files.folders.map(folder => folder.name)).toEqual(['New folder']);
    });

    it('discards a draft on Escape', () => {
      renderExplorer(store);
      fireEvent.click(screen.getByTitle('New file'));
      fireEvent.keyDown(nameField(), { key: 'Escape' });
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(fileNames(store)).toHaveLength(2);
    });

    it('adds a file inside a folder from its context menu', () => {
      const folderId = addFolder(store, 'Servers');
      renderExplorer(store);
      fireEvent.contextMenu(screen.getByText('Servers'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'New File' }));
      fireEvent.change(nameField(), { target: { value: 'Nginx' } });
      fireEvent.keyDown(nameField(), { key: 'Enter' });
      expect(store.getState().files.files.find(file => file.name === 'Nginx')?.parentId).toBe(folderId);
    });

    it('gives a duplicate new file a unique name', () => {
      renderExplorer(store);
      fireEvent.click(screen.getByTitle('New file'));
      fireEvent.change(nameField(), { target: { value: 'Web' } });
      fireEvent.keyDown(nameField(), { key: 'Enter' });
      expect(fileNames(store)).toContain('Web 2');
    });
  });
});
