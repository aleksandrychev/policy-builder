import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectContent } from '../preload/api';
import { compilePolicy } from './backend';
import {
  checkedAbsolutePath,
  checkedContent,
  checkedFolderName,
  checkedStorage,
  highestRelease,
  isGeneratedPath,
  isInKnownProject,
  isPolicyPath,
  mergeCfbsJson,
  readTestEnvironments,
  registerProjectHandlers,
  testEnvironmentSecretFiles,
  writeTestEnvironments
} from './project';
import { type Handler, invoker, ipcEvent, isTrustedFrame } from './test/ipc';

const electron = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), userData: '' }));

vi.mock('electron', async importOriginal => {
  const original = await importOriginal<typeof import('./test/electron')>();
  return {
    ...original,
    app: { ...original.app, addRecentDocument: () => {}, clearRecentDocuments: () => {}, getPath: () => electron.userData },
    ipcMain: { ...original.ipcMain, handle: (channel: string, handler: Handler) => void electron.handlers.set(channel, handler) }
  };
});

vi.mock('./backend', () => ({ compilePolicy: vi.fn(), initCfbsProject: vi.fn(), masterfilesEntry: vi.fn() }));

let temp = '';

beforeEach(async () => {
  temp = await fs.mkdtemp(join(tmpdir(), 'cfpb-project-'));
});

afterEach(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});

const content = (extra: Partial<ProjectContent> = {}): ProjectContent => ({
  project: { module_name: 'demo', name: 'Demo', files: [{ path: './main.cf' }] },
  modules: [{ name: './main.cf', steps: ['policy_files ./main.cf'] }],
  provided: { steps: ['policy_files ./main.cf'] },
  ...extra
});

describe('checkedAbsolutePath', () => {
  it('normalises an absolute path', () => {
    expect(checkedAbsolutePath('/a/b/../c/', 'path')).toBe('/a/c/');
  });

  it('refuses relative, NUL-carrying, overlong and non-string paths', () => {
    for (const value of ['', 'project', './project', '../etc', '/a\0b', `/${'a'.repeat(4096)}`, 42, null, undefined, ['/a'], { path: '/a' }]) {
      expect(() => checkedAbsolutePath(value, 'project path')).toThrow('Invalid project path');
    }
  });
});

describe('checkedFolderName', () => {
  it('accepts a slug', () => {
    expect(checkedFolderName('my-project_2')).toBe('my-project_2');
    expect(checkedFolderName('a'.repeat(100))).toBe('a'.repeat(100));
  });

  it('refuses anything that could leave the parent or isn’t a slug', () => {
    for (const value of ['', '..', '../x', 'a/b', 'a\\b', '-x', '_x', 'My', 'a b', 'a\0', '.git', 'a'.repeat(101), 7, null]) {
      expect(() => checkedFolderName(value)).toThrow('Invalid project folder name');
    }
  });
});

describe('checkedStorage', () => {
  it('accepts both project types', () => {
    expect(checkedStorage({ type: 'module' })).toEqual({ type: 'module', masterfiles: null });
    expect(checkedStorage({ type: 'policy-set', masterfiles: '3.27.1-2' })).toEqual({ type: 'policy-set', masterfiles: '3.27.1-2' });
    expect(checkedStorage({ type: 'policy-set', masterfiles: 'master' }).masterfiles).toBe('master');
  });

  it('refuses unknown types and masterfiles versions', () => {
    for (const value of [null, 'module', [], { type: 'library' }, {}]) expect(() => checkedStorage(value)).toThrow('Invalid project type');
    for (const masterfiles of ['3.27', 'latest', '3.27.1; rm -rf /', '../3.27.1', 3]) {
      expect(() => checkedStorage({ type: 'policy-set', masterfiles })).toThrow('Invalid masterfiles version');
    }
  });
});

describe('isPolicyPath / isGeneratedPath', () => {
  it('accepts project-relative policy files and templates', () => {
    for (const path of ['./main.cf', './services/web/main.cf', './a-b/c_d.cf']) expect(isPolicyPath(path)).toBe(true);
    expect(isGeneratedPath('./templates/motd.mustache')).toBe(true);
    expect(isPolicyPath('./templates/motd.mustache')).toBe(false);
  });

  it('refuses paths outside the project or in cfbs’s out/', () => {
    for (const path of ['../main.cf', './../main.cf', './a/../../main.cf', '/etc/main.cf', 'main.cf', './out/main.cf', './out/x/main.cf']) {
      expect(isGeneratedPath(path)).toBe(false);
    }
  });

  it('refuses odd names and non-strings', () => {
    for (const path of ['./Main.cf', './main.CF', './.hidden.cf', './main.cf\0', './main.txt', './a b.cf', './main.cf/', '', 42, null]) {
      expect(isGeneratedPath(path)).toBe(false);
    }
  });
});

