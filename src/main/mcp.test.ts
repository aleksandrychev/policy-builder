import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'fs';
import type { IncomingMessage } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpStatus } from './mcp';
import type { McpPermissions } from './mcpTools/permissions';
import { type Handler, invoker, trustedFrame } from './test/ipc';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  userData: '',
  // Tool requests the window got: [requestId, tool, input].
  asked: [] as [string, string, unknown][],
  hasWindow: true
}));

// The window answers tool requests through mcp:tool-result, as the renderer does.
const webContents = { send: (_channel: string, ...args: [string, string, unknown]) => void electron.asked.push(args) };

vi.mock('electron', async importOriginal => {
  const original = await importOriginal<typeof import('./test/electron')>();
  return {
    ...original,
    app: { ...original.app, getPath: () => electron.userData },
    ipcMain: { ...original.ipcMain, handle: (channel: string, handler: Handler) => void electron.handlers.set(channel, handler) },
    BrowserWindow: { getAllWindows: () => (electron.hasWindow ? [{ isDestroyed: () => false, webContents }] : []) }
  };
});

const ALL: McpPermissions = { delete: true, edit: true, files: true, projects: true, testing: true };

let mcp: typeof import('./mcp');
let invoke: ReturnType<typeof invoker>;

beforeEach(async () => {
  electron.userData = await fs.mkdtemp(join(tmpdir(), 'cfpb-mcp-'));
  electron.handlers.clear();
  electron.asked = [];
  electron.hasWindow = true;
  // Fresh module state (server, permissions) for every test.
  vi.resetModules();
  mcp = await import('./mcp');
  mcp.registerMcpHandlers(frame => frame === trustedFrame);
  invoke = invoker(electron.handlers);
});

afterEach(async () => {
  await invoke('mcp:set-enabled', false);
  await fs.rm(electron.userData, { recursive: true, force: true });
});

const enable = () => invoke('mcp:set-enabled', true) as Promise<McpStatus>;
const allow = (permissions: Partial<McpPermissions>) => invoke('mcp:set-permissions', { ...ALL, ...permissions }) as Promise<McpStatus>;

// An agent connecting the way Claude Code does.
async function agent(status: McpStatus, token = status.token): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(status.url!), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

const toolNames = async (client: Client) => (await client.listTools()).tools.map(tool => tool.name);

// The window answers the next tool request with `content`.
function windowAnswers(content: string) {
  const timer = setInterval(() => {
    const request = electron.asked.at(-1);
    if (!request) return;
    clearInterval(timer);
    const event = { senderFrame: trustedFrame, sender: webContents } as unknown as IpcMainInvokeEvent;
    void electron.handlers.get('mcp:tool-result')!(event, request[0], { ok: true, content });
  }, 5);
}

describe('MCP permissions, as agents meet them', () => {
  it('stops offering a group the user turns off, from the next request on', async () => {
    const client = await agent(await enable());
    expect(await toolNames(client)).toContain('run_tests');

    await allow({ testing: false });
    const names = await toolNames(client);
    expect(names).not.toContain('run_tests');
    expect(names).not.toContain('set_test_environment');
    expect(names).toContain('get_test_results');
    expect(names).toContain('add_block');
    await client.close();
  });

  it('refuses a tool turned off after the agent listed it, without asking the window', async () => {
    const client = await agent(await enable());
    expect(await toolNames(client)).toContain('remove_block');

    await allow({ delete: false });
    const result = await client.callTool({ name: 'remove_block', arguments: { blockId: 'b1' } }).catch((error: Error) => ({ isError: true, error }));
    expect(result.isError).toBe(true);
    expect(electron.asked).toEqual([]);
    await client.close();
  });

  it('refuses a turned-off tool even if it reaches the window call', async () => {
    await allow({ edit: false, delete: false });
    await expect(mcp.callWindowTool('add_block', {})).rejects.toThrow('add_block is turned off in Policy Builder');
    await expect(mcp.callWindowTool('remove_block', {})).rejects.toThrow('turned off');
    await expect(mcp.callWindowTool('no_such_tool', {})).rejects.toThrow('turned off');
    expect(electron.asked).toEqual([]);
  });

  it('passes an allowed tool to the window and returns its answer', async () => {
    await allow({ edit: false });
    const client = await agent(await enable());
    windowAnswers('{"open":false}');

    const result = await client.callTool({ name: 'get_project_status', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: '{"open":false}' }]);
    expect(electron.asked.map(([, tool]) => tool)).toEqual(['get_project_status']);
    await client.close();
  });

  it('keeps reading when every group is off', async () => {
    await allow({ delete: false, edit: false, files: false, projects: false, testing: false });
    electron.hasWindow = false;
    // Past the permission check: only the missing window stops it.
    await expect(mcp.callWindowTool('get_file', {})).rejects.toThrow('no window open');
  });

  it('saves the permissions and keeps the token when the server is turned off and on', async () => {
    const first = await enable();
    await allow({ files: false });
    await invoke('mcp:set-enabled', false);
    const again = await enable();

    expect(again.token).toBe(first.token);
    expect(again.permissions).toEqual({ ...ALL, files: false });
    const saved = JSON.parse(await fs.readFile(join(electron.userData, 'mcp.json'), 'utf-8'));
    expect(saved).toMatchObject({ enabled: true, token: first.token, permissions: { ...ALL, files: false } });
  });
});

describe('MCP connections', () => {
  const request = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;
  const token = 'a'.repeat(43);

  it('accepts only the token, on our own address, from outside a browser', () => {
    const ok = { host: '127.0.0.1:4000', authorization: `Bearer ${token}` };
    expect(mcp.isAllowed(request(ok), 4000, token)).toBe(true);
    expect(mcp.isAllowed(request({ ...ok, host: 'localhost:4000' }), 4000, token)).toBe(true);

    expect(mcp.isAllowed(request({ ...ok, authorization: `Bearer ${'b'.repeat(43)}` }), 4000, token)).toBe(false);
    expect(mcp.isAllowed(request({ ...ok, authorization: `Bearer ${token}x` }), 4000, token)).toBe(false);
    expect(mcp.isAllowed(request({ host: ok.host }), 4000, token)).toBe(false);
    // DNS rebinding: a page's own host name pointed at 127.0.0.1.
    expect(mcp.isAllowed(request({ ...ok, host: 'evil.example:4000' }), 4000, token)).toBe(false);
    expect(mcp.isAllowed(request({ ...ok, host: '127.0.0.1:4001' }), 4000, token)).toBe(false);
    // A web page: browsers always send Origin.
    expect(mcp.isAllowed(request({ ...ok, origin: 'https://evil.example' }), 4000, token)).toBe(false);
  });

  it('turns away an agent with the wrong token', async () => {
    const status = await enable();
    await expect(agent(status, 'x'.repeat(43))).rejects.toThrow();
    const response = await fetch(status.url!, { method: 'POST', headers: { Authorization: `Bearer ${status.token}`, Origin: 'https://evil.example' } });
    expect(response.status).toBe(403);
  });
});
