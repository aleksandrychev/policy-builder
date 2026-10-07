import type { BlockInstance } from '../../store/canvasSlice/types';
import type { PolicyFile } from '../../store/filesSlice/types';
import { hardClasses } from '../editor/hardClasses';
import { specialVariables } from '../editor/specialVariables';
import { buildClassNameOptions, buildTemplateTokens } from './classOptions';

const file = (id: string, name: string, extra: Partial<PolicyFile> = {}): PolicyFile => ({ id, name, namespace: id, parentId: null, ...extra });

const definitions = (instanceId: string, fileId: string, blockId: 'define-class' | 'define-variable', names: string[]): BlockInstance => ({
  instanceId,
  fileId,
  blockId,
  label: `${instanceId} label`,
  params: {},
  entries: names.map((name, index) => ({
    id: `${instanceId}-e${index}`,
    params: { [blockId === 'define-class' ? 'class_name' : 'variable_name']: name }
  }))
});

const files = new Map([
  ['main', file('main', 'Main')],
  ['web', file('web', 'Web', { condition: { kind: 'class', mode: 'if', className: 'linux' } })],
  ['base', file('base', 'Base', { condition: { kind: 'class', mode: 'unless', className: 'windows' } })],
  ['plain', file('plain', 'Plain')]
]);

const instances: BlockInstance[] = [
  definitions('web-classes', 'web', 'define-class', ['nginx_ok']),
  definitions('main-classes', 'main', 'define-class', ['ready', '  ', 'tuned']),
  definitions('main-vars', 'main', 'define-variable', ['port']),
  definitions('base-classes', 'base', 'define-class', ['hardened']),
  definitions('orphan', 'gone', 'define-class', ['lost']),
  { instanceId: 'report', fileId: 'main', blockId: 'report-message', label: 'Report', params: { message: 'hi' } }
];

describe('buildClassNameOptions', () => {
  it('lists this file, then other files by group, then hard classes', () => {
    const options = buildClassNameOptions(instances, files, 'main');
    const project = options.slice(0, options.length - hardClasses.length);

    expect(project).toEqual([
      { name: 'ready', label: 'main-classes label', group: 'Defined in this file' },
      { name: 'tuned', label: 'main-classes label', group: 'Defined in this file' },
      { name: 'base:hardened', label: 'base-classes label', group: 'Defined in Base · skipped if windows' },
      { name: 'web:nginx_ok', label: 'web-classes label', group: 'Defined in Web · runs only if linux' }
    ]);
    expect(options.slice(project.length).every(option => option.group === 'Hard classes')).toBe(true);
    expect(options.slice(project.length).map(option => option.name)).toEqual(hardClasses.map(hardClass => hardClass.name));
  });

  it('groups another file without a condition by its name alone', () => {
    const options = buildClassNameOptions([definitions('plain-classes', 'plain', 'define-class', ['x'])], files, 'main');
    expect(options[0].group).toBe('Defined in Plain');
  });

  it('treats every file as another file without a current one', () => {
    const groups = buildClassNameOptions(instances, files, null).map(option => option.group);
    expect(groups).not.toContain('Defined in this file');
  });

  it('leaves out the entry being edited', () => {
    const names = buildClassNameOptions(instances, files, 'main', 'main-classes-e0').map(option => option.name);
    expect(names).not.toContain('ready');
    expect(names).toContain('tuned');
  });

  it('labels a hard class by its description, else its name', () => {
    const options = buildClassNameOptions([], files, 'main');
    hardClasses.forEach((hardClass, index) => expect(options[index].label).toBe(hardClass.description ?? hardClass.name));
  });
});

describe('buildTemplateTokens', () => {
  it('offers this file’s classes and variables bare, another file’s qualified with its namespace', () => {
    const tokens = buildTemplateTokens(instances, files, 'main');
    const project = tokens.slice(0, tokens.length - specialVariables.length - hardClasses.length);

    expect(project).toEqual([
      {
        name: 'web:nginx_ok',
        mustachePath: 'classes.web:nginx_ok',
        label: 'web-classes label',
        group: 'Defined in Web · runs only if linux',
        kind: 'class'
      },
      { name: 'ready', mustachePath: 'classes.main:ready', label: 'main-classes label', group: 'Defined in this file', kind: 'class' },
      { name: 'tuned', mustachePath: 'classes.main:tuned', label: 'main-classes label', group: 'Defined in this file', kind: 'class' },
      { name: 'vars.port', mustachePath: 'vars.main:vars.port', label: 'main-vars label', group: 'Defined in this file', kind: 'variable' },
      {
        name: 'base:hardened',
        mustachePath: 'classes.base:hardened',
        label: 'base-classes label',
        group: 'Defined in Base · skipped if windows',
        kind: 'class'
      }
    ]);
  });

  it('qualifies another file’s variable with its namespace, in Mustache paths too', () => {
    const tokens = buildTemplateTokens(instances, files, 'web');
    expect(tokens.find(token => token.kind === 'variable')).toMatchObject({ name: 'main:vars.port', mustachePath: 'vars.main:vars.port' });
    expect(tokens.find(token => token.label === 'web-classes label')).toMatchObject({ name: 'nginx_ok', mustachePath: 'classes.web:nginx_ok' });
  });

  it('ends with the special variables, then the hard classes', () => {
    const tokens = buildTemplateTokens([], files, 'main');
    expect(tokens).toHaveLength(specialVariables.length + hardClasses.length);
    expect(tokens[0]).toMatchObject({ name: specialVariables[0].name, mustachePath: `vars.${specialVariables[0].name}`, kind: 'variable' });
    expect(tokens.at(-1)).toMatchObject({ name: hardClasses.at(-1)!.name, group: 'CFEngine hard classes', kind: 'class' });
  });

  it('leaves out the entry being edited', () => {
    const names = buildTemplateTokens(instances, files, 'main', 'main-vars-e0').map(token => token.name);
    expect(names).not.toContain('vars.port');
  });
});
