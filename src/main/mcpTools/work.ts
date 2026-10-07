import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Answer, EDIT } from './shared';

/** The agent's session in the app (src/renderer/src/mcp/workTools.ts): lock the editor while working, say what for. */
export function registerWorkTools(server: McpServer, answer: Answer) {
  server.registerTool(
    'begin_work',
    {
      description:
        'Call before you start changing the project: shows the user what you’re doing and locks the editor so they don’t edit while you work. Unlocks with end_work (or after 5 minutes without a call).',
      inputSchema: { task: z.string().describe('What you’re about to do, in one short sentence, e.g. “Adding an nginx web server”') },
      annotations: EDIT
    },
    answer('begin_work')
  );
  server.registerTool(
    'end_work',
    {
      description: 'Call when you’re done: unlocks the editor for the user.',
      inputSchema: { summary: z.string().optional().describe('What you did, in a sentence') },
      annotations: EDIT
    },
    answer('end_work')
  );
}
