// A cfbs module name for a project: lowercase letters, digits and single dashes, starting with a
// letter (cfbs validates a module project's name this way). "Web Server Hardening" → "web-server-hardening".
export function moduleNameFor(projectName: string): string {
  const slug = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  if (!slug) return 'policy';
  return /^[a-z]/.test(slug) ? slug : `policy-${slug}`;
}