describe('checkedContent', () => {
  it('accepts a well-formed project', () => {
    const valid = content({ testEnvironments: [{ name: 'debian' }] });
    expect(checkedContent(valid)).toBe(valid);
  });

  it('refuses non-objects', () => {
    for (const value of [null, undefined, 'x', [], { project: [], modules: [], provided: {} }, { project: {}, modules: {}, provided: {} }]) {
      expect(() => checkedContent(value)).toThrow('Invalid project content');
    }
  });

  it('refuses bad module names', () => {
    for (const module_name of ['', 'Demo', '1demo', 'demo-', 'de--mo', 'de_mo', '../demo', 42]) {
      expect(() => checkedContent(content({ project: { module_name, files: [{ path: './main.cf' }] } }))).toThrow('Invalid module name');
    }
  });

  it('refuses a provided module without string steps', () => {
    expect(() => checkedContent(content({ provided: {} }))).toThrow('Invalid provided module');
    expect(() => checkedContent(content({ provided: { steps: [1] } }))).toThrow('Invalid provided module');
  });

  it('refuses hostile or duplicate policy file paths', () => {
    for (const files of [[{ path: '../evil.cf' }], [{ path: '/etc/evil.cf' }], [{ path: './out/main.cf' }], [{ path: './main.cf' }, { path: './main.cf' }]]) {
      expect(() => checkedContent(content({ project: { module_name: 'demo', files } }))).toThrow('Invalid policy file path');
    }
  });

  it('wants exactly the modules the files make up', () => {
    const modules = (...names: unknown[]) => content({ modules: names.map(name => ({ name, steps: [] })) });
    expect(() => checkedContent(modules())).toThrow('Invalid policy module');
    expect(() => checkedContent(modules('./main.cf', './other.cf'))).toThrow('Invalid policy module');
    expect(() => checkedContent(modules('../main.cf'))).toThrow('Invalid policy module');
    expect(() => checkedContent(content({ modules: [{ name: './main.cf' }] }))).toThrow('Invalid policy module');
    const nested = content({ project: { module_name: 'demo', files: [{ path: './services/a.cf' }, { path: './services/b.cf' }] } });
    expect(() => checkedContent({ ...nested, modules: [{ name: './services/', steps: [] }] })).not.toThrow();
  });

  it('wants ./templates/ once the project generated templates', () => {
    const project = { module_name: 'demo', files: [{ path: './main.cf' }], generated: ['./main.cf', './templates/motd.mustache'] };
    expect(() => checkedContent(content({ project }))).toThrow('Invalid policy module');
    const modules = [
      { name: './main.cf', steps: [] },
      { name: './templates/', steps: [] }
    ];
    expect(() => checkedContent(content({ project, modules }))).not.toThrow();
  });

  it('refuses test environments that aren’t a list of objects', () => {
    for (const testEnvironments of [{}, 'x', [1], [null], [[]]]) {
      expect(() => checkedContent({ ...content(), testEnvironments })).toThrow('Invalid test environments');
    }
  });
});

