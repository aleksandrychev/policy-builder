import { blockDescriptorsById } from '../blocks/loadBlocks';
import { GRID_SIZE, nextStackPosition } from '../canvas/layout';
import { useAppDispatch, useAppSelector } from '../store';
import { blockAdded, blockRemoved } from '../store/canvasSlice';
import type { BlockInstance, DefinitionEntry } from '../store/canvasSlice/types';
import { clipboardCopied, clipboardCut, clipboardDowngradedToCopy } from '../store/clipboardSlice';
import { selectClipboard } from '../store/clipboardSlice/selectors';
import type { PolicyFile } from '../store/filesSlice/types';
import { copyParamBindings, copySubjectFields, definedNames, uniqueParamValue } from './pasteCopies';

interface ClipboardDeps {
  announce: (message: string) => void;
  asOneStep: (run: () => void) => void;
  currentFileId: string | null;
  files: PolicyFile[];
  // The open file's blocks.
  instances: BlockInstance[];
  onPasted: (instanceId: string) => void;
  sizeOf: (instance: BlockInstance) => { height: number; width: number };
}

// Copy / cut / paste of one block through the single-slot clipboard.
export function useClipboardActions({ announce, asOneStep, currentFileId, files, instances, onPasted, sizeOf }: ClipboardDeps) {
  const dispatch = useAppDispatch();
  const clipboard = useAppSelector(selectClipboard);

  const handleCopyBlock = (instanceId: string) => {
    const instance = instances.find(item => item.instanceId === instanceId);
    if (!instance) return;
    dispatch(clipboardCopied({ instance }));
    announce(`Copied "${instance.label}"`);
  };

  const handleCutBlock = (instanceId: string) => {
    const instance = instances.find(item => item.instanceId === instanceId);
    if (!instance) return;
    // Single-slot clipboard: a new cut replaces any pending one (the muted look follows the clipboard).
    dispatch(clipboardCut({ instance }));
    announce(`Cut "${instance.label}" — paste to move it`);
  };

  const handlePasteBlock = () => {
    const snapshot = clipboard.snapshot;
    if (!snapshot || !currentFileId) return;
    const crossFile = snapshot.fileId !== currentFileId;
    const sourceNamespace = files.find(file => file.id === snapshot.fileId)?.namespace;
    const descriptor = blockDescriptorsById.get(snapshot.blockId);

    // Same-file paste immediately collides with the block it was copied
    // from; cross-file paste only sometimes does. Either way, only fix up
    // what this paste just created — not a repo-wide uniqueness pass.
    const nameParam = descriptor?.entries?.name_param;
    const taken = descriptor ? definedNames(instances, snapshot.blockId, descriptor) : new Set<string>();
    const entries: DefinitionEntry[] | undefined = snapshot.entries?.map(entry => {
      const params = { ...entry.params };
      if (nameParam && params[nameParam]) {
        params[nameParam] = uniqueParamValue(params[nameParam], taken);
        taken.add(params[nameParam]);
      }
      return { ...entry, ...copySubjectFields(entry, sourceNamespace, crossFile), id: crypto.randomUUID(), params };
    });

    let pastedId = '';
    asOneStep(() => {
      const pasteAction = dispatch(
        blockAdded({
          blockId: snapshot.blockId,
          fileId: currentFileId,
          label: snapshot.label,
          params: { ...snapshot.params },
          // Same file: next to the original. Another file: under its lowest
          // block. Arrows don't travel with a pasted block.
          position:
            !crossFile && snapshot.position
              ? { x: snapshot.position.x + 2 * GRID_SIZE, y: snapshot.position.y + 2 * GRID_SIZE }
              : nextStackPosition(instances, sizeOf),
          valueSourceId: snapshot.valueSourceId,
          ...copySubjectFields(snapshot, sourceNamespace, crossFile),
          entries,
          incomingMode: snapshot.incomingMode,
          paramBindings: copyParamBindings(snapshot.paramBindings)
        })
      );
      pastedId = pasteAction.payload.instanceId;

      // A cut is only "completed" (source removed) by its first paste; after
      // that the clipboard behaves like a plain copy, so further Ctrl+V still
      // pastes without moving anything else — matches OS file-manager cut/paste.
      if (clipboard.mode === 'cut') {
        dispatch(blockRemoved({ instanceId: snapshot.instanceId }));
        dispatch(clipboardDowngradedToCopy());
      }
    });
    onPasted(pastedId);
    announce(`Pasted "${snapshot.label}"`);
  };

  return { handleCopyBlock, handleCutBlock, handlePasteBlock };
}
