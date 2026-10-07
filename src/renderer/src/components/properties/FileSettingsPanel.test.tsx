import { fireEvent, screen, within } from '@testing-library/react';

import { newDefinitionEntry } from '../../blocks/definitionEntries';
import { blockDescriptorsById } from '../../blocks/loadBlocks';
import { useAppDispatch, useAppSelector } from '../../store';
import {
  fileConditionClassNameChanged,
  fileConditionEnabled,
  fileConditionModeChanged,
  fileConditionRemoved,
  fileDescriptionChanged,
  fileSelected
} from '../../store/filesSlice';
import { selectCurrentFile } from '../../store/filesSlice/selectors';
import { type TestStore, addBlock, addFile, fileOf, makeStore } from '../../store/test/storeTestUtils';
import { renderWithProviders } from '../../test/render';
import { FileSettingsPanel } from './FileSettingsPanel';

// Wired to the store the way ProjectView's CurrentFileSettings wires it.
function ConnectedFileSettings() {
  const dispatch = useAppDispatch();
  const file = useAppSelector(selectCurrentFile);
  const files = useAppSelector(state => state.files.files);
  const allInstances = useAppSelector(state => state.canvas);
  if (!file) return null;
  const fileId = file.id;
  return (
    <FileSettingsPanel
      file={file}
      allInstances={allInstances}
      files={files}
      onEnable={() => dispatch(fileConditionEnabled({ fileId }))}
      onRemove={() => dispatch(fileConditionRemoved({ fileId }))}
      onModeChange={mode => dispatch(fileConditionModeChanged({ fileId, mode }))}
      onClassNameChange={className => dispatch(fileConditionClassNameChanged({ fileId, className }))}
      onDescriptionChange={description => dispatch(fileDescriptionChanged({ fileId, description }))}
    />
  );
}

const defineClass = (store: TestStore, fileId: string, className: string) => {
  const descriptor = blockDescriptorsById.get('define-class')!;
  return addBlock(store, fileId, {
    blockId: 'define-class',
    label: 'Define Class',
    params: {},
    entries: [newDefinitionEntry(descriptor, { params: { class_name: className } })]
  });
};

describe('FileSettingsPanel', () => {
  let store: TestStore;
  let fileId: string;

  beforeEach(() => {
    store = makeStore();
    fileId = addFile(store, 'Web');
  });

  it('shows the file name and namespace', () => {
    renderWithProviders(<ConnectedFileSettings />, { store });
    expect(screen.getByText('Web')).toBeInTheDocument();
    expect(screen.getByText(`namespace: ${fileOf(store, fileId)?.namespace}`)).toBeInTheDocument();
  });

  it('writes the description', () => {
    renderWithProviders(<ConnectedFileSettings />, { store });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Serves the site' } });
    expect(fileOf(store, fileId)?.description).toBe('Serves the site');
  });

  it('drops a blank description', () => {
    store.dispatch(fileDescriptionChanged({ fileId, description: 'Old' }));
    renderWithProviders(<ConnectedFileSettings />, { store });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: '  ' } });
    expect(fileOf(store, fileId)).not.toHaveProperty('description');
  });

  it('adds a file condition', () => {
    renderWithProviders(<ConnectedFileSettings />, { store });
    fireEvent.click(screen.getByRole('button', { name: 'File condition (0)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(fileOf(store, fileId)?.condition).toEqual({ kind: 'class', mode: 'if', className: '' });
  });

  describe('with a condition', () => {
    beforeEach(() => {
      store.dispatch(fileConditionEnabled({ fileId }));
    });

    it('types the class name', () => {
      renderWithProviders(<ConnectedFileSettings />, { store });
      fireEvent.change(screen.getByPlaceholderText('Search class names…'), { target: { value: 'linux' } });
      expect(fileOf(store, fileId)?.condition?.className).toBe('linux');
    });

    it('switches the mode', () => {
      renderWithProviders(<ConnectedFileSettings />, { store });
      fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Mode' }));
      fireEvent.click(screen.getByRole('option', { name: 'Skip if' }));
      expect(fileOf(store, fileId)?.condition?.mode).toBe('unless');
    });

    it('removes it', () => {
      renderWithProviders(<ConnectedFileSettings />, { store });
      fireEvent.click(screen.getByRole('button', { name: 'Remove file condition' }));
      expect(fileOf(store, fileId)?.condition).toBeUndefined();
      expect(screen.getByRole('button', { name: 'File condition (0)' })).toBeInTheDocument();
    });
  });

  it('offers classes from other files, not from this one', () => {
    const otherId = addFile(store, 'Detect');
    defineClass(store, otherId, 'is_web');
    defineClass(store, fileId, 'own_class');
    store.dispatch(fileSelected({ fileId }));
    store.dispatch(fileConditionEnabled({ fileId }));
    renderWithProviders(<ConnectedFileSettings />, { store });

    fireEvent.mouseDown(screen.getByPlaceholderText('Search class names…'));
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('Defined in Detect')).toBeInTheDocument();
    expect(within(listbox).getByText('detect:is_web')).toBeInTheDocument();
    expect(within(listbox).queryByText('own_class')).not.toBeInTheDocument();

    fireEvent.click(within(listbox).getByText('detect:is_web'));
    expect(fileOf(store, fileId)?.condition?.className).toBe('detect:is_web');
  });

  it('offers no New class button', () => {
    store.dispatch(fileConditionEnabled({ fileId }));
    renderWithProviders(<ConnectedFileSettings />, { store });
    expect(screen.queryByRole('button', { name: 'New class' })).not.toBeInTheDocument();
  });
});
