/**
 * The AI agents the MCP server can be added to, and how: each agent's own
 * command or settings file (checked against their docs, 2026-10), filled in
 * with the server's address and token.
 */

export interface AgentConnection {
  name: string;
  token: string;
  url: string;
}

export interface Agent {
  // Where the snippet goes, shown above it.
  how: string;
  id: string;
  label: string;
  snippet: (connection: AgentConnection) => string;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

export const AGENTS: Agent[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    how: 'Run once in a terminal; it’s added for every folder.',
    snippet: ({ name, token, url }) => `claude mcp add --transport http --scope user ${name} ${url} --header "Authorization: Bearer ${token}"`
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    how: 'Run once in a terminal; it’s added for your user.',
    snippet: ({ name, token, url }) => `gemini mcp add -s user --transport http --header "Authorization: Bearer ${token}" ${name} ${url}`
  },
  {
    id: 'codex',
    label: 'OpenAI Codex',
    how: 'Add to ~/.codex/config.toml.',
    snippet: ({ name, token, url }) => `[mcp_servers.${name}]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }`
  },
  {
    id: 'vscode',
    label: 'VS Code (Copilot)',
    how: 'Add to your user mcp.json (Command Palette › MCP: Open User Configuration).',
    snippet: ({ name, token, url }) => json({ servers: { [name]: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } } } })
  },
  {
    id: 'cursor',
    label: 'Cursor',
    how: 'Add to ~/.cursor/mcp.json.',
    snippet: ({ name, token, url }) => json({ mcpServers: { [name]: { url, headers: { Authorization: `Bearer ${token}` } } } })
  },
  {
    id: 'other',
    label: 'Another MCP client',
    how: 'A Streamable HTTP MCP server; send the token as a bearer token.',
    snippet: ({ token, url }) => `URL: ${url}\nHeader: Authorization: Bearer ${token}`
  }
];

export const DEFAULT_AGENT = AGENTS[0];

export const agentById = (id: string | null): Agent => AGENTS.find(agent => agent.id === id) ?? DEFAULT_AGENT;
