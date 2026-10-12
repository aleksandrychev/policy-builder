import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Answer, EDIT, READ_ONLY, REMOVE } from './shared';

/** The open file's blocks and arrows (src/renderer/src/mcp/canvasTools.ts answers them). */

const condition = z
  .object({
    className: z.string().describe('A class expression, e.g. "debian", "linux.!redhat", or "common:webserver_role" for a class another file defines'),
    mode: z.enum(['if', 'unless'])
  })
  .nullable()
  .describe('Gates the block; null removes the condition');

const note = z
  .string()
  .describe(
    'Why the block is there, or a decision behind it (e.g. “daily, not weekly: the old run took too long”): shown in Properties, compiled to the promise’s comment'
  );

const outcomes = z
  .array(z.enum(['kept', 'repaired', 'not_kept']))
  .optional()
  .describe('When the arrow lets the block run: after the source was kept, repaired or not_kept (default kept + repaired)');

// A block as add_block and add_blocks take it.
const newBlock = {
  fileId: z.string(),
  blockType: z.string(),
  label: z.string().optional().describe('Defaults to the block type’s name'),
  note: note.optional(),
  params: z.record(z.string(), z.string()).optional().describe('Parameter name → value, as get_block_type lists them'),
  condition: condition.optional(),
  groupId: z.string().optional().describe('A group of the same file to put the block in (get_file lists them)'),
  after: z
    .union([z.string(), z.number().int().min(0)])
    .optional()
    .describe('Adds an arrow into the new block from this block or group id (in add_blocks also the index of an earlier block in the list)'),
  outcomes
};

export function registerCanvasTools(server: McpServer, answer: Answer) {
  server.registerTool(
    'get_project_overview',
    {
      inputSchema: {},
      description:
        'The open project: its policy files (id, name, namespace, folder, condition, description, how many blocks of each type, groups), the open file and the selected block.',
      annotations: READ_ONLY
    },
    answer('get_project_overview')
  );
  server.registerTool(
    'get_file',
    {
      description:
        'One policy file in full: its blocks (id, label, type, parameters, value source, entries, condition, group), arrows and groups, in run order.',
      inputSchema: { fileId: z.string() },
      annotations: READ_ONLY
    },
    answer('get_file')
  );
  server.registerTool(
    'list_block_types',
    { inputSchema: {}, description: 'Every block type that can be added: id, name, category and a one-line description.', annotations: READ_ONLY },
    answer('list_block_types')
  );
  server.registerTool(
    'get_block_type',
    {
      description: 'One block type: its parameters (name, label, type, options, default, required, help), value sources and whether it takes arrows.',
      inputSchema: { blockType: z.string().describe('A block type id from list_block_types, e.g. "install-package"') },
      annotations: READ_ONLY
    },
    answer('get_block_type')
  );
  server.registerTool(
    'get_generated_policy',
    {
      description:
        'The CFEngine policy a file compiles to, exactly as saving would write it, with the line ranges each block produced. Without fileId: every generated file (policy files and templates) by path.',
      inputSchema: { fileId: z.string().optional() },
      annotations: READ_ONLY
    },
    answer('get_generated_policy')
  );
  server.registerTool(
    'get_warnings',
    {
      inputSchema: {},
      description:
        'What the editor flags in the project: blocks with required parameters left empty, values a parameter doesn’t accept (an option it doesn’t have, a relative path, wrong characters), and blocks or entries the generated policy leaves out (notCompiled, with why: e.g. an invalid class expression). Run it after editing, before saving.',
      annotations: READ_ONLY
    },
    answer('get_warnings')
  );

  server.registerTool(
    'add_block',
    {
      description:
        'Adds a block to a file (opened on the canvas), below its lowest block, with its condition, group and an arrow into it if given: one undo step. Parameters not given keep their defaults. Returns the new block’s id. For several blocks, use add_blocks.',
      inputSchema: newBlock,
      annotations: EDIT
    },
    answer('add_block')
  );
  server.registerTool(
    'add_blocks',
    {
      description:
        'Adds several blocks in one call and one undo step, each as add_block takes it. after can also be the index of an earlier block in the same list, to chain them. Every block is checked first: if one is invalid, nothing is added and the error names it (blocks[i]). Returns their ids in order.',
      inputSchema: { blocks: z.array(z.object(newBlock)).min(1).max(50) },
      annotations: EDIT
    },
    answer('add_blocks')
  );
  server.registerTool(
    'update_block',
    {
      description: 'Changes a block’s label, note, parameters (only those given) or condition.',
      inputSchema: {
        blockId: z.string(),
        label: z.string().optional(),
        note: note.optional().describe('Empty removes it'),
        params: z.record(z.string(), z.string()).optional(),
        condition: condition.optional()
      },
      annotations: EDIT
    },
    answer('update_block')
  );
  server.registerTool(
    'remove_block',
    { description: 'Removes a block and its arrows.', inputSchema: { blockId: z.string() }, annotations: REMOVE },
    answer('remove_block')
  );
  server.registerTool(
    'connect',
    {
      description:
        'Draws an arrow: the target runs after the source ends with one of the outcomes. Both must be blocks (not Define Variable / Define Class) or groups in the same file and the same group, and the arrow may not close a loop.',
      inputSchema: {
        sourceId: z.string(),
        targetId: z.string(),
        outcomes: z
          .array(z.enum(['kept', 'repaired', 'not_kept']))
          .optional()
          .describe('Defaults to kept and repaired')
      },
      annotations: EDIT
    },
    answer('connect')
  );
  server.registerTool(
    'tidy_file',
    {
      description:
        'Lays a file’s blocks out like the canvas’s Tidy button: in run order, data and condition nodes back beside their blocks, group frames refitted. One undo step. Use after adding several blocks.',
      inputSchema: { fileId: z.string() },
      annotations: EDIT
    },
    answer('tidy_file')
  );
  server.registerTool(
    'disconnect',
    { description: 'Removes the arrow between two blocks or groups.', inputSchema: { sourceId: z.string(), targetId: z.string() }, annotations: REMOVE },
    answer('disconnect')
  );
}
