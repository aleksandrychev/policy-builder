import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomBytes, timingSafeEqual } from 'crypto';
import { BrowserWindow, type IpcMainInvokeEvent, type WebContents, type WebFrameMain, app, ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'http';
import type { AddressInfo } from 'net';
import { join } from 'path';

import { MCP_INSTRUCTIONS, registerBuilderTools } from './mcpTools/index';
import { type McpPermissions, checkedPermissions, isToolAllowed } from './mcpTools/permissions';

/**
 * Claude Code connects to the open project over MCP (.claude/ai-agent-plan.md):
 * a Streamable HTTP server on 127.0.0.1, off until the user enables it, with a
 * bearer token. Tools are answered by the window from its project state.
 */

const HOST = '127.0.0.1';
const TOOL_TIMEOUT_MS = 30_000;
// Tools that wait on cfbs, Docker or the agent: a test run builds, starts hosts and runs cf-agent.
const SLOW_TOOLS: Record<string, number> = {
  create_project: 180_000,
  open_project: 60_000,
  save_project: 120_000,
  get_generated_policy: 60_000,
  run_tests: 900_000,
  stop_test_environment: 300_000
};
const SERVER_NAME = 'cfengine-policy-builder';

interface McpSettings {
  enabled: boolean;
  permissions: McpPermissions;
  // Kept so an agent's MCP settings stay valid across restarts.
  port?: number;
  token?: string;
}

export interface McpStatus {
  enabled: boolean;
  error: string | null;
  // The server's name in an agent's MCP settings.
  name: string;
  permissions: McpPermissions;
  // Sent as `Authorization: Bearer <token>`.
  token: string | null;
  url: string | null;
}

const settingsPath = () => join(app.getPath('userData'), 'mcp.json');

async function readSettings(): Promise<McpSettings> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(settingsPath(), 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null) return { enabled: false, permissions: checkedPermissions(null) };
    const { enabled, permissions, port, token } = parsed as Record<string, unknown>;
    return {
      enabled: enabled === true,
      permissions: checkedPermissions(permissions),
      ...(Number.isInteger(port) && (port as number) > 1024 && (port as number) < 65536 ? { port: port as number } : {}),
      ...(typeof token === 'string' && /^[A-Za-z0-9_-]{32,}$/.test(token) ? { token } : {})
    };
  } catch {
    return { enabled: false, permissions: checkedPermissions(null) };
  }
}

const writeSettings = (settings: McpSettings) => fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), { mode: 0o600 });

let server: Server | null = null;
let current: { port: number; token: string } | null = null;
let lastError: string | null = null;
// What agents may do; read on every request, so a change applies at once.
let permissions: McpPermissions = checkedPermissions(null);

export function mcpStatus(enabled: boolean): McpStatus {
  return {
    permissions,
    enabled,
    url: current ? `http://127.0.0.1:${current.port}/mcp` : null,
    token: current?.token ?? null,
    name: SERVER_NAME,
    error: lastError
  };
}

// Only agents on this machine: the token, and a Host that is ours (a web page can't send it, DNS rebinding).
export function isAllowed(req: IncomingMessage, port: number, token: string): boolean {
  const host = req.headers.host;
  if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) return false;
  // Browsers always send Origin on cross-origin requests; Claude Code doesn't.
  if (req.headers.origin) return false;
  const given = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// --- tool calls, answered by the window ------------------------------------------------------

interface PendingTool {
  reject: (error: Error) => void;
  resolve: (content: string) => void;
  sender: WebContents;
}

const pendingTools = new Map<string, PendingTool>();

export function callWindowTool(name: string, input: unknown): Promise<string> {
  // A client may call a tool from a list it fetched before the user turned it off.
  if (!isToolAllowed(name, permissions)) return Promise.reject(new Error(`${name} is turned off in Policy Builder (Connect an AI agent)`));
  const window = BrowserWindow.getAllWindows().find(item => !item.isDestroyed());
  if (!window) return Promise.reject(new Error('CFEngine Policy Builder has no window open'));
  const sender = window.webContents;
  const requestId = crypto.randomUUID();
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`${name} didn’t answer in time`)), SLOW_TOOLS[name] ?? TOOL_TIMEOUT_MS);
    const finish = (error: Error | null, content = '') => {
      clearTimeout(timer);
      pendingTools.delete(requestId);
      if (error) reject(error);
      else resolve(content);
    };
    pendingTools.set(requestId, { sender, resolve: content => finish(null, content), reject: error => finish(error) });
    sender.send('mcp:tool-request', requestId, name, input);
  });
}

