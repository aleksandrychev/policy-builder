import { blockDescriptorsById } from '../blocks/loadBlocks';
import { primaryPromiseType } from '../blocks/resolveBlockShape';
import type { BlockDescriptor } from '../blocks/types';
import { GRID_SIZE, nextStackPosition } from '../canvas/layout';
import { useAppDispatch, useAppSelector } from '../store';
import { blockAdded, blockRemoved } from '../store/canvasSlice';
import { selectCanvasBlocks } from '../store/canvasSlice/selectors';
import type { BlockInstance, DefinitionEntry } from '../store/canvasSlice/types';
import { clipboardCopied, clipboardCut, clipboardDowngradedToCopy } from '../store/clipboardSlice';
import { selectClipboard } from '../store/clipboardSlice/selectors';
import { selectFiles } from '../store/filesSlice/selectors';
import { type PasteOrigin, copyParamBindings, copySubjectFields, definedNames, requalifyParams, uniqueParamValue } from './pasteCopies';

interface ClipboardDeps {
  announce: (message: string) => void;
  asOneStep: (run: () => void) => void;
  currentFileId: string | null;
  // The open file's blocks.
  instances: BlockInstance[];
  onPasted: (instanceId: string) => void;
  sizeOf: (instance: BlockInstance) => { height: number; width: number };
}

// Copy / cut / paste of one block through the single-slot clipboard.
export function useClipboardActions({ announce, asOneStep, currentFileId, instances, onPasted, sizeOf }: ClipboardDeps) {
  const dispatch = useAppDispatch();
  const clipboard = useAppSelector(selectClipboard);
  const allInstances = useAppSelector(selectCanvasBlocks);
  const files = useAppSelector(selectFiles);

  // What the snapshot's bare references meant in its own file (see PasteOrigin).
  const pasteOrigin = (snapshot: BlockInstance, descriptor: BlockDescriptor | undefined): PasteOrigin | undefined => {
    const namespace = files.find(file => file.id === snapshot.fileId)?.namespace;
    if (!namespace) return undefined;
    const classes = new Set<string>();
    for (const item of allInstances) {
      const definer = blockDescriptorsById.get(item.blockId);
      if (item.fileId !== snapshot.fileId || item.instanceId === snapshot.instanceId || !definer?.entries) continue;
      if (primaryPromiseType(definer) === 'classes') definedNames([item], item.blockId, definer).forEach(name => classes.add(name));
    }
    const ownVariables = descriptor && primaryPromiseType(descriptor) === 'vars' ? definedNames([snapshot], snapshot.blockId, descriptor) : new Set<string>();
    return { namespace, classes, ownVariables };
  };

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
    const descriptor = blockDescriptorsById.get(snapshot.blockId);
    const origin = crossFile ? pasteOrigin(snapshot, descriptor) : undefined;

    // Same-file paste immediately collides with the block it was copied
    // from; cross-file paste only sometimes does. Either way, only fix up
    // what this paste just created — not a repo-wide uniqueness pass.
    // A cut's own original goes away, so it doesn't count.
    const nameParam = descriptor?.entries?.name_param;
    const others = instances.filter(item => clipboard.mode !== 'cut' || item.instanceId !== snapshot.instanceId);
    const taken = descriptor ? definedNames(others, snapshot.blockId, descriptor) : new Set<string>();
    const entries: DefinitionEntry[] | undefined = snapshot.entries?.map(entry => {
      const params = requalifyParams(entry.params, descriptor, origin);
      if (nameParam && params[nameParam]) {
        params[nameParam] = uniqueParamValue(params[nameParam], taken);
        taken.add(params[nameParam]);
      }
      return { ...entry, ...copySubjectFields(entry, origin), id: crypto.randomUUID(), params };
    });

    let pastedId = '';
    asOneStep(() => {
      const pasteAction = dispatch(
        blockAdded({
          blockId: snapshot.blockId,
          fileId: currentFileId,
          label: snapshot.label,
          params: requalifyParams(snapshot.params, descriptor, origin),
          // Same file: next to the original. Another file: under its lowest
          // block. Arrows don't travel with a pasted block.
          position:
            !crossFile && snapshot.position
              ? { x: snapshot.position.x + 2 * GRID_SIZE, y: snapshot.position.y + 2 * GRID_SIZE }
              : nextStackPosition(instances, sizeOf),
          valueSourceId: snapshot.valueSourceId,
          ...copySubjectFields(snapshot, origin),
          entries,
          incomingMode: snapshot.incomingMode,
          paramBindings: copyParamBindings(snapshot.paramBindings, origin)
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
