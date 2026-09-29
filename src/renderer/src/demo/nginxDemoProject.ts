// Builds the "Provision and harden an nginx web server" demo project
import { newDefinitionEntry } from '../blocks/definitionEntries';
import { blockDescriptorsById } from '../blocks/loadBlocks';
import { estimateNodeHeight } from '../canvas/layout';
import type { AppDispatch } from '../store';
import { blockAdded } from '../store/canvasSlice';
import type { BlockInstance, DefinitionEntry } from '../store/canvasSlice/types';
import { edgeAdded } from '../store/edgesSlice';
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

const NGINX_CONF_TEMPLATE = `worker_processes {{{vars.common:vars.worker_processes}}};

events {
    worker_connections {{{vars.common:vars.worker_connections}}};
}

http {
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
      params: { package_name: '$(common:vars.webserver_package)' },
      condition: { mode: 'if', kind: 'class', className: 'common:webserver_role' }
    },
    {
      blockId: 'remove-package',
      label: 'Remove conflicting Apache',
      params: { package_name: 'apache2' },
      condition: { mode: 'if', kind: 'class', className: 'common:webserver_role' }
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
  // the config it depends on, gated by a "repaired" arrow from it.
  const webserverFile = dispatch(fileAdded('Webserver'));
  const webserverFileId = webserverFile.payload.id;
  const renderTemplate = buildRenderTemplateBlock();
  const manageService = buildManageServiceBlock();
  const column = [...buildWebserverBlocksBeforeTemplate(), renderTemplate, manageService, ...buildWebserverBlocksAfterTemplate()];
  const positions = stackPositions(column);
  const ids = column.map((block, index) => dispatch(blockAdded({ ...block, fileId: webserverFileId, position: positions[index] })).payload.instanceId);
  dispatch(
    edgeAdded({ fileId: webserverFileId, source: ids[column.indexOf(renderTemplate)], target: ids[column.indexOf(manageService)], outcomes: ['repaired'] })
  );
  dispatch(historyCleared());
}
