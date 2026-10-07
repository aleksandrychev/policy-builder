import { CANVAS_TOOLS } from './canvasTools';
import { DEFINITION_TOOLS } from './definitionTools';
import { PROJECT_TOOLS } from './projectTools';
import type { Input, Tool, ToolEnv } from './shared';
import { TEST_TOOLS } from './testTools';

/** Every MCP tool by name (src/main/mcpTools/ declares them), answered as JSON text. */
const TOOLS: Record<string, Tool> = { ...PROJECT_TOOLS, ...CANVAS_TOOLS, ...DEFINITION_TOOLS, ...TEST_TOOLS };

export interface ToolAnswer {
  content: string;
  ok: boolean;
}

export async function answerTool(env: ToolEnv, name: string, input: unknown): Promise<ToolAnswer> {
  const tool = TOOLS[name];
  if (!tool) return { ok: false, content: `Unknown tool ${name}` };
  try {
    const result = await tool(env, typeof input === 'object' && input !== null ? (input as Input) : {});
    return { ok: true, content: JSON.stringify(result ?? { ok: true }) };
  } catch (error) {
    return { ok: false, content: error instanceof Error ? error.message : String(error) };
  }
}
