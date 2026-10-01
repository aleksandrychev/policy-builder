// Builds the "Provision and harden an nginx web server" demo project
import { newDefinitionEntry } from '../blocks/definitionEntries';
import { blockDescriptorsById } from '../blocks/loadBlocks';
import { estimateNodeHeight } from '../canvas/layout';
import type { AppDispatch } from '../store';
import { blockAdded } from '../store/canvasSlice';
import type { BlockInstance, DefinitionEntry } from '../store/canvasSlice/types';
import { edgeAdded } from '../store/edgesSlice';
import type { BlockOutcome } from '../store/edgesSlice/types';
import { fileAdded, projectFilesInitialized } from '../store/filesSlice';
import { historyCleared } from '../store/history';
import { projectCreated } from '../store/projectSlice';

type DemoBlock = Omit<BlockInstance, 'fileId' | 'instanceId'>;

// Define Variable / Define Class keep everything per entry (see
// block-descriptor.v1.json's `entries`); the block itself only has a label.
function definitionBlock(blockId: 'define-class' | 'define-variable', label: string, entries: Partial<Omit<DefinitionEntry, 'id'>>[]): DemoBlock {
  const descriptor = blockDescriptorsById.get(blockId)!;
  return { blockId, label, params: {}, entries: entries.map(entry => newDefinitionEntry(descriptor, entry)) };
}

// Factories, not module-level constants: each call must return fresh
// objects. blockAdded's payload is only ever shallow-spread (`{ ...block,
// fileId }`), so a second "Try Demo" click reusing the same nested
// params/decorators/condition objects across two separate BlockInstances
// would hand Redux/Immer the same object twice — the first commit freezes
// it, and editing either demo project afterwards would throw.
function buildCommonBlocks(): DemoBlock[] {
  return [
    // Every variable lives here, one block with several entries (multi-entry
    // Define Variable); Webserver reads them cross-file.
    definitionBlock('define-variable', 'Nginx settings', [
      { valueSourceId: 'literal', params: { variable_name: 'webserver_package', value: 'nginx' } },
      {
        valueSourceId: 'file-lines',
        params: { variable_name: 'worker_processes', path: '/proc/cpuinfo', comment: '', split: '\\n', max_entries: '1000', max_bytes: '1048576' },
        // Shown on the canvas: each step's result is previewed against it.
        sampleInput: 'processor\t: 0\nmodel name\t: Example CPU\nprocessor\t: 1\nmodel name\t: Example CPU',
        // readstringlist() -> grep("processor.*", ...) -> length(...): one line
        // per logical CPU (grep is anchored, hence the ".*"). Default if empty
        // covers an unreadable /proc/cpuinfo (undefined) and a count of "0";
        // "auto" is a real nginx value (nginx picks its own worker count).
        decorators: [
          { id: crypto.randomUUID(), decoratorId: 'grep', params: { pattern: 'processor.*' } },
          { id: crypto.randomUUID(), decoratorId: 'length', params: {} },
          { id: crypto.randomUUID(), decoratorId: 'default-if-empty', params: { trigger: '0', fallback: 'auto' } }
        ]
      },
      { valueSourceId: 'literal', params: { variable_name: 'worker_connections', value: '1024' } }
    ]),
    // "Always true" here stands in for a role classification (this project
    // targets web-tier hosts) — a real, idiomatic use of a class to gate
    // package management, referenced cross-file by two Webserver blocks.
    definitionBlock('define-class', 'Web server role', [{ valueSourceId: 'always-true', params: { class_name: 'webserver_role' } }])
  ];
}

const NGINX_CONF_TEMPLATE = `user www-data;
worker_processes {{{vars.common_vars.worker_processes}}};

events {
    worker_connections {{{vars.common_vars.worker_connections}}};
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    server {
        listen 80;
        server_name example.com;
        root /var/www/html;
    }
}
`;

// Blocks before Render Template — nothing here depends on another block's
// generated instanceId, so this stays a plain data array.
function buildWebserverBlocksBeforeTemplate(): DemoBlock[] {
  return [
    {
      blockId: 'install-package',
      label: 'Install web server package',
      params: { package_name: '$(common_vars.webserver_package)' },
      condition: { mode: 'if', kind: 'class', className: 'webserver_role' }
    },
    {
      blockId: 'remove-package',
      label: 'Remove conflicting Apache',
      params: { package_name: 'apache2' },
      condition: { mode: 'if', kind: 'class', className: 'webserver_role' }
    }
  ];
}

function buildRenderTemplateBlock(): DemoBlock {
  // No condition here on purpose: it needs to run every time so CFEngine's
  // own repair detection can notice when the rendered content (e.g.
  // worker_processes) actually changed — the "repaired" arrow to Manage
  // Service below hangs off exactly that.
  return {
    blockId: 'render-template',
    label: 'Render nginx config',
    params: {
      destination: '/etc/nginx/nginx.conf',
      template_content: NGINX_CONF_TEMPLATE,
      mode: '644',
      owner: 'root',
      group: 'root'
    }
  };
}

