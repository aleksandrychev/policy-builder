import { requiredModule } from '../blocks/requiredModule';
import type { BlockInstance } from '../store/canvasSlice/types';
import type { BlockEdge } from '../store/edgesSlice/types';

/**
 * Settings that are valid but almost certainly not what was meant: shown on the
 * selected block (Properties) and to AI agents (get_warnings).
 */

const MODE = /^0?([0-7]{3})$/;

// A directory needs x to be entered: every r without its x.
function directoryModeAdvice(block: BlockInstance): string | null {
  const mode = MODE.exec(block.params.mode?.trim() ?? '')?.[1];
  if (!mode) return null;
  const digits = [...mode].map(Number);
  const missing = digits.map((digit, index) => (digit & 4 && !(digit & 1) ? ['owner', 'group', 'others'][index] : null)).filter(Boolean);
  if (!missing.length) return null;
  const fixed = digits.map(digit => (digit & 4 ? digit | 1 : digit)).join('');
  return `Mode ${mode} lets ${missing.join(', ')} read the directory but not enter it (no x). Directories usually take ${fixed}.`;
}

// A restart or reload without an arrow that only lets it run on "repaired" runs on every agent run.
function restartAdvice(block: BlockInstance, edges: BlockEdge[]): string | null {
  if (block.params.action !== 'restart' && block.params.action !== 'reload') return null;
  const into = edges.filter(edge => edge.target === block.instanceId || (block.groupId && edge.target === block.groupId));
  if (into.some(edge => !edge.outcomes.includes('kept'))) return null;
  return `A ${block.params.action} with no arrow on "repaired" into it runs on every agent run (every 5 minutes). Connect it from what changes the service's config, on repaired only.`;
}

// The key a project ignores this advice by (dismissedAdvice).
export const PYTHON_ADVICE_KEY = 'python3';

export const PYTHON_ADVICE =
  'Its promise type runs with python3 on the host. If your hosts may not have it, add an Install Package block for python3 before this one.';

/** Whether a block's promise type needs Python on the host that no Install Package block in the project brings. */
export function needsPython(block: BlockInstance, canvas: BlockInstance[]): boolean {
  if (!requiredModule(block)) return false;
  const installs = (other: BlockInstance) =>
    other.blockId === 'install-package' && (other.params.package_name ?? '').split('\n').some(name => /^python3\b/.test(name.trim()));
  return !canvas.some(installs);
}

export function blockAdvice(block: BlockInstance | undefined, edges: BlockEdge[], canvas: BlockInstance[] = [], dismissed: string[] = []): string[] {
  if (!block) return [];
  const advice = [
    block.blockId === 'create-directory' ? directoryModeAdvice(block) : null,
    block.blockId === 'manage-service' ? restartAdvice(block, edges) : null,
    !dismissed.includes(PYTHON_ADVICE_KEY) && needsPython(block, canvas) ? PYTHON_ADVICE : null
  ];
  return advice.filter((item): item is string => item !== null);
}
