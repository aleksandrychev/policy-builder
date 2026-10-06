import { execFileSync } from 'child_process';
import type { IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'fs';
import { createServer } from 'net';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HubProbe, HubState, SavedHub } from '../preload/api';
import { call, registerHubHandlers } from './hub';
import { type Certificate, DEPLOY_CLASS, type FakeHub, HOSTKEY, STAGE, makeCertificate, startFakeHub } from './test/fakeHub';
import { type Handler, invoker, isTrustedFrame, trustedFrame } from './test/ipc';

const electron = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), userData: '' }));

// A reversible stand-in for the keychain, so a stored password is visibly not plain text.
const scramble = (buffer: Buffer) => Buffer.from(buffer.map(byte => byte ^ 0x5a));

vi.mock('electron', async importOriginal => {
  const original = await importOriginal<typeof import('./test/electron')>();
  return {
    ...original,
    app: { ...original.app, getPath: () => electron.userData },
    ipcMain: { ...original.ipcMain, handle: (channel: string, handler: Handler) => void electron.handlers.set(channel, handler) },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text: string) => scramble(Buffer.from(text)),
      decryptString: (buffer: Buffer) => scramble(buffer).toString()
    }
  };
});

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

type Failure = { details: string; message: string; ok: false };
type Outcome<T> = ({ ok: true } & T) | Failure;
type Deployed = { deployed: 'no' | 'unknown' | 'yes'; enabledDeploys?: boolean; output: string; state: HubState };

