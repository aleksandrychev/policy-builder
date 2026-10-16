import { filterCatalog, modulesToAdd, modulesToRemove, parseIndex } from './catalog';

const index = {
  'delete-files': { description: 'Deletes files', tags: ['supported', 'management'], version: '2.0.0', input: [{ type: 'list', variable: 'files' }] },
  'promise-type-git': { description: 'Manage git repos', tags: ['promise-type'], dependencies: ['library-for-promise-types-in-python'] },
  'library-for-promise-types-in-python': { description: 'Library', tags: ['library'] },
  'ssh-limits': { description: 'Limit SSH', tags: ['experimental', 'ssh'], dependencies: ['library-sshd-config'] },
  'library-sshd-config': { description: 'sshd config', tags: ['library'] },
  'git-old': { alias: 'promise-type-git' }
};
const modules = parseIndex(index);
const byName = new Map(modules.map(module => [module.name, module]));
const names = (matches: { module: { name: string } }[]) => matches.map(match => match.module.name);

describe('the module catalog', () => {
  it('derives kinds and folds aliases into their module', () => {
    expect(byName.get('delete-files')).toMatchObject({ kind: 'configured', supported: true });
    expect(byName.get('promise-type-git')).toMatchObject({ kind: 'promise-type', aliases: ['git-old'] });
    expect(byName.get('ssh-limits')).toMatchObject({ kind: 'policy', experimental: true });
    expect(byName.has('git-old')).toBe(false);
  });

  it('searches names, descriptions, tags and aliases; hides libraries unless asked', () => {
    const all = { search: '', supportedOnly: false, tag: null };
    expect(names(filterCatalog(modules, all))).toEqual(['delete-files', 'promise-type-git', 'ssh-limits']);
    expect(names(filterCatalog(modules, { ...all, tag: 'library' }))).toEqual(['library-for-promise-types-in-python', 'library-sshd-config']);
    expect(names(filterCatalog(modules, { ...all, search: 'sshd' }))).toEqual(['library-sshd-config']);
    expect(filterCatalog(modules, { ...all, search: 'old' })).toEqual([{ module: byName.get('promise-type-git'), alias: 'git-old' }]);
    expect(names(filterCatalog(modules, { ...all, supportedOnly: true }))).toEqual(['delete-files']);
    expect(names(filterCatalog(modules, { ...all, search: 'files deletes' }))).toEqual(['delete-files']);
    expect(filterCatalog(modules, { ...all, search: 'delete git' })).toEqual([]);
  });

  it('adds a module with its dependencies, and removes those nothing else needs', () => {
    const added = modulesToAdd(byName, 'promise-type-git', []);
    expect(added).toEqual([
      { name: 'promise-type-git', version: undefined },
      { name: 'library-for-promise-types-in-python', version: undefined, addedBy: 'promise-type-git' }
    ]);
    expect(modulesToAdd(byName, 'promise-type-git', added)).toEqual([]);
    expect(modulesToRemove(byName, 'promise-type-git', added)).toEqual(['promise-type-git', 'library-for-promise-types-in-python']);
    // Still needed by another module: it stays.
    const both = [...added, { name: 'other' }];
    byName.set('other', { ...byName.get('delete-files')!, name: 'other', dependencies: ['library-for-promise-types-in-python'] });
    expect(modulesToRemove(byName, 'promise-type-git', both)).toEqual(['promise-type-git']);
  });
});
