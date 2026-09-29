import { useState } from 'react';

import { GATE_EDGE_PREFIX } from '../canvas/gates';
import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';

/**
 * What's selected on the open file's canvas (groups live in useGroupActions).
 * A file switch clears it all, and anything undo/redo took away reads as not
 * selected, so Delete and the Properties panel never act on something unseen.
 */
export function useSelection(instances: BlockInstance[], edges: BlockEdge[], currentFileId: string | null) {
  const [rawInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  // Two or more blocks picked with the selection box or Shift+click.
  const [pickedIds, setMultiSelectedIds] = useState<string[]>([]);
  const [rawEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedGateKey, setSelectedGateKey] = useState<string | null>(null);
  // Opened from a data-chain node: which entry (or data-fed parameter) of the
  // selected block the Properties panel jumps to — and Delete removes.
  const [rawFocusEntryId, setFocusEntryId] = useState<string | null>(null);

  const clear = () => {
    setSelectedInstanceId(null);
    setMultiSelectedIds([]);
    setSelectedEdgeId(null);
    setSelectedGateKey(null);
    setFocusEntryId(null);
  };

  const [selectionFileId, setSelectionFileId] = useState(currentFileId);
  if (selectionFileId !== currentFileId) {
    setSelectionFileId(currentFileId);
    clear();
  }

  const isLive = (instanceId: string) => instances.some(instance => instance.instanceId === instanceId);
  const edgeIsLive = (edgeId: string) =>
    edges.some(edge => edge.id === edgeId) ||
    (edgeId.startsWith(GATE_EDGE_PREFIX) && Boolean(instances.find(instance => `${GATE_EDGE_PREFIX}${instance.instanceId}` === edgeId)?.condition));
  const selectedInstanceId = rawInstanceId && isLive(rawInstanceId) ? rawInstanceId : null;

  return {
    selectedInstanceId,
    setSelectedInstanceId,
    multiSelectedIds: pickedIds.filter(isLive),
    setMultiSelectedIds,
    selectedEdgeId: rawEdgeId && edgeIsLive(rawEdgeId) ? rawEdgeId : null,
    setSelectedEdgeId,
    selectedGateKey,
    setSelectedGateKey,
    focusEntryId: selectedInstanceId ? rawFocusEntryId : null,
    setFocusEntryId,
    clear
  };
}
