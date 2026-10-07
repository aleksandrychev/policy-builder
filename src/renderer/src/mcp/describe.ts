import { blockDescriptorsById } from '../blocks/loadBlocks';
import type { RootState } from '../store';

/** A tool call as a log line in plain words, naming files and blocks rather than their ids. */

type Input = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function namer(state: RootState) {
  const file = (id: unknown) => state.files.files.find(item => item.id === id)?.name ?? 'a file';
  const block = (id: unknown) => {
    const found = state.canvas.find(item => item.instanceId === id) ?? state.groups.find(item => item.id === id);
    return found ? `“${'label' in found ? found.label : found.name}”` : 'a block';
  };
  const type = (id: unknown) => blockDescriptorsById.get(text(id))?.name ?? text(id);
  return { file, block, type };
}

export function describeCall(tool: string, input: Input, state: RootState): string {
  const { block, file, type } = namer(state);
  const target = input.entryId ? `an entry of ${block(input.blockId)}` : input.param ? `${text(input.param)} of ${block(input.blockId)}` : block(input.blockId);
  const lines: Record<string, () => string> = {
    begin_work: () => `Started: ${text(input.task)}`,
    end_work: () => `Finished${input.summary ? `: ${text(input.summary)}` : ''}`,
    get_project_status: () => 'Checked the project',
    get_project_overview: () => 'Read the project overview',
    get_file: () => `Read ${file(input.fileId)}`,
    list_block_types: () => 'Listed block types',
    get_block_type: () => `Looked up ${type(input.blockType)}`,
    get_generated_policy: () => (input.fileId ? `Read the generated policy of ${file(input.fileId)}` : 'Read the generated policy'),
    get_warnings: () => 'Checked the editor’s warnings',
    list_variables: () => 'Listed variables',
    list_classes: () => 'Listed classes',
    list_bindings: () => 'Listed computed parameters',
    list_value_sources: () => `Looked up the value sources of ${type(input.blockType)}`,
    list_transformers: () => 'Listed transformers',
    create_project: () => `Create project “${text(input.name)}”`,
    open_project: () => `Open ${text(input.path)}`,
    save_project: () => 'Save the project',
    add_file: () => `Add file “${text(input.name)}”`,
    rename_file: () => `Rename ${file(input.fileId)} to “${text(input.name)}”`,
    remove_file: () => `Remove ${file(input.fileId)}`,
    add_folder: () => `Add folder “${text(input.name)}”`,
    set_file_description: () => `Describe ${file(input.fileId)}`,
    set_file_condition: () => `Set the condition of ${file(input.fileId)}`,
    add_block: () => `Add ${type(input.blockType)} “${text(input.label) || type(input.blockType)}” to ${file(input.fileId)}`,
    update_block: () => `Change ${block(input.blockId)}`,
    remove_block: () => `Remove ${block(input.blockId)}`,
    connect: () => `Connect ${block(input.sourceId)} → ${block(input.targetId)}`,
    disconnect: () => `Disconnect ${block(input.sourceId)} → ${block(input.targetId)}`,
    tidy_file: () => `Tidy ${file(input.fileId)}`,
    group_blocks: () => `Group ${Array.isArray(input.blockIds) ? input.blockIds.length : ''} blocks${input.name ? ` as “${text(input.name)}”` : ''}`,
    ungroup: () => `Ungroup ${block(input.groupId)}`,
    set_group_condition: () => `Set the condition of ${block(input.groupId)}`,
    add_entry: () => `Add “${text(input.name)}” to ${block(input.blockId)}`,
    update_entry: () => `Change ${target}`,
    remove_entry: () => `Remove ${target}`,
    move_entry: () => `Move ${target}`,
    add_transformer: () => `Add a transformer to ${target}`,
    update_transformer: () => `Change a transformer of ${target}`,
    remove_transformer: () => `Remove a transformer from ${target}`,
    bind_parameter: () => `Compute ${text(input.param)} of ${block(input.blockId)} from data`,
    unbind_parameter: () => `Stop computing ${text(input.param)} of ${block(input.blockId)}`,
    get_docker_status: () => 'Checked Docker',
    list_test_platforms: () => 'Listed test platforms',
    get_test_environments: () => 'Read the test environments',
    set_test_environment: () => (input.environmentId ? 'Change the test environment' : 'Create a test environment'),
    remove_test_environment: () => 'Remove a test environment',
    run_tests: () => 'Run the tests',
    get_test_results: () => 'Read the test results',
    stop_test_environment: () => (input.destroy ? 'Destroy the test hosts' : 'Stop the test hosts')
  };
  return lines[tool]?.() ?? tool;
}