// --- the HTTP server -------------------------------------------------------------------------

async function handle(req: IncomingMessage, res: ServerResponse, port: number, token: string) {
  if (!isAllowed(req, port, token)) {
    res.writeHead(403).end();
    return;
  }
  if (req.url !== '/mcp') {
    res.writeHead(404).end();
    return;
  }
  // Stateless: a server and transport per request.
  const mcp = new McpServer({ name: SERVER_NAME, version: app.getVersion() }, { instructions: MCP_INSTRUCTIONS });
  registerBuilderTools(mcp, callWindowTool, permissions);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
}

function listen(port: number, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const http = createServer((req, res) => {
      handle(req, res, (http.address() as AddressInfo).port, token).catch(error => {
        console.error('MCP request failed:', error);
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    http.once('error', reject);
    http.listen(port, HOST, () => {
      server = http;
      resolve((http.address() as AddressInfo).port);
    });
  });
}

async function start(): Promise<void> {
  const settings = await readSettings();
  const token = settings.token ?? randomBytes(32).toString('base64url');
  let port: number;
  try {
    port = await listen(settings.port ?? 0, token);
  } catch (error) {
    // The remembered port is taken: a new one (the command to copy changes with it).
    if (!settings.port) throw error;
    port = await listen(0, token);
  }
  current = { port, token };
  lastError = null;
  await writeSettings({ enabled: true, port, token, permissions });
}

function stop(): Promise<void> {
  current = null;
  const closing = server;
  server = null;
  return new Promise(resolve => (closing ? closing.close(() => resolve()) : resolve()));
}

export function registerMcpHandlers(isTrustedFrame: (frame: WebFrameMain | null) => boolean) {
  const trusted =
    <A extends unknown[], R>(handler: (event: IpcMainInvokeEvent, ...args: A) => R) =>
    (event: IpcMainInvokeEvent, ...args: A): R => {
      if (!isTrustedFrame(event.senderFrame)) throw new Error('Untrusted sender');
      return handler(event, ...args);
    };

  ipcMain.handle(
    'mcp:status',
    trusted(async () => mcpStatus((await readSettings()).enabled))
  );
  ipcMain.handle(
    'mcp:set-enabled',
    trusted(async (_event, enabled: unknown) => {
      if (typeof enabled !== 'boolean') throw new Error('Expected true or false');
      await stop();
      if (enabled) {
        try {
          await start();
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      } else {
        await writeSettings({ ...(await readSettings()), enabled: false });
      }
      return mcpStatus(enabled);
    })
  );
  ipcMain.handle(
    'mcp:set-permissions',
    trusted(async (_event, value: unknown) => {
      permissions = checkedPermissions(value);
      const settings = await readSettings();
      await writeSettings({ ...settings, permissions });
      return mcpStatus(settings.enabled);
    })
  );
  ipcMain.handle(
    'mcp:tool-result',
    trusted((event, requestId: unknown, result: unknown) => {
      const pending = typeof requestId === 'string' ? pendingTools.get(requestId) : undefined;
      // Only the window that was asked can answer.
      if (!pending || pending.sender !== event.sender) return;
      const { ok, content } = (typeof result === 'object' && result !== null ? result : {}) as Record<string, unknown>;
      if (typeof content !== 'string') pending.reject(new Error('The tool returned nothing'));
      else if (ok === true) pending.resolve(content);
      else pending.reject(new Error(content));
    })
  );

  // Enabled before: listening again from launch.
  void readSettings().then(settings => {
    permissions = settings.permissions;
    if (settings.enabled) {
      start().catch(error => {
        lastError = error instanceof Error ? error.message : String(error);
      });
    }
  });
  app.on('will-quit', () => void stop());
}
