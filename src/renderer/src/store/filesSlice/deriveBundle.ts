import reserved from '@blocks/lib/reserved-bundles.json';

const FALLBACK_BUNDLE = 'file';

// Generated policy is in the default namespace, next to masterfiles: its
// bundle names are taken, and so are CFEngine's special-variable contexts.
const RESERVED_BUNDLES = new Set([...reserved.bundles, 'default', 'sys', 'const', 'mon', 'this', 'match', 'edit', 'vars', 'classes']);

/**
 * Derives a policy file's bundle name from its name at creation time — its
 * entry bundle, and the prefix of its other bundles (`<bundle>_vars`,
 * `<bundle>_<block>`). A one-time derivation: stored and never recomputed,
 * even if the file is later renamed. Unique project-wide, starts with a
 * letter, never a masterfiles bundle or another file's `_vars` bundle.
 */
export function deriveBundle(name: string, existingBundles: string[] = []): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || FALLBACK_BUNDLE;
  const base = /^[a-z]/.test(slug) ? slug : `${FALLBACK_BUNDLE}_${slug}`;
  // Every file also owns `<bundle>_vars`, so neither name may meet another file's.
  const taken = new Set([...RESERVED_BUNDLES, ...existingBundles.flatMap(bundle => [bundle, `${bundle}_vars`])]);
  const isFree = (candidate: string) => !taken.has(candidate) && !taken.has(`${candidate}_vars`);
  if (isFree(base)) return base;
  let suffix = 2;
  while (!isFree(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}
