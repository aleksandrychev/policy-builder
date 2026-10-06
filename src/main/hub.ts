import { randomUUID } from 'crypto';
import { BrowserWindow, type IpcMainInvokeEvent, type WebFrameMain, app, dialog, ipcMain, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import { request } from 'https';
import { homedir } from 'os';
import { join } from 'path';
import { type PeerCertificate, connect as tlsConnect } from 'tls';

import type { HubInfo, HubProbe, HubState, SavedHub } from '../preload/api';

/**
 * Deployment's Enterprise hub: Mission Portal's REST API, as its own Build app uses it to deploy.
 * Hubs are saved in userData with the password encrypted (safeStorage); a self-signed
 * certificate is trusted only after the user accepts its fingerprint, and pinned from then on.
 */

const TIMEOUT_MS = 20_000;
const MAX_KEY_BYTES = 64_000;
// agent_run waits for the hub's own update.cf + policy run (Mission Portal allows ~2 min).
const AGENT_RUN_TIMEOUT_MS = 200_000;
// The class masterfiles' update policy deploys from VCS under (off by default).
const DEPLOY_CLASS = 'default:cfengine_internal_masterfiles_update';

interface StoredHub extends SavedHub {
  // safeStorage-encrypted, base64.
  password: string;
  // The pinned certificate when it isn't trusted by the system.
  pem?: string;
}

// Deploy keys read when the user picked them, by the token the renderer got instead of a path.
const pickedKeys = new Map<string, string>();

async function readKey(path: string): Promise<string> {
  const stats = await fs.stat(path);
  if (!stats.isFile() || stats.size > MAX_KEY_BYTES) throw new Error('That isn’t a private key file');
  const key = await fs.readFile(path, 'utf-8');
  if (key.includes('\0')) throw new Error('That isn’t a private key file');
  return key;
}

const storePath = () => join(app.getPath('userData'), 'hubs.json');

async function readHubs(): Promise<StoredHub[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(storePath(), 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const writeHubs = (hubs: StoredHub[]) => fs.writeFile(storePath(), JSON.stringify(hubs, null, 2), { mode: 0o600 });
const publicHub = ({ url, username, fingerprint }: StoredHub): SavedHub => ({ url, username, fingerprint });

export function checkedUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 500) throw new Error('Not a hub URL');
  const url = new URL(value.trim().includes('://') ? value.trim() : `https://${value.trim()}`);
  if (url.protocol !== 'https:') throw new Error('The hub must be reached over https');
  return new URL(url.origin);
}

const pemOf = (cert: PeerCertificate) => `-----BEGIN CERTIFICATE-----\n${cert.raw.toString('base64').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`;

/** The hub's certificate, and whether the system trusts it (else the user decides by fingerprint). */
function probe(url: URL): Promise<HubProbe> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect(
      { host: url.hostname, port: Number(url.port) || 443, servername: url.hostname, rejectUnauthorized: false, timeout: TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate();
        resolve({
          url: url.origin,
          trusted: socket.authorized,
          fingerprint: cert.fingerprint256,
          subject: String(cert.subject?.CN ?? ''),
          validTo: cert.valid_to,
          pem: pemOf(cert)
        });
        socket.end();
      }
    );
    socket.on('timeout', () => socket.destroy(new Error(`No answer from ${url.host}`)));
    socket.on('error', error => reject(new Error(`Can’t reach ${url.host}: ${reasonOf(error)}`)));
  });
}

// A host with IPv4 and IPv6 addresses fails with an AggregateError and an empty message.
const reasonOf = (error: Error & { code?: string; errors?: Error[] }) => error.message || error.errors?.[0]?.message || error.code || 'connection failed';

type Hub = { fingerprint?: string; password: string; pem?: string; url: string; username: string };

