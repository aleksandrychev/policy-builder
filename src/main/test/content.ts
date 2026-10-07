import type { ProjectContent } from '../../preload/api';

/**
 * Hand-made builder content, shaped like the renderer's toCfbsProject (which needs Vite's
 * import.meta.glob of blocks/, so doesn't load here): files of Report Message blocks.
 */

export interface FileSpec {
  description?: string;
  // Each a Report Message block printing it.
  messages: string[];
  name: string;
  namespace: string;
  path: string;
}

const OUTPUT_DIR = 'services/cfbs/';
const layout = { positions: {}, groups: [], derived_positions: {} };

export const fileMeta = ({ description, messages, name, namespace, path }: FileSpec) => {
  const blocks = messages.map((message, index) => ({ blockId: 'report-message', instanceId: `${namespace}-${index}`, label: message, params: { message } }));
  return {
    id: `file-${namespace}`,
    name,
    namespace,
    path,
    ...(description ? { description } : {}),
    blocks,
    edges: [],
    groups: [],
    order: blocks.map(block => block.instanceId),
    layout
  };
};

const moduleNameOf = (path: string) => {
  const parts = path.slice(2).split('/');
  return parts.length === 1 ? path : `./${parts[0]}/`;
};

/** The project's content: .policy-builder/project.json, its cfbs build modules and provided module. */
export function builderContent(
  files: FileSpec[],
  testEnvironments: object[] = [],
  moduleName = 'web-demo'
): ProjectContent & { project: { [key: string]: unknown; files: object[] } } {
  const modules = new Map<string, string[]>();
  for (const file of files) modules.set(moduleNameOf(file.path), [...(modules.get(moduleNameOf(file.path)) ?? []), `${file.namespace}:main`]);
  const folders = [...new Set(files.map(file => moduleNameOf(file.path)).filter(name => name.endsWith('/')))];
  const output = `${OUTPUT_DIR}${moduleName}/`;
  return {
    project: {
      schema_version: 2,
      name: 'Web Demo',
      module_name: moduleName,
      folders: folders.map(path => ({ id: `folder-${path}`, name: path.slice(2, -1), parentId: null, path })),
      files: files.map(fileMeta),
      current_file_id: files.length ? `file-${files[0].namespace}` : null
    },
    modules: [...modules].map(([name, bundles]) => {
      const isDirectory = name.endsWith('/');
      return {
        name,
        description: isDirectory ? 'Local subdirectory added using cfbs command line' : 'Local policy file added using cfbs command line',
        tags: ['local'],
        added_by: 'cfbs add',
        steps: [
          isDirectory ? `directory ./ ${OUTPUT_DIR}${name.slice(2)}` : `copy ${name} ${OUTPUT_DIR}${name.slice(2)}`,
          `policy_files ${OUTPUT_DIR}${name.slice(2)}`,
          `bundles ${bundles.join(' ')}`
        ]
      };
    }),
    provided: {
      description: 'Policy built with CFEngine Policy Builder',
      tags: ['policy-builder'],
      steps: [
        ...[...modules.keys()].map(name => `copy ${name} ${output}${name.slice(2)}`),
        `policy_files ${output}`,
        `bundles ${[...modules.values()].flat().join(' ')}`
      ]
    },
    testEnvironments
  };
}

export const mainFile: FileSpec = { name: 'Main', namespace: 'main', path: './main.cf', description: 'Says hello on every host.', messages: ['hello'] };
export const webFile: FileSpec = { name: 'Web', namespace: 'web', path: './services/web.cf', messages: ['web', 'server'] };

// What the renderer's environmentsFrom keeps.
export const debianEnvironment = {
  id: 'env-1',
  name: 'Debian',
  arch: 'x86_64',
  edition: 'community',
  version: 'latest',
  hub: 'host-1',
  env: {},
  envFile: './.env',
  hosts: [{ id: 'host-1', name: 'hub', platform: 'debian-12', ports: [], env: {} }]
};
