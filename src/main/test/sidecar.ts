import { existsSync, promises as fs } from 'fs';
import { join, resolve } from 'path';

const repoRoot = resolve(__dirname, '../../..');

/**
 * Points backend.ts at python/.venv (the current source, never a stale PyInstaller bundle):
 * a wrapper script where resolveCommand looks when packaged. Mock `app.isPackaged` as true.
 */
export async function useVenvSidecar(resources: string): Promise<void> {
  const python = join(repoRoot, 'python/.venv/bin/python');
  if (!existsSync(python)) throw new Error(`No sidecar virtualenv at ${python}: run \`npm run backend:sync\``);
  await fs.mkdir(join(resources, 'backend'), { recursive: true });
  await fs.writeFile(join(resources, 'backend', 'cfpb-backend'), `#!/bin/sh\nexec '${python}' -m cfpb_backend "$@"\n`, { mode: 0o755 });
  Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true });
}
