import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Answer, EDIT, READ_ONLY, REMOVE } from './shared';

/** Variables, classes, transformer chains and data-fed parameters (src/renderer/src/mcp/definitionTools.ts answers them). */

const caseRow = z.object({ className: z.string(), mode: z.enum(['if', 'unless']).optional(), value: z.string() });
const params = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), caseRow]))]))
  .describe('Parameter name → value, as list_value_sources / list_transformers list them. A cases parameter takes [{className, mode, value}] rows');

const condition = z
  .object({
    className: z.string().describe('A class expression: "debian", "linux.!redhat", a class this file defines, or "<ns>:name" for another file’s'),
    mode: z.enum(['if', 'unless'])
  })
  .nullable()
  .describe('Gates just this entry; null removes it');

const classRefs = z
  .array(z.object({ name: z.string().describe('As list_classes names it from this file, or a hard class'), negate: z.boolean().optional() }))
  .describe('combine-and / combine-or only: the classes combined (replaces the current ones)');

const inventoryAttribute = z
  .string()
  .nullable()
  .describe('Variables only: reports the value as this inventory attribute in Mission Portal (Enterprise); null removes it');

// Where a transformer chain lives: a Define Variable entry's value, or a parameter computed from data.
const chainTarget = {
  blockId: z.string(),
  entryId: z.string().optional().describe('A Define Variable entry'),
  param: z.string().optional().describe('Or: a parameter computed from data (bind_parameter)')
};

const position = z.number().int().optional().describe('0-based place in the chain; defaults to last');

export function registerDefinitionTools(server: McpServer, answer: Answer) {
  server.registerTool(
    'list_variables',
    {
      description:
        'Every variable the project defines (Define Variable entries): file, block, entry id, name, value source and what it reads, type after its transformers, conditions, inventory attribute, and how to reference it from the same file, another file and a Mustache template.',
      inputSchema: { fileId: z.string().optional().describe('Only this file’s') },
      annotations: READ_ONLY
    },
    answer('list_variables')
  );
  server.registerTool(
    'list_classes',
    {
      description:
        'Every class the project defines (Define Class entries) with how to reference it from the same file, another file and a Mustache template, plus the CFEngine hard classes usable bare anywhere.',
      inputSchema: { fileId: z.string().optional().describe('Only this file’s') },
      annotations: READ_ONLY
    },
    answer('list_classes')
  );
  server.registerTool(
    'list_bindings',
    {
      description:
        'Every block parameter computed from data instead of typed: its value source, parameters, transformer chain (with step ids) and result type.',
      inputSchema: { fileId: z.string().optional() },
      annotations: READ_ONLY
    },
    answer('list_bindings')
  );
  server.registerTool(
    'list_value_sources',
    {
      description:
        'How a Define Variable or Define Class entry gets its value: each value source’s id, parameters, what it produces, and whether it takes transformers, class refs or can feed a parameter (bind_parameter).',
      inputSchema: { blockType: z.enum(['define-variable', 'define-class']) },
      annotations: READ_ONLY
    },
    answer('list_value_sources')
  );
  server.registerTool(
    'list_transformers',
    {
      inputSchema: {},
      description:
        'The transformers (CFEngine functions) a computed value can be chained through: id, function, input → output type (string or list), parameters.',
      annotations: READ_ONLY
    },
    answer('list_transformers')
  );

  server.registerTool(
    'add_entry',
    {
      description:
        'Defines a variable or class in a Define Variable / Define Class block (add_block one first if needed; its blank first entry is filled). The name must be unique among the file’s variables (or classes). Returns the entry id and its references.',
      inputSchema: {
        blockId: z.string(),
        name: z.string().describe('Letters, digits and underscores'),
        valueSource: z.string().optional().describe('From list_value_sources; defaults to the first (literal / always true)'),
        params: params.optional(),
        classRefs: classRefs.optional(),
        condition: condition.optional(),
        inventoryAttribute: inventoryAttribute.optional()
      },
      annotations: EDIT
    },
    answer('add_entry')
  );
  server.registerTool(
    'update_entry',
    {
      description:
        'Changes a Define Variable / Define Class entry: name, value source, parameters (only those given), class refs, condition or inventory attribute. Switching to a source that takes no transformers drops the entry’s chain.',
      inputSchema: {
        blockId: z.string(),
        entryId: z.string(),
        name: z.string().optional(),
        valueSource: z.string().optional(),
        params: params.optional(),
        classRefs: classRefs.optional(),
        condition: condition.optional(),
        inventoryAttribute: inventoryAttribute.optional()
      },
      annotations: EDIT
    },
    answer('update_entry')
  );
  server.registerTool(
    'remove_entry',
    {
      description: 'Removes one variable or class from its block (a block keeps at least one: remove_block for the last).',
      inputSchema: { blockId: z.string(), entryId: z.string() },
      annotations: REMOVE
    },
    answer('remove_entry')
  );
  server.registerTool(
    'move_entry',
    {
      description: 'Moves an entry within its block (its order on the card and in the policy).',
      inputSchema: { blockId: z.string(), entryId: z.string(), toIndex: z.number().int().describe('0-based') },
      annotations: EDIT
    },
    answer('move_entry')
  );

  server.registerTool(
    'add_transformer',
    {
      description:
        'Adds a transformer step to a computed variable’s value (blockId + entryId) or a data-fed parameter (blockId + param). Each step must take what the step before produces (list_transformers). Returns the step id and the chain.',
      inputSchema: { ...chainTarget, transformer: z.string().describe('A transformer id, e.g. "split-list", "join"'), params: params.optional(), position },
      annotations: EDIT
    },
    answer('add_transformer')
  );
  server.registerTool(
    'update_transformer',
    {
      description: 'Changes a transformer step’s parameters (only those given) or moves it in its chain.',
      inputSchema: { ...chainTarget, transformerId: z.string().describe('The step id'), params: params.optional(), position },
      annotations: EDIT
    },
    answer('update_transformer')
  );
  server.registerTool(
    'remove_transformer',
    {
      description: 'Removes a transformer step, if the chain still fits together without it.',
      inputSchema: { ...chainTarget, transformerId: z.string() },
      annotations: REMOVE
    },
    answer('remove_transformer')
  );

  server.registerTool(
    'bind_parameter',
    {
      description:
        'Computes a block’s free-text parameter from data instead of typing it ("Compute from data"): a computed Define Variable value source (command output, file lines…), then optional transformers (add_transformer with param). Binding a bound parameter again changes its source or parameters and keeps its chain.',
      inputSchema: {
        blockId: z.string(),
        param: z.string(),
        valueSource: z.string().describe('A define-variable value source marked bindable in list_value_sources'),
        params: params.optional()
      },
      annotations: EDIT
    },
    answer('bind_parameter')
  );
  server.registerTool(
    'unbind_parameter',
    {
      description: 'Goes back to the parameter’s typed value, dropping its data chain.',
      inputSchema: { blockId: z.string(), param: z.string() },
      annotations: REMOVE
    },
    answer('unbind_parameter')
  );
}