// One API call: JSON in and out, basic auth, the pinned certificate when there is one.
export function call<T>(hub: Hub, method: string, path: string, body?: unknown, timeout = TIMEOUT_MS): Promise<{ data: T; status: number }> {
  const url = new URL(path, hub.url);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        timeout,
        headers: {
          Authorization: `Basic ${Buffer.from(`${hub.username}:${hub.password}`).toString('base64')}`,
          // The hub answers 406 to any Accept naming application/json; it replies JSON anyway.
          Accept: '*/*',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
        },
        // A pinned self-signed certificate: it's the CA, and it must be exactly that one.
        ...(hub.pem
          ? {
              ca: hub.pem,
              checkServerIdentity: (_host: string, cert: PeerCertificate) =>
                cert.fingerprint256 === hub.fingerprint ? undefined : new Error('The hub’s certificate changed since it was trusted')
            }
          : {})
      },
      response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => (text += chunk));
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          let data: unknown = text;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            // Plain-text answers (errors) stay text.
          }
          if (status === 401) return reject(new Error('The hub refused the username or password'));
          if (status === 403) return reject(new Error(`This user may not do that on the hub (${method} ${url.pathname})`));
          if (status >= 400)
            return reject(
              Object.assign(new Error(`${method} ${url.pathname} failed (HTTP ${status})`), {
                details: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
              })
            );
          resolve({ data: data as T, status });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`The hub didn’t answer within ${Math.round(timeout / 1000)} s`)));
    req.on('error', error => reject(error.message ? error : new Error(reasonOf(error))));
    req.end(payload);
  });
}

// A host key in a URL path as the hub matches it: raw (it finds no host for an encoded "SHA%3D…").
export function hostkeyPath(hostkey: string): string {
  if (!/^(SHA|MD5)=[0-9a-f]+$/i.test(hostkey)) throw new Error(`Unexpected hub host key: ${hostkey}`);
  return hostkey;
}

async function hubFor(urlValue: unknown): Promise<Hub> {
  const url = checkedUrl(urlValue).origin;
  const stored = (await readHubs()).find(hub => hub.url === url);
  if (!stored) throw new Error('Connect to this hub first');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('The system keychain isn’t available to read the hub password');
  return { ...stored, password: safeStorage.decryptString(Buffer.from(stored.password, 'base64')) };
}

async function info(hub: Hub): Promise<HubInfo> {
  type Api = { data: { enterpriseVersion?: string; hub?: { hostkey: string; hostname: string }; license?: { granted?: number; licenseType?: string } }[] };
  const { data } = await call<Api>(hub, 'GET', '/api/');
  const about = data.data?.[0];
  if (!about?.hub?.hostkey) throw new Error('That isn’t a CFEngine Enterprise hub API');
  return {
    hostkey: about.hub.hostkey,
    hostname: about.hub.hostname,
    version: about.enterpriseVersion ?? '',
    license: about.license?.licenseType ? `${about.license.licenseType}${about.license.granted ? `, ${about.license.granted} hosts` : ''}` : ''
  };
}

