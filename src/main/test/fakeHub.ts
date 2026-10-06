// A fake Mission Portal over real HTTPS, for the hub client's integration tests: just the API
// calls hub.ts makes, with the quirks it relies on.
import { execFile } from 'child_process';
import { X509Certificate } from 'crypto';
import { promises as fs } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import { type Server, createServer } from 'https';
import type { AddressInfo } from 'net';
import { join } from 'path';
import { promisify } from 'util';

const run = promisify(execFile);

export interface Certificate {
  cert: string;
  fingerprint: string;
  key: string;
}

/** A throwaway certificate for localhost: self-signed, or with `issuer` signed by that one. */
export async function makeCertificate(dir: string, name: string, issuer?: string): Promise<Certificate> {
  const keyFile = join(dir, `${name}.key`);
  const certFile = join(dir, `${name}.pem`);
  const signer = issuer ? ['-CA', join(dir, `${issuer}.pem`), '-CAkey', join(dir, `${issuer}.key`)] : [];
  await run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyFile,
    '-subj',
    '/CN=localhost',
    '-days',
    '1',
    '-out',
    certFile,
    ...signer
  ]);
  const cert = await fs.readFile(certFile, 'utf-8');
  return { cert, key: await fs.readFile(keyFile, 'utf-8'), fingerprint: new X509Certificate(cert).fingerprint256 };
}

export interface HubRequest {
  accept?: string;
  authorization?: string;
  body?: unknown;
  method: string;
  // Raw, as sent (query included).
  url: string;
}

export const HOSTKEY = 'SHA=4b1d0c2e9f';
export const DEPLOY_CLASS = 'default:cfengine_internal_masterfiles_update';
// What masterfiles' update policy logs about the VCS stage script.
export const STAGE = '/var/cfengine/httpd/htdocs/api/dc-scripts/masterfiles-stage.sh';

interface CmdbItem {
  entries?: { item_name: string; item_type: string }[];
  name: string;
  type?: string;
}

export interface HubData {
  cmdb: CmdbItem[];
  // The hub's agent has fetched the CMDB data since the class was set.
  cmdbFetched: boolean;
  // The output of an agent run that deploys (the hub's agent_run returns its first 4 KB).
  deployOutput: string;
  hosts: number;
  password: string;
  releaseId: string;
  // Never answer requests (the hub hangs).
  stall: boolean;
  username: string;
  // Stored VCS settings as the hub returns them (null: the API answers 404).
  vcs: Record<string, string> | null;
}

const freshData = (): HubData => ({
  cmdb: [],
  cmdbFetched: false,
  deployOutput: '',
  hosts: 3,
  password: 'secret',
  releaseId: 'aaaa111',
  stall: false,
  username: 'admin',
  vcs: null
});

export interface FakeHub {
  close: () => Promise<void>;
  data: HubData;
  // Switches the certificate it presents, dropping kept-alive connections.
  present: (certificate: Certificate) => void;
  requests: HubRequest[];
  reset: () => void;
  url: string;
}

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', chunk => (text += chunk));
    request.on('end', () => resolve(text));
    request.on('error', reject);
  });

export async function startFakeHub(certificate: Certificate): Promise<FakeHub> {
  const hub = { data: freshData(), requests: [] as HubRequest[] };

  const answer = (response: ServerResponse, status: number, body?: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
  };

  const agentRun = (): string => {
    const { data } = hub;
    const enabled = data.cmdb.some(item => item.name === DEPLOY_CLASS);
    let output = 'R: Running update.cf\n';
    if (enabled && !data.cmdbFetched) {
      data.cmdbFetched = true;
      output += 'info: Updated CMDB data\n';
    } else if (enabled) {
      output += data.deployOutput;
      if (/returned code '0'/.test(data.deployOutput)) data.releaseId = 'bbbb222';
    }
    return output.slice(0, 4096);
  };

  const route = (request: IncomingMessage, response: ServerResponse, body: unknown) => {
    const { data } = hub;
    const url = new URL(request.url ?? '/', 'https://hub');
    const key = `${request.method} ${url.pathname}`;
    const cmdbPath = `/api/cmdb/v2/${HOSTKEY}`;
    // The hub matches host keys raw: an encoded "SHA%3D…" is no host.
    if (url.pathname.startsWith('/api/cmdb/v2/') && url.pathname !== cmdbPath) return answer(response, 404, 'Host not found');
    switch (key) {
      case 'GET /api/':
        return answer(response, 200, {
          data: [{ enterpriseVersion: '3.26.0', hub: { hostkey: HOSTKEY, hostname: 'hub.test' }, license: { licenseType: 'Enterprise', granted: 25 } }]
        });
      case 'GET /api/vcs/settings':
        return data.vcs ? answer(response, 200, { data: data.vcs }) : answer(response, 404, 'Not found');
      case 'POST /api/vcs/settings': {
        const given = body as Record<string, string>;
        data.vcs = {
          VCS_TYPE: given.vcsType,
          GIT_URL: given.gitServer,
          GIT_REFSPEC: given.gitRefspec,
          PROJECT_SUBDIRECTORY: given.projectSubdirectory ?? '',
          ...(given.gitUsername ? { GIT_USERNAME: given.gitUsername } : {}),
          ...(given.gitPrivateKey ? { PKEY: '/opt/cfengine/userworkdir/admin/.ssh/id_rsa.pvt' } : {})
        };
        return answer(response, 200, '');
      }
      case `GET ${cmdbPath}`:
        return answer(response, 200, { data: data.cmdb, meta: { total: data.cmdb.length } });
      case `POST ${cmdbPath}`:
        data.cmdb.push(body as CmdbItem);
        data.cmdbFetched = false;
        return answer(response, 201, '');
      case 'POST /api/inventory':
        return answer(response, 200, { data: [{ header: [{ columnName: 'Policy Release Id' }], rows: [[data.releaseId]] }] });
      case 'GET /api/host':
        return answer(response, 200, { data: [], meta: { total: data.hosts } });
      case 'POST /api/actions/agent_run':
        if ((body as { hostkey?: string })?.hostkey !== HOSTKEY) return answer(response, 400, 'Unknown host');
        return answer(response, 200, { exit_code: 0, output: agentRun() });
      default:
        return answer(response, 404, 'Not found');
    }
  };

  const server: Server = createServer({ key: certificate.key, cert: certificate.cert }, async (request, response) => {
    const text = await readBody(request);
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    const { accept, authorization } = request.headers;
    hub.requests.push({ method: request.method ?? '', url: request.url ?? '', accept, authorization, body });
    if (hub.data.stall) return;
    // Mission Portal answers 406 to any Accept naming application/json.
    if (accept?.includes('application/json')) return answer(response, 406, 'Not Acceptable');
    const expected = `Basic ${Buffer.from(`${hub.data.username}:${hub.data.password}`).toString('base64')}`;
    if (authorization !== expected) return answer(response, 401, 'Unauthorized');
    route(request, response, body);
  });
  await new Promise<void>(resolve => server.listen(0, resolve));

  return {
    url: `https://localhost:${(server.address() as AddressInfo).port}`,
    get data() {
      return hub.data;
    },
    requests: hub.requests,
    present: ({ key, cert }) => {
      server.setSecureContext({ key, cert });
      server.closeAllConnections();
    },
    reset: () => {
      hub.data = freshData();
      hub.requests.length = 0;
      server.closeAllConnections();
    },
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}
