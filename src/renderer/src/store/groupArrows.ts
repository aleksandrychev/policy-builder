import type { AppDispatch, RootState } from '.';
import { blockDescriptorsById } from '../blocks/loadBlocks';
import { attachToFrames, fanOut, hasCycle, intoGroup } from '../canvas/groupEdges';
import { blockGroupChanged } from './canvasSlice';
import type { BlockInstance } from './canvasSlice/types';
import { fileEdgesReplaced } from './edgesSlice';
import type { BlockEdge } from './edgesSlice/types';
import { groupCreated, groupRemoved } from './groupsSlice';
import type { GroupColor } from './groupsSlice/types';
import { inOneStep } from './history';

// Group changes that keep the file's arrows off the frames' edges (canvas/groupEdges.ts).
type Thunk<R> = (dispatch: AppDispatch, getState: () => RootState) => R;

const fileState = (state: RootState, fileId: string) => ({
  edges: state.edges.filter(edge => edge.fileId === fileId),
  instances: state.canvas.filter(instance => instance.fileId === fileId)
});

const withGroup = (instances: BlockInstance[], instanceIds: string[], groupId: string | null) =>
  instances.map(instance => (instanceIds.includes(instance.instanceId) ? { ...instance, groupId: groupId ?? undefined } : instance));

const replaceEdges = (dispatch: AppDispatch, fileId: string, before: BlockEdge[], after: BlockEdge[]) => {
  if (after !== before) dispatch(fileEdgesReplaced({ fileId, edges: after.map(({ fileId: _fileId, ...edge }) => edge) }));
};

/** Groups blocks, unless re-attaching their arrows to the frame would close a loop. Returns the new group's id. */
export const groupBlocks =
  (group: { color: GroupColor; fileId: string; instanceIds: string[]; name: string }): Thunk<string | null> =>
  (dispatch, getState) => {
    const { edges, instances } = fileState(getState(), group.fileId);
    const action = groupCreated(group);
    const after = attachToFrames(edges, withGroup(instances, group.instanceIds, action.payload.id));
    if (hasCycle(after)) return null;
    inOneStep(dispatch, () => {
      dispatch(action);
      replaceEdges(dispatch, group.fileId, edges, after);
    });
    return action.payload.id;
  };

/**
 * Blocks dropped into a group (or out of theirs, `groupId` null). A group left
 * without blocks goes, with its arrows. False (and nothing changes) when the
 * re-attached arrows would close a loop.
 */
export const changeMembership =
  (fileId: string, instanceIds: string[], groupId: string | null): Thunk<boolean> =>
  (dispatch, getState) => {
    const state = getState();
    const { edges, instances } = fileState(state, fileId);
    const moved = withGroup(instances, instanceIds, groupId);
    const kept = groupId ? intoGroup(groupId, instanceIds, edges, instances, blockDescriptorsById) : edges;
    const after = attachToFrames(kept, moved);
    if (hasCycle(after)) return false;
    const emptied = state.groups.filter(
      group => group.fileId === fileId && instances.some(instance => instance.groupId === group.id) && !moved.some(instance => instance.groupId === group.id)
    );
    inOneStep(dispatch, () => {
      dispatch(blockGroupChanged({ instanceIds, groupId }));
      replaceEdges(dispatch, fileId, edges, after);
      for (const group of emptied) dispatch(groupRemoved({ groupId: group.id }));
    });
    return true;
  };

/** Ungroup: the frame goes, its blocks stay, and its arrows fan out to them. */
export const ungroupBlocks =
  (fileId: string, groupId: string): Thunk<void> =>
  (dispatch, getState) => {
    const { edges, instances } = fileState(getState(), fileId);
    inOneStep(dispatch, () => {
      dispatch(fileEdgesReplaced({ fileId, edges: fanOut(groupId, edges, instances, blockDescriptorsById) }));
      dispatch(groupRemoved({ groupId }));
    });
  };