// The page nginx serves from root /var/www/html. A Mustache template, so it
// can show what the policy knows about the host (sys.* is CFEngine's own).
const LANDING_PAGE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CFEngine Policy Builder demo project</title>
  <style>
    :root { color-scheme: light dark; --accent: #0b7ad1; --ink: #1f2933; --muted: #5f6c7b; --card: #ffffff; --page: #eef2f7; }
    @media (prefers-color-scheme: dark) { :root { --ink: #e6edf3; --muted: #9aa7b4; --card: #161b22; --page: #0d1117; } }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
           font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--page); }
    main { width: min(640px, 100%); background: var(--card); border-radius: 16px; padding: 40px;
           box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12); border-top: 6px solid var(--accent); }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0 0 24px; color: var(--muted); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 24px; margin: 0; }
    dt { color: var(--muted); }
    dd { margin: 0; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
    .badge { display: inline-block; margin-bottom: 16px; padding: 2px 10px; border-radius: 999px;
             background: var(--accent); color: #fff; font-size: 13px; font-weight: 600; }
    footer { margin-top: 32px; font-size: 13px; color: var(--muted); }
  </style>
</head>
<body>
  <main>
    {{#classes.webserver_role}}<span class="badge">Web server role</span>{{/classes.webserver_role}}
    <h1>CFEngine Policy Builder demo project</h1>
    <p>This page, the nginx it runs on and everything around them were set up by policy built visually in CFEngine Policy Builder.</p>
    <dl>
      <dt>Host</dt><dd>{{{vars.sys.fqhost}}}</dd>
      <dt>Operating system</dt><dd>{{{vars.sys.flavor}}}</dd>
      <dt>nginx workers</dt><dd>{{{vars.common_vars.worker_processes}}}</dd>
      <dt>CFEngine</dt><dd>{{{vars.sys.cf_version}}}</dd>
    </dl>
    <footer>Rendered by cf-agent from a Mustache template.</footer>
  </main>
</body>
</html>
`;

function buildLandingPageBlock(): DemoBlock {
  return {
    blockId: 'render-template',
    label: 'Publish the demo landing page',
    params: {
      destination: '/var/www/html/index.html',
      template_content: LANDING_PAGE_TEMPLATE,
      mode: '644',
      owner: 'root',
      group: 'root'
    }
  };
}

function buildWebserverBlocksAfterTemplate(): DemoBlock[] {
  return [
    {
      blockId: 'remove-file',
      label: 'Remove default nginx site',
      params: { path: '/etc/nginx/sites-enabled/default' }
    },
    {
      blockId: 'set-permissions',
      label: 'Lock down nginx config files',
      params: {
        path: '/etc/nginx/nginx.conf\n/etc/nginx/conf.d/default.conf',
        mode: '644',
        owner: 'root',
        group: 'root'
      }
    },
    {
      blockId: 'manage-users',
      label: 'Create deploy user',
      params: { username: 'deploy', state: 'present' }
    },
    {
      blockId: 'report-message',
      label: 'Report provisioning done',
      params: { message: 'Web server provisioning complete' }
    }
  ];
}

// Starts nginx (and enables it at boot) once it's installed, and keeps it running.
function buildKeepRunningBlock(): DemoBlock {
  return { blockId: 'manage-service', label: 'Keep nginx running', params: { service_name: 'nginx', action: 'start' } };
}

// Restarts nginx only when "Render nginx config" actually changed the file
// this run — reached by a "repaired" arrow, modeled on masterfiles'
// Mission Portal Apache restart (results() classes + if => "..._repaired").
function buildManageServiceBlock(): DemoBlock {
  return { blockId: 'manage-service', label: 'Restart nginx on config change', params: { service_name: 'nginx', action: 'restart' } };
}

const STACK_GAP = 60; // generous: labels can wrap past the height estimate

// Top-left corners for a top-to-bottom column, spaced by each card's
// estimated height (the canvas hasn't measured anything yet).
function stackPositions(blocks: DemoBlock[], x = 0): { x: number; y: number }[] {
  let y = 0;
  return blocks.map(block => {
    const position = { x, y };
    const height = estimateNodeHeight({ ...block, fileId: '', instanceId: '' }, blockDescriptorsById.get(block.blockId));
    y += Math.ceil((height + STACK_GAP) / 20) * 20;
    return position;
  });
}

export function createNginxDemoProject(dispatch: AppDispatch): void {
  dispatch(projectCreated({ name: 'Nginx Web Server Demo' }));

  const commonFile = dispatch(projectFilesInitialized('Common'));
  const commonFileId = commonFile.payload.id;
  const commonBlocks = buildCommonBlocks();
  const commonPositions = stackPositions(commonBlocks);
  commonBlocks.forEach((block, index) => dispatch(blockAdded({ ...block, fileId: commonFileId, position: commonPositions[index] })));

  // Webserver: one column in execution order. The restart sits right under
  // the config it depends on, gated by a "repaired" arrow from it. Whatever
  // touches nginx's files waits for the package (kept or repaired): written
  // before it, they'd get root-only folders and clash with the package's own.
  const webserverFile = dispatch(fileAdded('Webserver'));
  const webserverFileId = webserverFile.payload.id;
  const [install, ...beforeTemplate] = buildWebserverBlocksBeforeTemplate();
  const renderTemplate = buildRenderTemplateBlock();
  const manageService = buildManageServiceBlock();
  const keepRunning = buildKeepRunningBlock();
  const landingPage = buildLandingPageBlock();
  const column = [install, ...beforeTemplate, renderTemplate, manageService, keepRunning, landingPage, ...buildWebserverBlocksAfterTemplate()];
  const positions = stackPositions(column);
  const ids = column.map((block, index) => dispatch(blockAdded({ ...block, fileId: webserverFileId, position: positions[index] })).payload.instanceId);
  const idOf = (block: DemoBlock) => ids[column.indexOf(block)];
  const arrow = (source: DemoBlock, target: DemoBlock, outcomes: BlockOutcome[]) =>
    dispatch(edgeAdded({ fileId: webserverFileId, source: idOf(source), target: idOf(target), outcomes }));
  arrow(install, renderTemplate, ['kept', 'repaired']);
  arrow(install, keepRunning, ['kept', 'repaired']);
  arrow(install, landingPage, ['kept', 'repaired']);
  arrow(renderTemplate, manageService, ['repaired']);
  dispatch(historyCleared());
}