describe('mergeCfbsJson', () => {
  const masterfiles = { name: 'masterfiles', version: '3.27.1' };

  it('keeps other tools’ build entries and replaces ours', () => {
    const existing = { name: 'Demo', type: 'policy-set', build: [masterfiles, { name: 'other' }, { name: './main.cf', steps: ['old'] }] };
    const merged = mergeCfbsJson(existing, content(), null, 'policy-set', ['./main.cf']);
    expect(merged.build).toEqual([masterfiles, { name: 'other' }, { name: './main.cf', steps: ['policy_files ./main.cf'] }]);
  });

  it('removes modules the previous save had and this one doesn’t', () => {
    const existing = { type: 'policy-set', build: [masterfiles, { name: './old.cf' }, { name: './services/' }] };
    const previous = { files: [{ path: './old.cf' }, { path: './services/a.cf' }] };
    const merged = mergeCfbsJson(existing, content(), previous, 'policy-set', ['./main.cf']);
    expect(merged.build).toEqual([masterfiles, ...content().modules]);
  });

  it('adds masterfiles when a module becomes a policy set', () => {
    const existing = { name: 'demo', type: 'module', provides: { demo: { tags: ['policy-builder'], steps: [] } } };
    const merged = mergeCfbsJson(existing, content(), null, 'policy-set', ['./main.cf'], masterfiles);
    expect(merged).toEqual({ name: 'Demo', type: 'policy-set', build: [masterfiles, ...content().modules] });
  });

  it('doesn’t add masterfiles twice', () => {
    const merged = mergeCfbsJson({ build: [masterfiles] }, content(), null, 'policy-set', [], { name: 'masterfiles', version: 'master' });
    expect(merged.build).toEqual([masterfiles, ...content().modules]);
  });

  it('shapes a module as provides, keeping other provided modules', () => {
    const existing = {
      type: 'policy-set',
      build: [masterfiles, { name: './main.cf' }],
      provides: { theirs: { steps: [] }, old: { tags: ['policy-builder'], steps: [] } }
    };
    const merged = mergeCfbsJson(existing, content(), null, 'module', ['./main.cf']);
    expect(merged).toEqual({ type: 'module', name: 'demo', build: [masterfiles], provides: { theirs: { steps: [] }, demo: content().provided } });
    expect('build' in mergeCfbsJson({ build: [{ name: './main.cf' }] }, content(), null, 'module', [])).toBe(false);
  });

  it('copies a module’s templates before its policy files', () => {
    const merged = mergeCfbsJson({}, content(), null, 'module', ['./main.cf', './templates/motd.mustache']);
    expect(merged.provides).toEqual({ demo: { steps: ['copy ./templates/ services/cfbs/demo/templates/', 'policy_files ./main.cf'] } });
  });

  it('drops the legacy builder meta, keeping other meta', () => {
    const meta = { 'policy-builder': { files: [] } };
    expect('meta' in mergeCfbsJson({ meta }, content(), null, 'policy-set', [])).toBe(false);
    expect(mergeCfbsJson({ meta: { ...meta, other: 1 } }, content(), null, 'policy-set', []).meta).toEqual({ other: 1 });
  });
});

describe('highestRelease', () => {
  it('picks the highest patch release of a minor version', () => {
    expect(highestRelease(['3.27.0', '3.27.2', '3.27.10', '3.27.1', '3.26.9', '3.270.1', 'master'], '3.27')).toBe('3.27.10');
    expect(highestRelease(['3.27.1', '3.27.1-2', '3.27.1-1'], '3.27')).toBe('3.27.1-2');
  });

  it('ignores malformed versions', () => {
    expect(highestRelease(['3.27.x', '3.27.1.1', '3.27.'], '3.27')).toBeUndefined();
    expect(highestRelease([], '3.27')).toBeUndefined();
  });
});

describe('test environments file', () => {
  const file = () => join(temp, '.policy-builder', 'test-environments.json');

  it('is written when there are environments and read back', async () => {
    const environments = [{ name: 'debian', envFile: './.env' }];
    await writeTestEnvironments(temp, environments);
    expect(JSON.parse(await fs.readFile(file(), 'utf-8'))).toEqual({ environments });
    expect(await readTestEnvironments(temp)).toEqual(environments);
  });

  it('is removed when there are none', async () => {
    await writeTestEnvironments(temp, [{ name: 'debian' }]);
    await writeTestEnvironments(temp, []);
    await expect(fs.stat(file())).rejects.toThrow();
    await writeTestEnvironments(temp, [{ name: 'debian' }]);
    await writeTestEnvironments(temp, undefined);
    await expect(fs.stat(file())).rejects.toThrow();
  });

  it('reads as null when missing or malformed', async () => {
    expect(await readTestEnvironments(temp)).toBeNull();
    await fs.mkdir(join(temp, '.policy-builder'));
    for (const text of ['{', '[]', '{"environments": "x"}']) {
      await fs.writeFile(file(), text);
      expect(await readTestEnvironments(temp)).toBeNull();
    }
  });

  it('lists only secrets files inside the project', async () => {
    const envFiles = ['./.env', '.env', 'secrets/hub.env', '../outside.env', '/etc/passwd', '.', '  ', 'a/../../x.env'];
    await writeTestEnvironments(
      temp,
      envFiles.map(envFile => ({ envFile }))
    );
    expect(await testEnvironmentSecretFiles(temp)).toEqual(['.env', join('secrets', 'hub.env')]);
  });
});

