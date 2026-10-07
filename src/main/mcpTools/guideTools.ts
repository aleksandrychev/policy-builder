import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { GUIDE, GUIDE_TOPICS, guideIndex } from './guide';
import { READ_ONLY } from './shared';

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

/** The guide as a tool (any client), as resources (guide://<topic>) and as a prompt that starts a task with it. */
export function registerGuide(server: McpServer, tools: McpServer) {
  tools.registerTool(
    'get_guide',
    {
      description: `How to work in Policy Builder well: the workflow, when to tidy, references, conditions, testing, pitfalls. Read "workflow" before your first change. Topics:\n${guideIndex()}`,
      inputSchema: { topic: z.enum(GUIDE_TOPICS).optional().describe('Leave out for the workflow and the list of topics') },
      annotations: READ_ONLY
    },
    async ({ topic }) => text(topic ? GUIDE[topic].text : `${GUIDE.workflow.text}\n\n## Topics\n${guideIndex()}`)
  );

  for (const [topic, page] of Object.entries(GUIDE)) {
    server.registerResource(topic, `guide://${topic}`, { title: page.title, description: page.summary, mimeType: 'text/markdown' }, async uri => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: page.text }]
    }));
  }

  server.registerPrompt(
    'build_policy',
    {
      title: 'Build policy in Policy Builder',
      description: 'Start a task in CFEngine Policy Builder with its working guide loaded',
      argsSchema: { task: z.string().describe('What to build or change') }
    },
    ({ task }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `${GUIDE.workflow.text}\n\n${GUIDE.pitfalls.text}\n\nMore topics with get_guide: ${GUIDE_TOPICS.join(', ')}.\n\nTask: ${task}`
          }
        }
      ]
    })
  );
}