describe.skipIf(!hasOpenssl)('hub client against a fake Mission Portal (needs openssl on PATH)', () => {
  const invoke = invoker(electron.handlers);
  let certs = '';
  let first: Certificate;
  let reissued: Certificate;
  let other: Certificate;
  let hub: FakeHub;
  let temp = '';

  const connect = (fingerprint: string | null = first.fingerprint, password = 'secret') =>
    invoke('hub:connect', { url: hub.url, username: 'admin', password, fingerprint }) as Promise<Outcome<{ hub: SavedHub; state: HubState }>>;
  const hubState = () => invoke('hub:state', hub.url) as Promise<Outcome<{ state: HubState }>>;
  const paths = () => hub.requests.map(request => `${request.method} ${request.url}`);

  // hub:deploy as the renderer calls it, recording the progress stages it sends.
  const deploy = async () => {
    const stages: unknown[] = [];
    const sender = { isDestroyed: () => false, send: (_channel: string, stage: unknown) => void stages.push(stage) };
    const event = { senderFrame: trustedFrame, sender } as unknown as IpcMainInvokeEvent;
    const result = (await electron.handlers.get('hub:deploy')?.(event, hub.url)) as Outcome<Deployed>;
    return { result, stages };
  };

  beforeAll(async () => {
    certs = await fs.mkdtemp(join(tmpdir(), 'cfpb-hub-certs-'));
    first = await makeCertificate(certs, 'first');
    // Signed by the first: it verifies against the pinned PEM, only the fingerprint differs.
    reissued = await makeCertificate(certs, 'reissued', 'first');
    other = await makeCertificate(certs, 'other');
    hub = await startFakeHub(first);
    registerHubHandlers(isTrustedFrame);
  });

  afterAll(async () => {
    await hub?.close();
    await fs.rm(certs, { recursive: true, force: true });
  });

  beforeEach(async () => {
    temp = await fs.mkdtemp(join(tmpdir(), 'cfpb-hub-'));
    electron.userData = temp;
    hub.present(first);
    hub.reset();
  });

  afterEach(async () => {
    await fs.rm(temp, { recursive: true, force: true });
  });

  describe('connecting', () => {
    it('probes the certificate', async () => {
      const result = (await invoke('hub:probe', hub.url)) as Outcome<{ probe: HubProbe }>;
      expect(result).toMatchObject({ ok: true, probe: { url: hub.url, trusted: false, fingerprint: first.fingerprint, subject: 'localhost' } });
      expect(hub.requests).toEqual([]);
    });

    it('pins the accepted certificate and returns the hub’s state', async () => {
      const result = await connect();
      expect(result).toEqual({
        ok: true,
        hub: { url: hub.url, username: 'admin', fingerprint: first.fingerprint },
        state: {
          info: { hostkey: HOSTKEY, hostname: 'hub.test', version: '3.26.0', license: 'Enterprise, 25 hosts' },
          vcs: null,
          deploysEnabled: false,
          releaseId: 'aaaa111',
          hosts: 3
        }
      });
      expect(paths()).toEqual(['GET /api/', 'GET /api/vcs/settings', `GET /api/cmdb/v2/${HOSTKEY}?limit=100`, 'POST /api/inventory', 'GET /api/host?count=1']);
      // Every call passes the hub's 406 on application/json.
      expect(new Set(hub.requests.map(request => request.accept))).toEqual(new Set(['*/*']));
      expect(hub.requests[3].body).toEqual({
        select: ['Policy Release Id'],
        hostFilter: { includes: { includeAdditionally: false, entries: { hostkey: [HOSTKEY] } } }
      });
    });

    it('stores the password encrypted and the PEM it pinned', async () => {
      await connect();
      const [stored] = JSON.parse(await fs.readFile(join(temp, 'hubs.json'), 'utf-8'));
      expect(stored).toMatchObject({ url: hub.url, username: 'admin', fingerprint: first.fingerprint });
      expect(stored.password).not.toContain('secret');
      expect(scramble(Buffer.from(stored.password, 'base64')).toString()).toBe('secret');
      expect(stored.pem.replace(/\s/g, '')).toBe(first.cert.replace(/\s/g, ''));
      expect((await fs.stat(join(temp, 'hubs.json'))).mode & 0o777).toBe(0o600);
    });

    it('refuses a wrong password and saves nothing', async () => {
      expect(await connect(first.fingerprint, 'wrong')).toEqual({ ok: false, message: 'The hub refused the username or password', details: '' });
      expect(await invoke('hub:list')).toEqual([]);
    });

    it('refuses a certificate other than the accepted one', async () => {
      expect(await connect(other.fingerprint)).toMatchObject({ ok: false, message: 'The hub’s certificate isn’t the one you accepted' });
      expect(hub.requests).toEqual([]);
    });

    it('lists saved hubs without password or PEM', async () => {
      await connect();
      expect(await invoke('hub:list')).toEqual([{ url: hub.url, username: 'admin', fingerprint: first.fingerprint }]);
    });

    it('replaces a hub connected again', async () => {
      await connect();
      hub.data.password = 'changed';
      expect(await connect(first.fingerprint, 'changed')).toMatchObject({ ok: true });
      expect(await invoke('hub:list')).toHaveLength(1);
      expect(await hubState()).toMatchObject({ ok: true });
    });

    it('forgets a saved hub', async () => {
      await connect();
      await invoke('hub:forget', hub.url);
      expect(await invoke('hub:list')).toEqual([]);
      expect(await hubState()).toMatchObject({ ok: false, message: 'Connect to this hub first' });
    });
  });

  describe('a changed certificate', () => {
    it('is refused on reconnect', async () => {
      await connect();
      hub.present(other);
      hub.requests.length = 0;
      expect(await connect(first.fingerprint)).toMatchObject({ ok: false, message: 'The hub’s certificate isn’t the one you accepted' });
      expect(hub.requests).toEqual([]);
    });

    it('fails the pin even when it chains to the pinned one', async () => {
      await connect();
      hub.present(reissued);
      hub.requests.length = 0;
      expect(await hubState()).toMatchObject({ ok: false, message: 'The hub’s certificate changed since it was trusted' });
      expect(hub.requests).toEqual([]);
    });

    it('fails verification when it doesn’t', async () => {
      await connect();
      hub.present(other);
      hub.requests.length = 0;
      expect(await hubState()).toMatchObject({ ok: false, message: 'self-signed certificate' });
      expect(hub.requests).toEqual([]);
    });
  });

  describe('VCS settings', () => {
    it('reads what the hub deploys from', async () => {
      hub.data.vcs = {
        VCS_TYPE: 'GIT_CFBS',
        GIT_URL: 'https://git.example.com/policy.git',
        GIT_REFSPEC: 'main',
        PROJECT_SUBDIRECTORY: 'cfbs',
        GIT_USERNAME: 'deployer',
        PKEY: '/opt/cfengine/userworkdir/admin/.ssh/id_rsa.pvt'
      };
      hub.data.cmdb = [{ name: DEPLOY_CLASS, type: 'class' }];
      await connect();
      const result = await hubState();
      expect(result).toMatchObject({
        ok: true,
        state: {
          vcs: { type: 'GIT_CFBS', url: 'https://git.example.com/policy.git', refspec: 'main', subdirectory: 'cfbs', username: 'deployer', hasKey: true },
          deploysEnabled: true
        }
      });
    });

    it('saves a cfbs repository with credentials', async () => {
      await connect();
      const keyFile = join(temp, 'deploy_key');
      await fs.writeFile(keyFile, 'PRIVATE KEY\n');
      hub.requests.length = 0;
      const result = (await invoke('hub:configure-vcs', hub.url, {
        gitServer: ' https://git.example.com/policy.git ',
        gitRefspec: 'main ',
        projectSubdirectory: '/cfbs',
        gitUsername: 'deployer',
        gitPassword: 'token',
        gitPrivateKeyFile: keyFile
      })) as Outcome<{ state: HubState }>;
      expect(hub.requests[0]).toMatchObject({
        method: 'POST',
        url: '/api/vcs/settings',
        body: {
          vcsType: 'GIT_CFBS',
          gitServer: 'https://git.example.com/policy.git',
          gitRefspec: 'main',
          projectSubdirectory: 'cfbs',
          gitUsername: 'deployer',
          gitPassword: 'token',
          gitPrivateKey: 'PRIVATE KEY\n'
        }
      });
      expect(result).toMatchObject({ ok: true, state: { vcs: { type: 'GIT_CFBS', url: 'https://git.example.com/policy.git', hasKey: true } } });
    });

    it('leaves out credentials not given', async () => {
      await connect();
      hub.requests.length = 0;
      await invoke('hub:configure-vcs', hub.url, { gitServer: 'https://git.example.com/policy.git', gitRefspec: 'main' });
      expect(hub.requests[0].body).toEqual({
        vcsType: 'GIT_CFBS',
        gitServer: 'https://git.example.com/policy.git',
        gitRefspec: 'main',
        projectSubdirectory: ''
      });
    });

    it('needs a repository and a branch', async () => {
      await connect();
      hub.requests.length = 0;
      const result = await invoke('hub:configure-vcs', hub.url, { gitServer: 'https://git.example.com/policy.git', gitRefspec: ' ' });
      expect(result).toMatchObject({ ok: false, message: 'The hub needs a repository URL and a branch' });
      expect(paths()).not.toContain('POST /api/vcs/settings');
    });
  });

  describe('deploy now', () => {
    const deployed = `info: Command '${STAGE}' returned code '0'\n`;

    it('turns VCS deploys on, then deploys', async () => {
      await connect();
      hub.data.deployOutput = deployed;
      hub.requests.length = 0;
      const { result, stages } = await deploy();
      expect(result).toMatchObject({ ok: true, deployed: 'yes', state: { deploysEnabled: true, releaseId: 'bbbb222' } });
      expect(stages).toEqual(['enable', 'agent', 'verify']);
      // Host keys go raw into the CMDB path.
      expect(hub.requests.find(request => request.method === 'POST' && request.url === `/api/cmdb/v2/${HOSTKEY}`)?.body).toEqual({
        type: 'class',
        name: DEPLOY_CLASS,
        description: 'Deploy masterfiles from version control (set by CFEngine Policy Builder)',
        entries: [{ item_name: DEPLOY_CLASS, item_type: 'class' }]
      });
      const runs = hub.requests.filter(request => request.url === '/api/actions/agent_run');
      expect(runs.map(run => run.body)).toEqual([{ hostkey: HOSTKEY }, { hostkey: HOSTKEY }]);
      expect(result.ok && result.output).toContain('Updated CMDB data');
    });

    it('says it turned VCS deploys on', async () => {
      await connect();
      hub.data.deployOutput = deployed;
      expect((await deploy()).result).toMatchObject({ ok: true, enabledDeploys: true });
    });

    it('runs the agent once when deploys are on', async () => {
      hub.data.cmdb = [{ name: DEPLOY_CLASS, type: 'class' }];
      hub.data.cmdbFetched = true;
      hub.data.deployOutput = deployed;
      await connect();
      hub.requests.length = 0;
      const { result, stages } = await deploy();
      expect(result).toMatchObject({ ok: true, deployed: 'yes', enabledDeploys: undefined });
      expect(stages).toEqual(['agent', 'verify']);
      expect(paths().filter(path => path.startsWith('POST /api/cmdb'))).toEqual([]);
      expect(paths().filter(path => path === 'POST /api/actions/agent_run')).toHaveLength(1);
    });

    it('reports a failed deployment', async () => {
      hub.data.cmdb = [{ name: DEPLOY_CLASS, type: 'class' }];
      hub.data.cmdbFetched = true;
      hub.data.deployOutput = `error: Masterfiles deployment failed, see /var/cfengine/outputs/dc-scripts.log\ninfo: Command '${STAGE}' returned code '1'\n`;
      await connect();
      const { result } = await deploy();
      expect(result).toMatchObject({ ok: true, deployed: 'no', state: { releaseId: 'aaaa111' } });
    });

    it('says unknown when the output is cut before the result', async () => {
      hub.data.cmdb = [{ name: DEPLOY_CLASS, type: 'class' }];
      hub.data.cmdbFetched = true;
      hub.data.deployOutput = `${'verbose: Checking out masterfiles\n'.repeat(200)}${deployed}`;
      await connect();
      const { result } = await deploy();
      expect(result).toMatchObject({ ok: true, deployed: 'unknown' });
      expect(result.ok && result.output.length).toBe(4096);
    });

    it('needs a connected hub', async () => {
      expect((await deploy()).result).toMatchObject({ ok: false, message: 'Connect to this hub first' });
    });
  });

  describe('an unreachable hub', () => {
    // A port nothing listens on.
    const refusedPort = async () => {
      const closed = createServer();
      await new Promise<void>(resolve => closed.listen(0, resolve));
      const { port } = closed.address() as AddressInfo;
      await new Promise(resolve => closed.close(resolve));
      return port;
    };
    const connectTo = (port: number) => invoke('hub:connect', { url: `https://localhost:${port}`, username: 'admin', password: 'secret', fingerprint: null });

    it('can’t be connected to', async () => {
      const port = await refusedPort();
      expect(await connectTo(port)).toMatchObject({ ok: false, message: expect.stringMatching(new RegExp(`^Can’t reach localhost:${port}: `)) });
    });

    it('says why it can’t be connected to', async () => {
      expect(await connectTo(await refusedPort())).toMatchObject({ message: expect.stringContaining('ECONNREFUSED') });
    });

    it('times out when it doesn’t answer', async () => {
      hub.data.stall = true;
      const pinned = { url: hub.url, username: 'admin', password: 'secret', pem: first.cert, fingerprint: first.fingerprint };
      await expect(call(pinned, 'GET', '/api/', undefined, 1000)).rejects.toThrow('The hub didn’t answer within 1 s');
      expect(paths()).toEqual(['GET /api/']);
    });
  });
});
