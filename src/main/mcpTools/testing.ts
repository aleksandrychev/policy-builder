import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { type Answer, EDIT, READ_ONLY, REMOVE } from './shared';

/** Test environments: Docker hosts running the project's policy (src/renderer/src/mcp/testTools.ts answers them). */

// How long the window may take to answer these, beyond the usual 30 s: run_tests waits up to 10 min itself.
export const TEST_TOOL_TIMEOUTS_MS: Record<string, number> = { run_tests: 11 * 60_000, stop_test_environment: 3 * 60_000 };

const environmentId = z.string().optional().describe('From get_test_environments; may be omitted when the project has only one environment');
const vars = z.record(z.string(), z.string());
const ports = z
  .array(z.object({ host: z.number().int().min(1).max(65535), container: z.number().int().min(1).max(65535) }))
  .describe('Published TCP ports, e.g. [{ "host": 8080, "container": 80 }]; host ports must be unique in the environment');

const host = z.object({
  name: z.string().describe('Letters, digits and dashes, unique in the environment; an existing host of that name (or id) is kept and changed'),
  id: z.string().optional().describe('An existing host to change (renaming it keeps its container)'),
  platform: z.string().describe('A platform id from list_test_platforms, e.g. "ubuntu-24", "debian-12", "rhel-9"'),
  image: z
    .string()
    .optional()
    .describe(
      'A custom Docker image (e.g. "rockylinux:9") to run instead; platform then says which CFEngine package it takes. Omitted: kept; "": back to the platform’s image'
    ),
  ports: ports.optional().describe('Omitted: kept (none for a new host)'),
  env: vars.optional().describe('This host’s own environment variables, overriding the environment’s (replaces them; omitted: kept)')
});

export function registerTestTools(server: McpServer, answer: Answer) {
  server.registerTool(
    'get_docker_status',
    {
      inputSchema: {},
      description: 'Whether Docker is available for test environments (installed and running), its version, socket and CPU architecture.',
      annotations: READ_ONLY
    },
    answer('get_docker_status')
  );
  server.registerTool(
    'list_test_platforms',
    {
      description:
        'What a test host can run: each platform (id, label, base image, whether it is pulled) and whether the edition / version / architecture has a CFEngine client package and a hub package for it; plus the editions, architectures and the latest version. Defaults to the first environment’s edition, version and arch. Checking packages needs the internet.',
      inputSchema: {
        edition: z.enum(['community', 'enterprise']).optional(),
        version: z.string().optional().describe('"latest" or a release such as "3.27.1"'),
        arch: z.enum(['x86_64', 'aarch64']).optional()
      },
      annotations: READ_ONLY
    },
    answer('list_test_platforms')
  );
  server.registerTool(
    'get_test_environments',
    {
      description:
        'The project’s test environments: id, name, edition, version, arch, max agent runs per host, variables (environment and per host), .env file, and hosts (id, name, platform, custom image, role hub / client, ports) with each host’s container state when Docker is available. The Tests & Logs view shows the first environment.',
      inputSchema: {},
      annotations: READ_ONLY
    },
    answer('get_test_environments')
  );
  server.registerTool(
    'set_test_environment',
    {
      description:
        'Creates a test environment (no environmentId) or changes one; only the fields given change. `hosts` replaces the host list: hosts matched by id or name are kept (with their containers), others are added or removed. Platforms are checked against list_test_platforms. A new environment defaults to Community, latest, x86_64 and one ubuntu-22 host named hub. One undo step; nothing runs. Returns the environment’s id.',
      inputSchema: {
        environmentId: z.string().optional().describe('The environment to change; omit to create one'),
        name: z.string().optional(),
        edition: z.enum(['community', 'enterprise']).optional().describe('Enterprise runs cfengine-nova-hub (Mission Portal) on the hub'),
        version: z.string().optional().describe('"latest" or a release such as "3.27.1"'),
        arch: z.enum(['x86_64', 'aarch64']).optional().describe('The hosts’ CPU architecture; x86_64 is emulated on Apple Silicon'),
        maxRuns: z.number().int().min(1).max(10).optional().describe('Agent runs per host on run_tests, until one repairs nothing (default 3)'),
        hosts: z.array(host).min(1).optional(),
        hub: z.string().optional().describe('The name of the host that is the policy hub (default: the current hub if kept, else the first host)'),
        env: vars.optional().describe('Environment variables for every host (replaces them); policy reads them with getenv()'),
        envFile: z.string().nullable().optional().describe('A .env file relative to the project folder, e.g. "./.env"; null for none')
      },
      annotations: EDIT
    },
    answer('set_test_environment')
  );
  server.registerTool(
    'remove_test_environment',
    {
      description: 'Removes a test environment from the project (one undo step). Its containers are left running: stop_test_environment with destroy first.',
      inputSchema: { environmentId: z.string() },
      annotations: REMOVE
    },
    answer('remove_test_environment')
  );
  server.registerTool(
    'run_tests',
    {
      description:
        'Deploy & run, as the Tests & Logs view does: compiles the current (unsaved too) edits, creates and bootstraps any host that is not up (minutes the first time), deploys to the hub and runs cf-agent on each host until a run repairs nothing. Waits for the end (at most timeoutSeconds) and returns per host compliance (kept / repaired / not kept, in %), whether it converged, and the errors traced to blocks (block id, label, file). With wait false it returns at once: poll get_test_results. Needs Docker.',
      inputSchema: {
        environmentId,
        hosts: z.array(z.string()).optional().describe('Host names to run on (default all); the hub is set up too when needed'),
        wait: z.boolean().optional().describe('Default true'),
        timeoutSeconds: z.number().int().min(1).max(600).optional().describe('How long to wait (default and max 600); the run goes on after it')
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
    },
    answer('run_tests')
  );
  server.registerTool(
    'get_test_results',
    {
      description:
        'The latest run of an environment (running, passed, failed, or not converged: a host still repaired something in its last run, so a promise changes the host every time; and whether the policy changed since) in the shape run_tests returns, with the end of its log.',
      inputSchema: { environmentId, logLines: z.number().int().min(0).max(1000).optional().describe('Log lines to include (default 100)') },
      annotations: READ_ONLY
    },
    answer('get_test_results')
  );
  server.registerTool(
    'stop_test_environment',
    {
      description:
        'Stops an environment’s containers (they keep what is installed; run_tests starts them again), or with destroy removes them and their network (the next run reinstalls CFEngine from the cached image). Waits until done.',
      inputSchema: {
        environmentId,
        destroy: z.boolean().optional().describe('Remove the containers instead of stopping them'),
        hosts: z.array(z.string()).optional().describe('Host names (default all)')
      },
      annotations: REMOVE
    },
    answer('stop_test_environment')
  );
}