describe('IPC handlers', () => {
  const invoke = invoker(electron.handlers);
  const compiled = vi.mocked(compilePolicy);
  type Saved = { masterfiles?: string | null; message?: string; ok: boolean };

  beforeAll(() => registerProjectHandlers(isTrustedFrame));

  beforeEach(async () => {
    electron.userData = join(temp, 'user-data');
    await fs.mkdir(electron.userData);
    await fs.mkdir(join(temp, 'project'));
    await fs.writeFile(
      join(temp, 'project', 'cfbs.json'),
      JSON.stringify({ name: 'Demo', type: 'policy-set', build: [{ name: 'masterfiles', version: '3.27.1' }] })
    );
    compiled.mockReset();
    compiled.mockResolvedValue({ files: { './main.cf': 'bundle agent main {}\n' }, sourceMap: {} });
  });

  const project = () => join(temp, 'project');
  const open = () => invoke('project:open', { path: project() }) as Promise<{ ok: boolean }>;
  const save = (extra: object = {}) =>
    invoke('project:save', { path: project(), ...content(), storage: { type: 'policy-set', masterfiles: null }, ...extra }) as Promise<Saved>;
  const environmentsFile = () => join(project(), '.policy-builder', 'test-environments.json');

  it('refuses an untrusted sender', () => {
    expect(() => electron.handlers.get('project:save')?.(ipcEvent(false), {})).toThrow('untrusted sender');
  });

  it('saves only into a project opened in this session', async () => {
    expect(await save()).toMatchObject({ ok: false, message: 'Not a project opened in this session' });
    expect(compiled).not.toHaveBeenCalled();
  });

  it('keeps the test environments on save', async () => {
    const testEnvironments = [{ name: 'debian', image: 'debian:12' }];
    await writeTestEnvironments(project(), testEnvironments);
    expect((await open()).ok).toBe(true);
    expect(await save({ testEnvironments })).toEqual({ ok: true, masterfiles: '3.27.1' });
    expect(await readTestEnvironments(project())).toEqual(testEnvironments);
    expect(await fs.readFile(join(project(), 'main.cf'), 'utf-8')).toBe('bundle agent main {}\n');
  });

  it('removes the test environments file when a save has none', async () => {
    await writeTestEnvironments(project(), [{ name: 'debian' }]);
    await open();
    expect((await save()).ok).toBe(true);
    await expect(fs.stat(environmentsFile())).rejects.toThrow();
  });

  it('refuses to write generated policy outside the project', async () => {
    compiled.mockResolvedValue({ files: { './main.cf': 'x', '../evil.cf': 'x' }, sourceMap: {} });
    await open();
    expect(await save()).toMatchObject({ ok: false, message: 'Refusing to write generated policy outside the project: ../evil.cf' });
    await expect(fs.stat(join(temp, 'evil.cf'))).rejects.toThrow();
    await expect(fs.stat(join(project(), 'main.cf'))).rejects.toThrow();
  });

  it('removes stale generated files, but none outside the project', async () => {
    await fs.mkdir(join(project(), '.policy-builder'));
    const generated = ['./old/stale.cf', '../outside.cf', '/etc/hosts'];
    await fs.writeFile(join(project(), '.policy-builder', 'project.json'), JSON.stringify({ files: [], generated }));
    await fs.mkdir(join(project(), 'old'));
    await fs.writeFile(join(project(), 'old', 'stale.cf'), 'x');
    await fs.writeFile(join(temp, 'outside.cf'), 'x');
    await open();
    expect((await save()).ok).toBe(true);
    await expect(fs.stat(join(project(), 'old'))).rejects.toThrow();
    expect(await fs.readFile(join(temp, 'outside.cf'), 'utf-8')).toBe('x');
  });

  it('counts only paths inside an opened project as known', async () => {
    await open();
    await fs.mkdir(join(temp, 'outside'));
    await fs.writeFile(join(temp, 'outside', 'secret.env'), 'x');
    await fs.symlink(join(temp, 'outside'), join(project(), 'link'));
    expect(await isInKnownProject(join(project(), 'cfbs.json'))).toBe(true);
    expect(await isInKnownProject(join(project(), 'new', 'file.cf'))).toBe(true);
    expect(await isInKnownProject(project())).toBe(false);
    expect(await isInKnownProject(join(project(), '..', 'outside', 'secret.env'))).toBe(false);
    expect(await isInKnownProject(join(project(), 'link', 'secret.env'))).toBe(false);
  });
});
