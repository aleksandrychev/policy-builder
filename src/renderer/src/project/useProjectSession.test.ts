import { createAppStore } from '../store';
import { blockMoved } from '../store/canvasSlice';
import { fileRenamed, fileSelected } from '../store/filesSlice';
import { projectCreated } from '../store/projectSlice';
import { addBlock, addFile } from '../store/test/storeTestUtils';
import { isEdited } from './useProjectSession';

describe('isEdited', () => {
  const setup = () => {
    const store = createAppStore();
    store.dispatch(projectCreated({ name: 'Demo' }));
    const first = addFile(store);
    const second = addFile(store, 'Other');
    const block = addBlock(store, first);
    return { store, first, second, block, saved: store.getState() };
  };

  it('ignores which file is open', () => {
    const { store, first, saved } = setup();
    expect(saved.files.currentFileId).not.toBe(first);
    store.dispatch(fileSelected({ fileId: first }));
    expect(isEdited(store.getState(), saved)).toBe(false);
  });

  it('counts edits to the files and the canvas', () => {
    const { store, second, block, saved } = setup();
    store.dispatch(fileRenamed({ fileId: second, name: 'Renamed' }));
    expect(isEdited(store.getState(), saved)).toBe(true);
    const renamed = store.getState();
    store.dispatch(blockMoved({ instanceId: block, position: { x: 1, y: 2 } }));
    expect(isEdited(store.getState(), renamed)).toBe(true);
  });
});
