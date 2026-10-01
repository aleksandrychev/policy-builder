import type { BlockDescriptor } from './types';

// Eagerly loaded — the built-in set is small and static, so there's no
// benefit to lazy-loading each descriptor separately. blocks/schemas/ and
// blocks/README.md are excluded by the *.json glob at blocks/'s top level
// (schemas/ is a subdirectory, README.md isn't JSON).
const modules = import.meta.glob('@blocks/*.json', { eager: true }) as Record<string, { default: BlockDescriptor }>;

// The palette groups categories in this order rather than alphabetically —
// frequency of use matters more than the alphabet: Commands sits right
// after Packages since both are common day-one blocks, while Methods (just
// Call Method, an escape hatch for bundles outside the canvas) sorts last.
// A category missing from this list falls back to alphabetical order after
// the ones listed here.
const CATEGORY_ORDER = [
  'Files',
  'File Contents',
  'Variables & Classes',
  'Packages',
  'Commands',
  'Services',
  'Users',
  'Storage',
  'Reports',
  'Processes',
  'Methods'
];

function categoryRank(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

// Only schema_version 1 exists; anything else is skipped rather than misread.
function isSupported(descriptor: BlockDescriptor): boolean {
  if (descriptor.schema_version === 1) return true;
  console.error(`Block "${descriptor.id}": unsupported schema_version ${String(descriptor.schema_version)}`);
  return false;
}

export const blockDescriptors: BlockDescriptor[] = Object.values(modules)
  .map(module => module.default)
  .filter(isSupported)
  .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.name.localeCompare(b.name));

export const blockDescriptorsById: Map<string, BlockDescriptor> = new Map(blockDescriptors.map(block => [block.id, block]));

export function groupBlocksByCategory(blocks: BlockDescriptor[]): Map<string, BlockDescriptor[]> {
  const groups = new Map<string, BlockDescriptor[]>();
  for (const block of blocks) {
    const group = groups.get(block.category);
    if (group) group.push(block);
    else groups.set(block.category, [block]);
  }
  return groups;
}
