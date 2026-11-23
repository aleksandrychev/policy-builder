/** The repository's https URL, as the index wants `repo`: from an https, ssh:// or scp-like (git@host:org/repo) remote. */
export function httpsRepoUrl(remote: string | null | undefined): string | null {
  if (!remote) return null;
  const url = remote
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  const https = url.match(/^https:\/\/(?:[^@/]+@)?([^/]+\/.+)$/);
  if (https) return `https://${https[1]}`;
  const ssh = url.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/) ?? url.match(/^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/);
  return ssh ? `https://${ssh[1]}/${ssh[2]}` : null;
}

/**
 * The module's entry for build-index's cfbs.json: the saved cfbs.json's `provides` entry, plus
 * where its source is, in the index's key order.
 */
export function indexEntry(
  name: string,
  provided: Record<string, unknown>,
  source: { by: string; commit: string; repo: string; version: string }
): Record<string, unknown> {
  const { description, tags, version: _version, ...rest } = provided;
  return { [name]: { description, tags, repo: source.repo, by: source.by, version: source.version, commit: source.commit, ...rest } };
}
