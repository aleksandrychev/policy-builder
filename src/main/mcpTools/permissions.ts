import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * What the user lets AI agents do (Connect an AI agent): groups of tools, plus
 * deleting across them. A tool that's off isn't listed, and isn't run if called.
 */

export interface McpPermissions {
  // Removing project content: blocks, arrows, entries, transformer steps, bindings, files, environments.
  delete: boolean;
  edit: boolean;
  files: boolean;
  projects: boolean;
  testing: boolean;
}

type Group = 'edit' | 'files' | 'projects' | 'read' | 'testing';

export const DEFAULT_PERMISSIONS: McpPermissions = { delete: true, edit: true, files: true, projects: true, testing: true };

const GROUP_OF: Record<string, Group> = {
  get_project_status: 'read',
  get_project_overview: 'read',
  get_file: 'read',
  list_block_types: 'read',
  get_block_type: 'read',
  get_generated_policy: 'read',
  get_warnings: 'read',
  list_variables: 'read',
  list_classes: 'read',
  list_bindings: 'read',
  list_value_sources: 'read',
  list_transformers: 'read',
  get_docker_status: 'read',
  list_test_platforms: 'read',
  get_test_environments: 'read',
  get_test_results: 'read',

  add_block: 'edit',
  update_block: 'edit',
  remove_block: 'edit',
  connect: 'edit',
  disconnect: 'edit',
  tidy_file: 'edit',
  group_blocks: 'edit',
  ungroup: 'edit',
  set_group_condition: 'edit',
  add_entry: 'edit',
  update_entry: 'edit',
  remove_entry: 'edit',
  move_entry: 'edit',
  add_transformer: 'edit',
  update_transformer: 'edit',
  remove_transformer: 'edit',
  bind_parameter: 'edit',
  unbind_parameter: 'edit',

  add_file: 'files',
  rename_file: 'files',
  remove_file: 'files',
  add_folder: 'files',
  set_file_description: 'files',
  set_file_condition: 'files',

  create_project: 'projects',
  open_project: 'projects',
  save_project: 'projects',

  set_test_environment: 'testing',
  remove_test_environment: 'testing',
  run_tests: 'testing',
  stop_test_environment: 'testing'
};

// Tools that remove project content, whatever their group.
const DELETES = new Set(['remove_block', 'disconnect', 'remove_entry', 'remove_transformer', 'unbind_parameter', 'remove_file', 'remove_test_environment']);

export const knownTool = (name: string) => name in GROUP_OF;

export function isToolAllowed(name: string, permissions: McpPermissions): boolean {
  const group = GROUP_OF[name];
  if (!group) return false;
  if (DELETES.has(name) && !permissions.delete) return false;
  return group === 'read' || permissions[group];
}

// Only what's allowed gets registered, so agents don't see the rest.
export function gatedServer(server: McpServer, permissions: McpPermissions): McpServer {
  const registerTool = ((name: string, ...rest: unknown[]) =>
    isToolAllowed(name, permissions) ? (server.registerTool as (...args: unknown[]) => unknown)(name, ...rest) : undefined) as McpServer['registerTool'];
  return { registerTool } as McpServer;
}

export function checkedPermissions(value: unknown): McpPermissions {
  const given = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const flag = (key: keyof McpPermissions) => (typeof given[key] === 'boolean' ? (given[key] as boolean) : DEFAULT_PERMISSIONS[key]);
  return { delete: flag('delete'), edit: flag('edit'), files: flag('files'), projects: flag('projects'), testing: flag('testing') };
}
