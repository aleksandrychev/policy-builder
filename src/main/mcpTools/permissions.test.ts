import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import { registerBuilderTools } from './index';
import { DEFAULT_PERMISSIONS, type McpPermissions, checkedPermissions, isToolAllowed, knownTool } from './permissions';

// The tools an agent is offered under these permissions.
function offered(permissions: McpPermissions): string[] {
  const names: string[] = [];
  const server = {
    registerTool: (name: string) => names.push(name),
    registerResource: () => undefined,
    registerPrompt: () => undefined
  } as unknown as McpServer;
  registerBuilderTools(server, async () => '', permissions);
  return names;
}

const none: McpPermissions = { delete: false, edit: false, files: false, projects: false, testing: false };

describe('MCP permissions', () => {
  it('puts every tool in a group', () => {
    expect(offered(DEFAULT_PERMISSIONS).filter(name => !knownTool(name))).toEqual([]);
  });

  it('offers everything by default', () => {
    const names = offered(DEFAULT_PERMISSIONS);
    expect(names).toHaveLength(new Set(names).size);
    for (const name of ['create_project', 'add_file', 'add_block', 'remove_block', 'run_tests', 'get_project_overview', 'get_guide', 'begin_work'])
      expect(names).toContain(name);
  });

  it('always offers reading, and nothing else when every group is off', () => {
    const names = offered(none);
    expect(names).toContain('get_project_overview');
    expect(names).toContain('get_test_results');
    expect(names.some(name => /^(add|remove|update|create|save|run|set)_/.test(name))).toBe(false);
  });

  it('hides a group that is off', () => {
    const names = offered({ ...DEFAULT_PERMISSIONS, testing: false, projects: false });
    expect(names).not.toContain('run_tests');
    expect(names).not.toContain('create_project');
    expect(names).toContain('add_block');
  });

  it('keeps editing but not deleting', () => {
    const names = offered({ ...DEFAULT_PERMISSIONS, delete: false });
    expect(names).toContain('add_block');
    for (const removal of ['remove_block', 'disconnect', 'remove_entry', 'remove_transformer', 'unbind_parameter', 'remove_file', 'remove_test_environment']) {
      expect(names).not.toContain(removal);
    }
    // Stopping test hosts isn't removing project content.
    expect(names).toContain('stop_test_environment');
  });

  it('refuses unknown tools and reads saved permissions safely', () => {
    expect(isToolAllowed('no_such_tool', DEFAULT_PERMISSIONS)).toBe(false);
    expect(checkedPermissions({ edit: false, testing: 'yes' })).toEqual({ ...DEFAULT_PERMISSIONS, edit: false });
    expect(checkedPermissions(null)).toEqual(DEFAULT_PERMISSIONS);
  });
});
