// Builds the "Provision and harden an nginx web server" demo project
import { newDefinitionEntry } from '../blocks/definitionEntries';
import { blockDescriptorsById } from '../blocks/loadBlocks';
import type { AppDispatch } from '../store';
import { blockAdded } from '../store/canvasSlice';
import type { BlockInstance, DefinitionEntry } from '../store/canvasSlice/types';
import { derivedNodeMoved } from '../store/derivedNodesSlice';
import { edgeAdded } from '../store/edgesSlice';
import type { BlockOutcome } from '../store/edgesSlice/types';
import { fileAdded, fileDescriptionChanged, fileSelected, projectFilesInitialized } from '../store/filesSlice';
import { groupCreated } from '../store/groupsSlice';
import { historyCleared } from '../store/history';
import { projectCreated } from '../store/projectSlice';
import { environmentAdded, newEnvironment } from '../store/testEnvironmentsSlice';

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

// The landing page's folder, made explicitly: a file's missing parents would be created 700.
function buildWebRootBlock(): DemoBlock {
  return { blockId: 'create-directory', label: 'Create web root', params: { path: '/var/www/html', mode: '755', owner: 'root', group: 'root' } };
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
    // A safety net behind logrotate: anything in the log folder untouched for a month.
    {
      blockId: 'clean-up-old-files',
      label: 'Prune old nginx logs',
      params: { directory: '/var/log/nginx', days: '30', depth: 'inf' }
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

// Security: SSH hardening (only where an SSH server is installed), account file
// permissions and change detection, and a login banner.
function buildSecurityBlocks() {
  const sshdPresent = definitionBlock('define-class', 'SSH server present', [
    { valueSourceId: 'check-file-exists', params: { class_name: 'sshd_installed', path: '/etc/ssh/sshd_config' } }
  ]);
  const hardenSsh: DemoBlock = {
    blockId: 'set-config-values',
    label: 'Harden SSH',
    params: { path: '/etc/ssh/sshd_config', format: 'space', settings: 'PermitRootLogin no\nMaxAuthTries 3\nX11Forwarding no' },
    condition: { mode: 'if', kind: 'class', className: 'sshd_installed' }
  };
  // "ssh" on Debian/Ubuntu (RHEL calls it sshd).
  const restartSsh: DemoBlock = { blockId: 'manage-service', label: 'Restart SSH on config change', params: { service_name: 'ssh', action: 'restart' } };
  const accountFiles: DemoBlock = {
    blockId: 'set-permissions',
    label: 'Lock down account files',
    params: { path: '/etc/passwd\n/etc/group', mode: '644', owner: 'root', group: 'root' }
  };
  const passwordHashes: DemoBlock = {
    blockId: 'set-permissions',
    label: 'Protect password hashes',
    params: { path: '/etc/shadow', mode: '640', owner: 'root', group: 'shadow' }
  };
  const watchAccounts: DemoBlock = {
    blockId: 'watch-file',
    label: 'Watch account files',
    params: { path: '/etc/passwd\n/etc/group\n/etc/shadow' }
  };
  const reportAccounts: DemoBlock = {
    blockId: 'report-message',
    label: 'Report account changes',
    params: { message: 'Local accounts changed on $(sys.fqhost)' }
  };
  const banner: DemoBlock = {
    blockId: 'ensure-lines',
    label: 'Login banner',
    params: { path: '/etc/issue', lines: 'Authorized access only. Activity may be monitored.', create: 'true' }
  };
  return { sshdPresent, hardenSsh, restartSsh, accountFiles, passwordHashes, watchAccounts, reportAccounts, banner };
}

type Position = { x: number; y: number };

// The demo's layout, by block label (labels are unique within each file).
const POSITIONS: Record<string, Position> = {
  'Nginx settings': { x: -440, y: 0 },
  'Web server role': { x: -440, y: 280 },
  'Install web server package': { x: 840, y: -40 },
  'Remove conflicting Apache': { x: 40, y: 620 },
  'Render nginx config': { x: 1000, y: 320 },
  'Restart nginx on config change': { x: 1000, y: 580 },
  'Keep nginx running': { x: 420, y: 220 },
  'Create web root': { x: 500, y: 680 },
  'Publish the demo landing page': { x: 560, y: 440 },
  'Remove default nginx site': { x: 580, y: 920 },
  'Lock down nginx config files': { x: 580, y: 1060 },
  'Prune old nginx logs': { x: 580, y: 1260 },
  'Create deploy user': { x: 580, y: 1420 },
  'Report provisioning done': { x: 580, y: 1580 },
  'SSH server present': { x: 720, y: 320 },
  'Harden SSH': { x: 420, y: 60 },
  'Restart SSH on config change': { x: 240, y: 320 },
  'Lock down account files': { x: 240, y: 660 },
  'Protect password hashes': { x: 240, y: 940 },
  'Watch account files': { x: 240, y: 1200 },
  'Report account changes': { x: 240, y: 1420 },
  'Login banner': { x: 240, y: 1700 }
};
const positionOf = (block: DemoBlock) => POSITIONS[block.label] ?? { x: 0, y: 0 };

export function createNginxDemoProject(dispatch: AppDispatch): void {
  const describe = (fileId: string, description: string) => dispatch(fileDescriptionChanged({ fileId, description }));
  dispatch(projectCreated({ name: 'Nginx Web Server Demo' }));

  const commonFile = dispatch(projectFilesInitialized('Common'));
  const commonFileId = commonFile.payload.id;
  describe(
    commonFileId,
    'Settings the other files share. It names the nginx package, sizes its workers from the CPU count, and caps connections per worker. It also defines the webserver_role class that marks a host as a web server.'
  );
  const commonBlocks = buildCommonBlocks();
  commonBlocks.forEach(block => dispatch(blockAdded({ ...block, fileId: commonFileId, position: positionOf(block) })));

  // Webserver: one column in execution order. The restart sits right under
  // the config it depends on, gated by a "repaired" arrow from it. Whatever
  // touches nginx's files waits for the package (kept or repaired): written
  // before it, they'd get root-only folders and clash with the package's own.
  const webserverFile = dispatch(fileAdded('Webserver'));
  const webserverFileId = webserverFile.payload.id;
  describe(
    webserverFileId,
    'Turns a webserver_role host into an nginx web server. It installs nginx, removes a conflicting Apache, renders nginx.conf from a template and restarts nginx only when that file changes. It keeps the service running and publishes a landing page. It also tidies up: removes the default site, locks down config permissions, prunes old logs and creates a deploy user.'
  );
  const [install, ...beforeTemplate] = buildWebserverBlocksBeforeTemplate();
  const renderTemplate = buildRenderTemplateBlock();
  const manageService = buildManageServiceBlock();
  const keepRunning = buildKeepRunningBlock();
  const landingPage = buildLandingPageBlock();
  const webRoot = buildWebRootBlock();
  const column = [install, ...beforeTemplate, renderTemplate, manageService, keepRunning, webRoot, landingPage, ...buildWebserverBlocksAfterTemplate()];
  const ids = column.map(block => dispatch(blockAdded({ ...block, fileId: webserverFileId, position: positionOf(block) })).payload.instanceId);
  const idOf = (block: DemoBlock) => ids[column.indexOf(block)];
  const arrow = (source: DemoBlock, target: DemoBlock, outcomes: BlockOutcome[]) =>
    dispatch(edgeAdded({ fileId: webserverFileId, source: idOf(source), target: idOf(target), outcomes }));
  arrow(install, renderTemplate, ['kept', 'repaired']);
  arrow(install, keepRunning, ['kept', 'repaired']);
  arrow(install, landingPage, ['kept', 'repaired']);
  arrow(renderTemplate, manageService, ['repaired']);
  arrow(webRoot, landingPage, ['kept', 'repaired']);

  const securityFileId = dispatch(fileAdded('Security')).payload.id;
  describe(
    securityFileId,
    'Baseline hardening for every host. Where an SSH server is installed, it tightens sshd_config and restarts SSH when that changes. It enforces permissions on the account files and reports when they change. It also sets a login banner in /etc/issue.'
  );
  const security = buildSecurityBlocks();
  const securityColumn = [
    security.sshdPresent,
    security.hardenSsh,
    security.restartSsh,
    security.accountFiles,
    security.passwordHashes,
    security.watchAccounts,
    security.reportAccounts,
    security.banner
  ];
  const securityIds = securityColumn.map(block => dispatch(blockAdded({ ...block, fileId: securityFileId, position: positionOf(block) })).payload.instanceId);
  const securityArrow = (source: DemoBlock, target: DemoBlock, outcomes: BlockOutcome[]) =>
    dispatch(
      edgeAdded({ fileId: securityFileId, source: securityIds[securityColumn.indexOf(source)], target: securityIds[securityColumn.indexOf(target)], outcomes })
    );
  securityArrow(security.hardenSsh, security.restartSsh, ['repaired']);
  securityArrow(security.watchAccounts, security.reportAccounts, ['repaired']);
  // Each group compiles into a bundle of its own; both arrows stay inside their group.
  const securityGroup = (name: string, color: 'info' | 'warning', blocks: DemoBlock[]) =>
    dispatch(groupCreated({ fileId: securityFileId, name, color, instanceIds: blocks.map(block => securityIds[securityColumn.indexOf(block)]) }));
  securityGroup('SSH hardening', 'info', [security.sshdPresent, security.hardenSsh, security.restartSsh]);
  securityGroup('Account protection', 'warning', [security.accountFiles, security.passwordHashes, security.watchAccounts, security.reportAccounts]);
  // The "webserver_role" condition pill, off to the side of the blocks it gates.
  dispatch(derivedNodeMoved({ key: `${webserverFileId}|if|webserver_role`, position: { x: 60, y: -20 } }));
  // One Ubuntu host serving the landing page on http://localhost:8080/. Fixed ids: every demo
  // session finds the same container again (Docker labels carry them) instead of orphaning it.
  const demoEnvironment = newEnvironment('Demo web server', { id: 'demo-web', name: 'web', ports: [{ host: 8080, container: 80 }] });
  dispatch(environmentAdded({ ...demoEnvironment, id: 'demo-web-server', hub: 'demo-web' }));
  // Adding a file opens it; the demo opens on the web server.
  dispatch(fileSelected({ fileId: webserverFileId }));
  dispatch(historyCleared());
}
