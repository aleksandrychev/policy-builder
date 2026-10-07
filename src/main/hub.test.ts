import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import type { ClientRequest, IncomingMessage } from 'http';
import { type RequestOptions, request } from 'https';
import { tmpdir } from 'os';
import { join } from 'path';
import { type DetailedPeerCertificate, type PeerCertificate, connect } from 'tls';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { call, checkedUrl, hostkeyPath, registerHubHandlers } from './hub';
import { type Handler, invoker, isTrustedFrame } from './test/ipc';

const electron = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), picked: null as null | string, userData: '' }));

vi.mock('electron', async importOriginal => {
  const original = await importOriginal<typeof import('./test/electron')>();
  return {
    ...original,
    app: { ...original.app, getPath: () => electron.userData },
    dialog: { showOpenDialog: async () => ({ canceled: electron.picked === null, filePaths: electron.picked === null ? [] : [electron.picked] }) },
    ipcMain: { ...original.ipcMain, handle: (channel: string, handler: Handler) => void electron.handlers.set(channel, handler) }
  };
});

vi.mock('https', () => ({ request: vi.fn() }));
vi.mock('tls', () => ({ connect: vi.fn() }));

let temp = '';

beforeEach(async () => {
  temp = await fs.mkdtemp(join(tmpdir(), 'cfpb-hub-'));
  electron.userData = temp;
  vi.mocked(request).mockReset();
  vi.mocked(connect).mockReset();
});

afterEach(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});

type Sent = { options: RequestOptions; payload?: string; url: URL };

// The hub answers every request with `status` and `body` (or never, with `status` null).
function hubAnswers(status: number | null, body = ''): Sent[] {
  const sent: Sent[] = [];
  const fake = (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const req = Object.assign(new EventEmitter(), {
      destroy: (error: Error) => void req.emit('error', error),
      end: (payload?: string) => {
        sent.push({ url, options, payload });
        if (status === null) return void req.emit('timeout');
        const response = Object.assign(new EventEmitter(), { statusCode: status, setEncoding: () => {} });
        callback(response as unknown as IncomingMessage);
        response.emit('data', body);
        response.emit('end');
      }
    });
    return req as unknown as ClientRequest;
  };
  vi.mocked(request).mockImplementation(fake as unknown as typeof request);
  return sent;
}

// The hub's TLS certificate as a probe sees it.
function hubPresents(fingerprint: string, authorized: boolean) {
  const fake = (_options: object, onConnect: () => void) => {
    const certificate = { fingerprint256: fingerprint, subject: { CN: 'hub' }, valid_to: 'Jan 1 00:00:00 2030 GMT', raw: Buffer.from('certificate') };
    const socket = Object.assign(new EventEmitter(), {
      authorized,
      end: () => {},
      destroy: () => {},
      getPeerCertificate: () => certificate as unknown as PeerCertificate
    });
    setImmediate(onConnect);
    return socket;
  };
  vi.mocked(connect).mockImplementation(fake as unknown as typeof connect);
}

describe('checkedUrl', () => {
  it('reduces a hub address to its https origin', () => {
    expect(checkedUrl('hub.example.com').href).toBe('https://hub.example.com/');
    expect(checkedUrl(' https://hub.example.com:8443/api/?x=1#y ').href).toBe('https://hub.example.com:8443/');
    expect(checkedUrl('https://admin:secret@hub.example.com').href).toBe('https://hub.example.com/');
  });

  it('refuses anything but https', () => {
    for (const value of ['http://hub.example.com', 'ftp://hub.example.com', 'file:///etc/passwd'])
      expect(() => checkedUrl(value)).toThrow('The hub must be reached over https');
  });

  it('refuses non-strings, overlong and unparsable values', () => {
    for (const value of [42, null, undefined, { url: 'hub' }, `hub${'a'.repeat(500)}`]) expect(() => checkedUrl(value)).toThrow('Not a hub URL');
    expect(() => checkedUrl('https://')).toThrow();
    expect(() => checkedUrl('hub example')).toThrow();
  });
});

describe('hostkeyPath', () => {
  it('keeps a host key raw', () => {
    expect(hostkeyPath('SHA=0a1b2c')).toBe('SHA=0a1b2c');
    expect(hostkeyPath('MD5=ABCDEF')).toBe('MD5=ABCDEF');
  });

  it('refuses anything that could change the URL', () => {
    for (const hostkey of ['', 'SHA=', 'SHA%3Dabc', 'SHA=abc/../../api', 'SHA=abc?limit=1', 'SHA=abc#x', 'SHA1=abc', 'SHA=xyz', ' SHA=abc']) {
      expect(() => hostkeyPath(hostkey)).toThrow('Unexpected hub host key');
    }
  });
});

