import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Answer, EDIT, READ_ONLY, REMOVE } from './shared';

/** The project, its files and folders, and groups (src/renderer/src/mcp/projectTools.ts answers them). */

const condition = (what: string) =>
  z
    .object({
      className: z.string().describe('A class expression, e.g. "debian", "linux.!redhat", or "common:webserver_role" for a class another file defines'),
      mode: z.enum(['if', 'unless'])
    })
    .nullable()
    .describe(`Gates ${what}; null removes the condition`);

const absolutePath = (what: string) => z.string().describe(`${what}, an absolute path`);
const discardChanges = z
  .boolean()
  .optional()
  .describe('Required (true) when the open project has unsaved changes: they are lost. Ask the user, or call save_project first.');

export function registerProjectTools(server: McpServer, answer: Answer) {
  server.registerTool(
    'get_project_status',
    {
      inputSchema: {},
      description:
        'Whether a project is open, and if so its name, folder (path, null while it has never been saved), type (policy-set or module), masterfiles version, whether it has unsaved changes, and how many files and folders it has.',
      annotations: READ_ONLY
    },
    answer('get_project_status')
  );
  server.registerTool(
    'create_project',
    {
      description:
        'Creates a CFEngine project on disk (cfbs init in <parent>/<folder named after the project>) and opens it, with one policy file named after the project. Refused while the open project has unsaved changes unless discardChanges is true. Returns the new project’s path.',
      inputSchema: {
        name: z.string().describe('The project name; it also becomes the first policy file’s namespace and can’t be changed later'),
        parent: absolutePath('The folder to create the project folder in'),
        description: z.string().optional(),
        type: z
          .enum(['policy-set', 'module'])
          .optional()
          .describe('policy-set (default): masterfiles plus this project, deployable as is; module: added to other policy sets with cfbs add'),
        masterfiles: z
          .enum(['latest', 'master'])
          .optional()
          .describe('For a policy set: the latest masterfiles release (default) or the master branch. Downloaded, so it needs the network.'),
        git: z.boolean().optional().describe('Initialize a git repository with one commit (default true)'),
        discardChanges
      },
      annotations: EDIT
    },
    answer('create_project')
  );
  server.registerTool(
    'open_project',
    {
      description: 'Opens a project folder (one with a cfbs.json). Refused while the open project has unsaved changes unless discardChanges is true.',
      inputSchema: { path: absolutePath('The project folder'), discardChanges },
      annotations: EDIT
    },
    answer('open_project')
  );
  server.registerTool(
    'save_project',
    {
      description:
        'Saves the open project: generates its .cf files and cfbs.json from the blocks. A project never saved (get_project_status path null, e.g. the demo) needs parent, and is created as <parent>/<folderName> as a cfbs project. Returns the path.',
      inputSchema: {
        parent: absolutePath('Only for a project never saved: the folder to create the project folder in').optional(),
        folderName: z.string().optional().describe('Only for a project never saved: defaults to one derived from the name'),
        name: z.string().optional().describe('Only for a project never saved: defaults to the current project name'),
        git: z.boolean().optional().describe('Only for a project never saved: initialize a git repository (default true)')
      },
      annotations: EDIT
    },
    answer('save_project')
  );

  server.registerTool(
    'add_file',
    {
      description:
        'Adds a policy file (opened on the canvas). Its namespace derives from the name once and never changes. Returns its id, name (made unique among its siblings) and namespace.',
      inputSchema: {
        name: z.string().describe('Without .cf'),
        folderId: z.string().optional().describe('A folder from add_folder or get_project_overview; the project root by default')
      },
      annotations: EDIT
    },
    answer('add_file')
  );
  server.registerTool(
    'rename_file',
    {
      description: 'Renames a policy file. Its namespace (and so references to its classes and variables) stays as it is.',
      inputSchema: { fileId: z.string(), name: z.string().describe('Without .cf') },
      annotations: EDIT
    },
    answer('rename_file')
  );
  server.registerTool(
    'remove_file',
    {
      description: 'Removes a policy file with all its blocks, arrows and groups. A project keeps at least one file.',
      inputSchema: { fileId: z.string() },
      annotations: REMOVE
    },
    answer('remove_file')
  );
  server.registerTool(
    'add_folder',
    {
      description: 'Adds a folder for policy files. A top-level folder becomes a cfbs module directory of its own. Returns its id and name.',
      inputSchema: { name: z.string(), parentId: z.string().optional().describe('A folder to nest it in; the project root by default') },
      annotations: EDIT
    },
    answer('add_folder')
  );
  server.registerTool(
    'set_file_description',
    {
      description: 'Sets what a policy file is for (shown on hovering its name); an empty description removes it.',
      inputSchema: { fileId: z.string(), description: z.string() },
      annotations: EDIT
    },
    answer('set_file_description')
  );
  server.registerTool(
    'set_file_condition',
    {
      description: 'Gates a whole policy file (every block, variable and class in it) on a class expression.',
      inputSchema: { fileId: z.string(), condition: condition('the file') },
      annotations: EDIT
    },
    answer('set_file_condition')
  );

  server.registerTool(
    'group_blocks',
    {
      description:
        'Groups blocks of one file: they compile into a bundle of their own, run as one step that arrows and a condition can gate. Arrows between members and the rest re-attach to the group’s frame; refused if that would close a loop. A block already in a group moves to the new one. Returns the group id.',
      inputSchema: {
        blockIds: z.array(z.string()).min(1),
        name: z.string().optional().describe('Defaults to "Group <n>"')
      },
      annotations: EDIT
    },
    answer('group_blocks')
  );
  server.registerTool(
    'ungroup',
    {
      description: 'Removes a group’s frame; its blocks stay, and arrows to and from the group go to its blocks instead.',
      inputSchema: { groupId: z.string() },
      annotations: EDIT
    },
    answer('ungroup')
  );
  server.registerTool(
    'set_group_condition',
    {
      description: 'Gates a group (all its blocks, as one step) on a class expression.',
      inputSchema: { groupId: z.string(), condition: condition('the group') },
      annotations: EDIT
    },
    answer('set_group_condition')
  );
}
