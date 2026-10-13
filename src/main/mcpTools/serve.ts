import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'http';

import { MCP_INSTRUCTIONS, registerBuilderTools } from './index';
import type { McpPermissions } from './permissions';
import type { CallWindow } from './shared';

// Loaded on the first request (mcp.ts): the SDK and zod take ~300 ms, too much for every launch.
// Stateless: a server and transport per request.
export async function answerMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  info: { name: string; version: string },
  call: CallWindow,
  permissions: McpPermissions
) {
  const mcp = new McpServer(info, { instructions: MCP_INSTRUCTIONS });
  registerBuilderTools(mcp, call, permissions);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
}