describe('call', () => {
  const hub = { url: 'https://hub.example.com', username: 'admin', password: 'secret' };

  it('sends basic auth and parses the JSON answer', async () => {
    const sent = hubAnswers(200, '{"data": [1]}');
    expect(await call(hub, 'GET', '/api/')).toEqual({ data: { data: [1] }, status: 200 });
    expect(sent[0].url.href).toBe('https://hub.example.com/api/');
    expect(sent[0].options.headers).toEqual({ Authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}`, Accept: '*/*' });
    expect(sent[0].payload).toBeUndefined();
  });

  it('sends a body as JSON, its length in bytes', async () => {
    const sent = hubAnswers(201, '');
    expect(await call(hub, 'POST', '/api/vcs/settings', { gitServer: 'ü' })).toEqual({ data: null, status: 201 });
    expect(sent[0].payload).toBe('{"gitServer":"ü"}');
    expect(sent[0].options.headers).toMatchObject({ 'Content-Type': 'application/json', 'Content-Length': 18 });
  });

  it('explains refused credentials and permissions', async () => {
    hubAnswers(401, 'Unauthorized');
    await expect(call(hub, 'GET', '/api/')).rejects.toThrow('The hub refused the username or password');
    hubAnswers(403, '');
    await expect(call(hub, 'POST', '/api/actions/agent_run')).rejects.toThrow('This user may not do that on the hub (POST /api/actions/agent_run)');
  });

  it('keeps the hub’s answer to other failures as details', async () => {
    hubAnswers(500, 'Internal error');
    await expect(call(hub, 'GET', '/api/host?count=1')).rejects.toMatchObject({ message: 'GET /api/host failed (HTTP 500)', details: 'Internal error' });
    hubAnswers(404, '{"message":"no"}');
    await expect(call(hub, 'GET', '/api/x')).rejects.toMatchObject({ details: '{\n  "message": "no"\n}' });
  });

  it('gives up on a hub that doesn’t answer', async () => {
    hubAnswers(null);
    await expect(call(hub, 'GET', '/api/', undefined, 3000)).rejects.toThrow('The hub didn’t answer within 3 s');
  });

  it('relies on the system’s trust without a pinned certificate', async () => {
    const sent = hubAnswers(200, '{}');
    await call(hub, 'GET', '/api/');
    expect(sent[0].options.ca).toBeUndefined();
    expect(sent[0].options.checkServerIdentity).toBeUndefined();
  });

  it('accepts only the pinned certificate', async () => {
    const sent = hubAnswers(200, '{}');
    await call({ ...hub, pem: 'PEM', fingerprint: 'AA:BB' }, 'GET', '/api/');
    const { ca, checkServerIdentity } = sent[0].options;
    expect(ca).toBe('PEM');
    const certificate = (fingerprint256: string) => ({ fingerprint256 }) as DetailedPeerCertificate;
    expect(checkServerIdentity?.('hub.example.com', certificate('AA:BB'))).toBeUndefined();
    expect(checkServerIdentity?.('hub.example.com', certificate('CC:DD'))?.message).toBe('The hub’s certificate changed since it was trusted');
  });
});

describe('IPC handlers', () => {
  const invoke = invoker(electron.handlers);
  const connectTo = (fingerprint: unknown, username: unknown = 'admin') =>
    invoke('hub:connect', { url: 'hub.example.com', username, password: 'secret', fingerprint }) as Promise<{ message?: string; ok: boolean }>;

  beforeAll(() => registerHubHandlers(isTrustedFrame));

  it('refuses an untrusted certificate other than the accepted one', async () => {
    hubPresents('AA:BB', false);
    expect(await connectTo('CC:DD')).toEqual({ ok: false, message: 'The hub’s certificate isn’t the one you accepted', details: '' });
    expect(await connectTo(undefined)).toMatchObject({ message: 'The hub’s certificate isn’t the one you accepted' });
    expect(request).not.toHaveBeenCalled();
  });

  it('goes on with the accepted certificate, or one the system trusts', async () => {
    // Up to the keychain, which the Electron stand-in doesn't have.
    const keychain = 'The system keychain isn’t available to keep the hub password';
    hubPresents('AA:BB', false);
    expect(await connectTo('AA:BB')).toMatchObject({ ok: false, message: keychain });
    hubPresents('AA:BB', true);
    expect(await connectTo(null)).toMatchObject({ ok: false, message: keychain });
    expect(await connectTo(null, 42)).toMatchObject({ ok: false, message: 'Invalid username' });
  });

  it('never connects to a hub over http', async () => {
    expect(await invoke('hub:connect', { url: 'http://hub.example.com' })).toMatchObject({ ok: false, message: 'The hub must be reached over https' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('lists saved hubs without their secrets', async () => {
    const stored = { url: 'https://hub.example.com', username: 'admin', fingerprint: 'AA:BB', password: 'c2VjcmV0', pem: 'PEM' };
    await fs.writeFile(join(temp, 'hubs.json'), JSON.stringify([stored]));
    expect(await invoke('hub:list')).toEqual([{ url: 'https://hub.example.com', username: 'admin', fingerprint: 'AA:BB' }]);
  });

  it('reads a picked deploy key in main and hands the page only a token', async () => {
    const key = join(temp, 'deploy_key');
    await fs.writeFile(key, 'PRIVATE KEY\n');
    electron.picked = key;
    const picked = (await invoke('hub:pick-key')) as { ok: true; path: string; token: string };
    expect(picked).toEqual({ ok: true, path: key, token: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(JSON.stringify(picked)).not.toContain('PRIVATE KEY');

    await fs.writeFile(key, 'x'.repeat(64_001));
    expect(await invoke('hub:pick-key')).toMatchObject({ ok: false, message: 'That isn’t a private key file' });
    electron.picked = null;
    expect(await invoke('hub:pick-key')).toBeNull();
  });

  it('acts only on a hub connected before', async () => {
    expect(await invoke('hub:state', 'https://other.example.com')).toMatchObject({ ok: false, message: 'Connect to this hub first' });
    expect(request).not.toHaveBeenCalled();
  });
});
