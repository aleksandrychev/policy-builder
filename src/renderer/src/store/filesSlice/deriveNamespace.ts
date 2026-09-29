const FALLBACK_NAMESPACE = 'file';

// "default" is CFEngine's own namespace; the rest are special-variable
// contexts a namespace of the same name would shadow or confuse.
const RESERVED_NAMESPACES = new Set(['default', 'sys', 'const', 'mon', 'this', 'match', 'edit', 'vars', 'classes']);

/**
 * Derives a policy file's namespace from its name at creation time. Per
 * architecture-plan.md, this is a one-time derivation — the result is
 * stored and never recomputed, even if the file is later renamed.
 * Unique project-wide (case-insensitive after slugging), never empty, never reserved.
 */
export function deriveNamespace(name: string, existingNamespaces: string[] = []): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || FALLBACK_NAMESPACE;
  const taken = new Set(existingNamespaces);
  const isFree = (candidate: string) => !taken.has(candidate) && !RESERVED_NAMESPACES.has(candidate);
  if (isFree(slug)) return slug;
  let suffix = 2;
  while (!isFree(`${slug}_${suffix}`)) suffix += 1;
  return `${slug}_${suffix}`;
}
