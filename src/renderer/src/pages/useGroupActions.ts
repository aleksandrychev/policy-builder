import { useState } from 'react';

import { GRID_SIZE } from '../canvas/layout';
import { useAppDispatch, useAppSelector } from '../store';
import { blockRemoved, blocksMoved } from '../store/canvasSlice';
import type { BlockInstance } from '../store/canvasSlice/types';
import { derivedNodesMoved } from '../store/derivedNodesSlice';
import { changeMembership, groupBlocks, ungroupBlocks } from '../store/groupArrows';
import { groupFrameResized, groupFramesFitted, groupRemoved } from '../store/groupsSlice';
import { selectGroupsForFile } from '../store/groupsSlice/selectors';
import { type BlockGroup, GROUP_COLORS } from '../store/groupsSlice/types';
import { inOneStep } from '../store/history';

type Rect = NonNullable<BlockGroup['rect']>;
const snapRect = (rect: Rect): Rect => {
  const snap = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;
  return { x: snap(rect.x), y: snap(rect.y), width: snap(rect.width), height: snap(rect.height) };
};

/**
 * Block groups on the current file's canvas: the selection state and every
 * action that creates, edits or dissolves a group, plus the canvas callbacks
 * for dragging, resizing and dropping blocks in and out of frames.
 */
export function useGroupActions({
  announce,
  currentFileId,
  instances,
  onGroupCreated,
  undoKey
}: {
  announce: (message: string) => void;
  currentFileId: string | null;
  instances: BlockInstance[];
  // Clears the block selection once its blocks became a group.
  onGroupCreated: () => void;
  undoKey: string;
}) {
  const dispatch = useAppDispatch();
  const groups = useAppSelector(state => selectGroupsForFile(state, currentFileId));
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  // The group just created, whose name field gets focus.
  const [freshGroupId, setFreshGroupId] = useState<string | null>(null);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);

  const membersOf = (groupId: string) => instances.filter(instance => instance.groupId === groupId);
  const liveGroups = groups.filter(group => membersOf(group.id).length > 0);
  const selectedGroup = liveGroups.find(group => group.id === selectedGroupId);

  const createGroup = (instanceIds: string[]) => {
    if (!currentFileId || instanceIds.length === 0) return;
    const names = new Set(liveGroups.map(group => group.name));
    let number = 1;
    while (names.has(`Group ${number}`)) number += 1;
    const color = GROUP_COLORS[(number - 1) % GROUP_COLORS.length];
    const groupId = dispatch(groupBlocks({ fileId: currentFileId, instanceIds, name: `Group ${number}`, color }));
    if (!groupId) return announce('Can’t group these blocks: arrows through the group would make a loop.');
    onGroupCreated();
    setSelectedGroupId(groupId);
    setFreshGroupId(groupId);
    announce(`Grouped ${instanceIds.length} ${instanceIds.length === 1 ? 'block' : 'blocks'} — ${undoKey} to undo`);
  };

  const ungroup = (groupId: string) => {
    if (currentFileId) dispatch(ungroupBlocks(currentFileId, groupId));
    setSelectedGroupId(null);
    announce(`Ungrouped — ${undoKey} to undo`);
  };

  const deleteGroupWithBlocks = (groupId: string) => {
    const members = membersOf(groupId);
    inOneStep(dispatch, () => {
      for (const member of members) dispatch(blockRemoved({ instanceId: member.instanceId }));
      dispatch(groupRemoved({ groupId }));
    });
    setDeleteGroupId(null);
    setSelectedGroupId(null);
    announce(`Deleted the group and its ${members.length} blocks — ${undoKey} to undo`);
  };

  // Selecting a group by clicking its frame (null: deselect).
  const selectGroup = (groupId: string | null) => {
    setSelectedGroupId(groupId);
    setFreshGroupId(null);
  };

  // FlowCanvas callbacks.
  const canvasCallbacks = {
    onGroupMove: (
      positions: Record<string, { x: number; y: number }>,
      derived: Record<string, { x: number; y: number }>,
      resized?: { groupId: string; rect: Rect }
    ) => {
      dispatch(blocksMoved({ positions }));
      if (Object.keys(derived).length > 0) dispatch(derivedNodesMoved({ positions: derived }));
      if (resized) dispatch(groupFrameResized(resized));
    },
    onGroupResize: (groupId: string, rect: Rect) => dispatch(groupFrameResized({ groupId, rect: snapRect(rect) })),
    // False when refused: the arrows it would re-attach to frames would make a loop.
    onMembershipChange: (instanceIds: string[], groupId: string | null) => {
      if (!currentFileId || !dispatch(changeMembership(currentFileId, instanceIds, groupId))) {
        announce('Can’t move it there: its arrows would make a loop.');
        return false;
      }
      const name = groups.find(group => group.id === groupId)?.name;
      announce(groupId ? `Added to "${name}"` : 'Removed from its group');
      return true;
    }
  };

  const fitFrames = (groupIds: string[]) => dispatch(groupFramesFitted({ groupIds }));

  return {
    groups,
    liveGroups,
    selectedGroupId,
    selectedGroup,
    freshGroupId,
    deleteGroupId,
    setDeleteGroupId,
    setSelectedGroupId,
    membersOf,
    createGroup,
    ungroup,
    deleteGroupWithBlocks,
    selectGroup,
    fitFrames,
    canvasCallbacks
  };
}
