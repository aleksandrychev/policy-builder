import { initialParams } from '../blocks/initialParams';
import { blockDescriptorsById } from '../blocks/loadBlocks';
import { PYTHON_ADVICE, PYTHON_ADVICE_KEY, needsPython } from '../canvas/advice';
import { useAppDispatch, useAppSelector } from '../store';
import { blockAdded } from '../store/canvasSlice';
import type { BlockInstance } from '../store/canvasSlice/types';
import { adviceDismissed } from '../store/dismissedAdviceSlice';
import { edgeAdded } from '../store/edgesSlice';
import { inOneStep } from '../store/history';

/**
 * The python3 advice's fix, as a button on it: an Install Package block for python3 above a
 * promise-type block, with an arrow into it, as one undo step.
 */
export function usePythonAdvice(canvas: BlockInstance[]) {
  const dispatch = useAppDispatch();
  const dismissed = useAppSelector(state => state.dismissedAdvice.includes(PYTHON_ADVICE_KEY));
  const addBefore = (block: BlockInstance) =>
    inOneStep(dispatch, () => {
      const install = blockDescriptorsById.get('install-package');
      if (!install) return;
      const at = block.position ?? { x: 0, y: 0 };
      const added = dispatch(
        blockAdded({
          blockId: install.id,
          fileId: block.fileId,
          label: 'Install python3',
          params: { ...initialParams(install), package_name: 'python3' },
          position: { x: at.x, y: at.y - 140 }
        })
      );
      dispatch(edgeAdded({ fileId: block.fileId, source: added.payload.instanceId, target: block.instanceId, outcomes: ['kept', 'repaired'] }));
    });
  return (block: BlockInstance | undefined) =>
    block && !dismissed && needsPython(block, canvas)
      ? {
          text: PYTHON_ADVICE,
          label: 'Add Install python3 before it',
          onClick: () => addBefore(block),
          // The project's hosts have python3: no more advice about it, in Properties or for agents.
          onIgnore: () => dispatch(adviceDismissed(PYTHON_ADVICE_KEY))
        }
      : undefined;
}
