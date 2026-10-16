import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Answer, EDIT, READ_ONLY, REMOVE } from './shared';

/** CFEngine Build modules (build.cfengine.com) in a policy set (src/renderer/src/mcp/moduleTools.ts answers them). */

const name = z.string().describe('A module name from search_modules, e.g. "delete-files"');

export function registerModuleTools(server: McpServer, answer: Answer) {
  server.registerTool(
    'search_modules',
    {
      inputSchema: {
        query: z.string().optional().describe('Words in the name, description or tags (also old names); omitted: all'),
        tag: z.string().optional().describe('Only modules with this tag, e.g. "security", "inventory", "compliance", "promise-type", "library"'),
        supportedOnly: z.boolean().optional().describe('Only modules tagged supported')
      },
      description:
        'Searches the CFEngine Build index (build.cfengine.com): ready-made modules for inventory, compliance, hardening, configured tasks (delete files, allow hosts…) and promise types (git, systemd, http…). Each: name, kind (policy | configured: takes input | promise-type | library), version, description, tags, experimental, inProject. Check here before building something from blocks.',
      annotations: READ_ONLY
    },
    answer('search_modules')
  );
  server.registerTool(
    'get_module',
    {
      inputSchema: { name },
      description:
        'One module: kind, version, author, source, dependencies, its input questions (variable, type text | list, a list’s fields; answered or not in the project), its README as text, and in the project: addedFor (a dependency), needsInput, usedBy (blocks using its promise type).',
      annotations: READ_ONLY
    },
    answer('get_module')
  );
  server.registerTool(
    'add_module',
    {
      inputSchema: { name },
      description:
        'Adds a module (and its dependencies) to the project, a policy set; one undo step. Saving installs it with cfbs (needs the internet once). Modules run before the project’s own policy. A module with input asks for it: answer with set_module_input.',
      annotations: EDIT
    },
    answer('add_module')
  );
  server.registerTool(
    'set_module_input',
    {
      inputSchema: {
        name,
        variable: z.string().describe('The question’s variable, from get_module'),
        response: z
          .union([z.string(), z.array(z.string()), z.array(z.record(z.string(), z.string()))])
          .describe('Text; for a list, its entries: texts, or objects keyed by the list’s fields (e.g. [{"path": "/etc/x", "why": "…"}]). Replaces the answer.')
      },
      description: 'Answers one of a module’s input questions (saved as <module>/input.json, which cfbs turns into augments). One undo step.',
      annotations: EDIT
    },
    answer('set_module_input')
  );
  server.registerTool(
    'remove_module',
    {
      inputSchema: { name },
      description:
        'Removes a module from the project, with the dependencies nothing else needs. Refused for a dependency, or while blocks use its promise type. Saving uninstalls it.',
      annotations: REMOVE
    },
    answer('remove_module')
  );
}