// What the hub deploys from, whether VCS deploys are on, and the policy it runs now.
async function state(hub: Hub): Promise<HubState> {
  const about = await info(hub);
  type Vcs = { data: Record<string, string> };
  const vcs = await call<Vcs>(hub, 'GET', '/api/vcs/settings').then(
    result => result.data.data,
    (error: Error) => (/HTTP 404/.test(error.message) ? null : Promise.reject(error))
  );
  type Cmdb = { data: { entries?: { item_name: string }[]; name: string }[] };
  const cmdb = await call<Cmdb>(hub, 'GET', `/api/cmdb/v2/${hostkeyPath(about.hostkey)}?limit=100`);
  const deploysEnabled = cmdb.data.data.some(item => item.name === DEPLOY_CLASS || item.entries?.some(entry => entry.item_name === DEPLOY_CLASS));
  type Inventory = { data: { rows: string[][] }[] };
  const inventory = await call<Inventory>(hub, 'POST', '/api/inventory', {
    select: ['Policy Release Id'],
    hostFilter: { includes: { includeAdditionally: false, entries: { hostkey: [about.hostkey] } } }
  }).catch(() => null);
  const hosts = await call<{ meta: { total: number } }>(hub, 'GET', '/api/host?count=1').catch(() => null);
  return {
    info: about,
    vcs: vcs
      ? {
          type: vcs.VCS_TYPE ?? 'GIT',
          url: vcs.GIT_URL ?? '',
          refspec: vcs.GIT_REFSPEC ?? '',
          subdirectory: vcs.PROJECT_SUBDIRECTORY ?? '',
          username: vcs.GIT_USERNAME ?? '',
          // A deploy key is set (PKEY is its path on the hub).
          hasKey: Boolean(vcs.PKEY)
        }
      : null,
    deploysEnabled,
    releaseId: inventory?.data.data?.[0]?.rows?.[0]?.[0] ?? null,
    hosts: hosts?.data.meta?.total ?? null
  };
}

type Result<T> = Promise<({ ok: true } & T) | { details: string; message: string; ok: false }>;

async function attempt<T extends object>(run: () => Promise<T>): Result<T> {
  try {
    return { ok: true as const, ...(await run()) };
  } catch (error) {
    const failure = error as Error & { details?: string };
    return { ok: false as const, message: failure.message, details: failure.details ?? '' };
  }
}

const text = (value: unknown, what: string, max = 2000) => {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error(`Invalid ${what}`);
  return value;
};

