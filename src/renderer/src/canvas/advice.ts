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

export function blockAdvice(block: BlockInstance | undefined, edges: BlockEdge[]): string[] {
  if (!block) return [];
  const advice = [
    block.blockId === 'create-directory' ? directoryModeAdvice(block) : null,
    block.blockId === 'manage-service' ? restartAdvice(block, edges) : null
  ];
  return advice.filter((item): item is string => item !== null);
}
