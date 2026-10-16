import { indexModulesOf } from '../project/cfbsProject';
import type { ModuleInputQuestion } from './catalog';
import { isSupported, needsInput, newEntry } from './moduleInput';

const files: ModuleInputQuestion = {
  type: 'list',
  variable: 'files',
  subtype: [
    { key: 'path', type: 'string' },
    { key: 'why', type: 'string', default: 'Unknown' }
  ]
};
const motd: ModuleInputQuestion = { type: 'string', variable: 'motd' };

describe('module input', () => {
  it('needs input until every question is answered', () => {
    expect(needsInput([files, motd], undefined)).toBe(true);
    expect(needsInput([files, motd], { files: [], motd: 'Hi' })).toBe(true);
    expect(needsInput([files, motd], { files: [{ path: '/a', why: 'x' }], motd: ' ' })).toBe(true);
    expect(needsInput([files, motd], { files: [{ path: '/a', why: 'x' }], motd: 'Hi' })).toBe(false);
  });

  it('starts a list entry from its defaults; file inputs are not supported yet', () => {
    expect(newEntry(files)).toEqual({ path: '', why: 'Unknown' });
    expect(newEntry({ type: 'list', variable: 'hosts', subtype: { type: 'string' } })).toBe('');
    expect(isSupported({ type: 'list', variable: 'playbooks', subtype: [{ key: 'file', type: 'file' }] })).toBe(false);
  });

  it('reads the project’s modules from cfbs.json, with their answers', () => {
    const build = [
      { name: 'masterfiles', commit: 'a' },
      { name: 'library-for-promise-types-in-python', commit: 'b', version: '0.3.1', added_by: 'promise-type-git' },
      { name: 'promise-type-git', commit: 'c', added_by: 'cfbs add' },
      { name: 'delete-files', commit: 'd', added_by: 'cfbs add' },
      { name: './mods.cf', added_by: 'cfbs add', steps: [] }
    ];
    const inputs = { 'delete-files': [{ variable: 'files', response: [{ path: '/a', why: 'x' }] }, { variable: 'unanswered' }] };
    expect(indexModulesOf(build, inputs)).toEqual([
      { name: 'library-for-promise-types-in-python', version: '0.3.1', addedBy: 'promise-type-git' },
      { name: 'promise-type-git' },
      { name: 'delete-files', input: { files: [{ path: '/a', why: 'x' }] } }
    ]);
  });
});