export function registerHubHandlers(isTrustedFrame: (frame: WebFrameMain | null) => boolean): void {
  const trusted =
    <A extends unknown[], R>(handler: (event: IpcMainInvokeEvent, ...args: A) => R) =>
    (event: IpcMainInvokeEvent, ...args: A) => {
      if (!isTrustedFrame(event.senderFrame)) throw new Error('untrusted sender');
      return handler(event, ...args);
    };

  ipcMain.handle(
    'hub:list',
    trusted(async () => (await readHubs()).map(publicHub))
  );
  ipcMain.handle(
    'hub:probe',
    trusted((_event, url: unknown) => attempt(async () => ({ probe: await probe(checkedUrl(url)) })))
  );
  // Logs in once with the credentials, then saves them; `fingerprint` is the certificate the user
  // accepted (null when the system trusts it).
  ipcMain.handle(
    'hub:connect',
    trusted((_event, request: unknown) =>
      attempt(async () => {
        const { url: urlValue, username, password, fingerprint } = (request ?? {}) as Record<string, unknown>;
        const url = checkedUrl(urlValue);
        const seen = await probe(url);
        if (!seen.trusted && seen.fingerprint !== fingerprint) throw new Error('The hub’s certificate isn’t the one you accepted');
        const hub: Hub = {
          url: url.origin,
          username: text(username, 'username', 200),
          password: text(password, 'password', 500),
          ...(seen.trusted ? {} : { pem: seen.pem, fingerprint: seen.fingerprint })
        };
        if (!safeStorage.isEncryptionAvailable()) throw new Error('The system keychain isn’t available to keep the hub password');
        const hubState = await state(hub);
        const stored: StoredHub = { ...hub, password: safeStorage.encryptString(hub.password).toString('base64') };
        await writeHubs([...(await readHubs()).filter(other => other.url !== hub.url), stored]);
        return { hub: publicHub(stored), state: hubState };
      })
    )
  );
  ipcMain.handle(
    'hub:forget',
    trusted(async (_event, url: unknown) => {
      const origin = checkedUrl(url).origin;
      await writeHubs((await readHubs()).filter(hub => hub.url !== origin));
    })
  );
  ipcMain.handle(
    'hub:state',
    trusted((_event, url: unknown) => attempt(async () => ({ state: await state(await hubFor(url)) })))
  );
  // The deploy key for the hub's VCS settings: read here, and only a token goes back with its path.
  ipcMain.handle(
    'hub:pick-key',
    trusted(async event => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: 'Deploy key for the repository',
        defaultPath: join(homedir(), '.ssh'),
        properties: ['openFile' as const, 'showHiddenFiles' as const]
      };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const path = picked.canceled ? undefined : picked.filePaths[0];
      if (!path) return null;
      return attempt(async () => {
        const token = randomUUID();
        pickedKeys.set(token, await readKey(path));
        return { path, token };
      });
    })
  );
  // Points the hub's VCS deployment at a cfbs project repository (as Mission Portal's Build app does).
  ipcMain.handle(
    'hub:configure-vcs',
    trusted((_event, url: unknown, settings: unknown) =>
      attempt(async () => {
        const hub = await hubFor(url);
        const given = (settings ?? {}) as Record<string, unknown>;
        const body: Record<string, string> = {
          vcsType: 'GIT_CFBS',
          gitServer: text(given.gitServer, 'repository URL').trim(),
          gitRefspec: text(given.gitRefspec, 'branch', 200).trim(),
          projectSubdirectory: text(given.projectSubdirectory ?? '', 'subdirectory', 500).replace(/^\/+/, '')
        };
        if (!body.gitServer || !body.gitRefspec) throw new Error('The hub needs a repository URL and a branch');
        // A POST rewrites every setting: credentials left out are cleared, so the old ones aren't kept.
        if (given.gitUsername) body.gitUsername = text(given.gitUsername, 'git username', 200);
        if (given.gitPassword) body.gitPassword = text(given.gitPassword, 'git token', 2000);
        if (given.gitPrivateKey) {
          const key = pickedKeys.get(text(given.gitPrivateKey, 'key', 100));
          if (key === undefined) throw new Error('Choose the key file again');
          body.gitPrivateKey = key;
        }
        await call(hub, 'POST', '/api/vcs/settings', body);
        return { state: await state(hub) };
      })
    )
  );
  // Deploy now: VCS deploys on (the CMDB class), then the hub's agent runs update.cf, which pulls,
  // builds with cfbs, validates and swaps masterfiles.
  ipcMain.handle(
    'hub:deploy',
    trusted((event, url: unknown) =>
      attempt(async () => {
        const stage = (name: string) => !event.sender.isDestroyed() && event.sender.send('deploy:progress', name);
        const hub = await hubFor(url);
        let before = await state(hub);
        const enabledDeploys = !before.deploysEnabled;
        let output = '';
        const runAgent = async () => {
          const { data } = await call<{ exit_code?: number; output?: string }>(
            hub,
            'POST',
            '/api/actions/agent_run',
            { hostkey: before.info.hostkey },
            AGENT_RUN_TIMEOUT_MS
          );
          output += data?.output ?? '';
          return data;
        };
        if (enabledDeploys) {
          stage('enable');
          await call(hub, 'POST', `/api/cmdb/v2/${hostkeyPath(before.info.hostkey)}`, {
            type: 'class',
            name: DEPLOY_CLASS,
            description: 'Deploy masterfiles from version control (set by CFEngine Policy Builder)',
            entries: [{ item_name: DEPLOY_CLASS, item_type: 'class' }]
          });
          // The first run fetches the CMDB data; the second deploys under it.
          await runAgent();
          before = await state(hub);
        }
        stage('agent');
        await runAgent();
        stage('verify');
        // agent_run returns only the first 4 KB: say "unknown" unless the stage's own result is in it.
        const deployed = /Masterfiles deployment failed|masterfiles-stage\.sh' returned code '[1-9]/i.test(output)
          ? 'no'
          : /masterfiles-stage\.sh' returned code '0'/.test(output)
            ? 'yes'
            : 'unknown';
        const after = await state(hub);
        return { state: after, output, deployed, enabledDeploys: enabledDeploys || undefined };
      })
    )
  );
}
