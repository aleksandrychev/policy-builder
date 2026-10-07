import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCanvasTools } from './canvas';
import { registerDefinitionTools } from './definitions';
import { registerGuide } from './guideTools';
import { type McpPermissions, gatedServer } from './permissions';
import { registerProjectTools } from './project';
import { type CallWindow, answerWith } from './shared';
import { registerTestTools } from './testing';
import { registerWorkTools } from './work';

/**
 * The tools Claude Code gets, one file per area. Each is answered by the window
 * (src/renderer/src/mcp/); the names and inputs are that contract.
 */

export const MCP_INSTRUCTIONS = `This server is CFEngine Policy Builder, a desktop app where CFEngine policy is built visually: policy files hold blocks (each compiles to promises), arrows order them by outcome (kept, repaired, not_kept), groups run blocks as one step, and conditions gate them. Each policy file is a CFEngine namespace.

Change the project only through these tools: the app generates the .cf files and cfbs.json from its blocks on save, so editing those files directly is lost (or refused) on the next save. Each edit shows on the user's canvas and is one undo step there; nothing is written to disk until the user saves. Read get_guide (the workflow) before your first change, and the other topics when you need them. Call begin_work first with what you're about to do (the user sees it, and the editor is locked so they don't interfere), and end_work when you're done. If a call comes back "Stopped by the user", stop and ask them. Start with get_project_overview, look a block type up with get_block_type before adding or changing one, and read get_generated_policy to check the result.`;

// Only the tools the user allows (permissions.ts).
export function registerBuilderTools(mcp: McpServer, call: CallWindow, permissions: McpPermissions) {
  const server = gatedServer(mcp, permissions);
  const answer = answerWith(call);
  registerGuide(mcp, server);
  registerWorkTools(server, answer);
  registerProjectTools(server, answer);
  registerCanvasTools(server, answer);
  registerDefinitionTools(server, answer);
  registerTestTools(server, answer);
}
