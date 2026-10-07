const FALLBACK_NAMESPACE = 'file';

// CFEngine's own namespace, and special-variable contexts a namespace of the same name would shadow.
const RESERVED_NAMESPACES = new Set(['default', 'sys', 'const', 'mon', 'this', 'match', 'edit', 'vars', 'classes', 'def']);

/**
 * Derives a policy file's namespace (and its ./<namespace>.cf name) from its name at creation
 * time; stored, never recomputed on rename. Unique project-wide, starts with a letter, never reserved.
 */
export function deriveNamespace(name: string, existingNamespaces: string[] = []): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || FALLBACK_NAMESPACE;
  const base = /^[a-z]/.test(slug) ? slug : `${FALLBACK_NAMESPACE}_${slug}`;
  const taken = new Set(existingNamespaces);
  const isFree = (candidate: string) => !taken.has(candidate) && !RESERVED_NAMESPACES.has(candidate);
  if (isFree(base)) return base;
  let suffix = 2;
  while (!isFree(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}
