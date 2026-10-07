import { blockDescriptorsById } from '../blocks/loadBlocks';
import type { BlockInstance, EditableSubject, ParamBinding } from '../store/canvasSlice/types';
import { type PasteOrigin, copyParamBindings, copySubjectFields, definedNames, requalifyParams, uniqueParamValue } from './pasteCopies';

const subject = (overrides: Partial<EditableSubject> = {}): EditableSubject => ({ params: {}, ...overrides });

const refs = [
  { id: 'r1', name: 'web_ready', negate: false },
  { id: 'r2', name: 'db_ready', negate: true }
];

// Pasted from the file in namespace "src", which defines web_ready and db_ready.
const origin: PasteOrigin = { namespace: 'src', classes: new Set(['web_ready', 'db_ready']), ownVariables: new Set(['own']) };

describe('copySubjectFields', () => {
  it('copies class references as they are within the same file', () => {
    const copy = copySubjectFields(subject({ classRefs: refs, condition: { kind: 'class', mode: 'if', className: 'web_ready' } }));
    expect(copy.classRefs?.map(ref => ref.name)).toEqual(['web_ready', 'db_ready']);
    expect(copy.classRefs?.map(ref => ref.negate)).toEqual([false, true]);
    expect(copy.condition).toEqual({ kind: 'class', mode: 'if', className: 'web_ready' });
  });

  it('qualifies classes the origin file defines across files; hard classes and qualified names stay', () => {
    const crossRefs = [...refs, { id: 'r3', name: 'linux', negate: false }, { id: 'r4', name: 'other:web_ready', negate: false }];
    const copy = copySubjectFields(subject({ classRefs: crossRefs, condition: { kind: 'class', mode: 'if', className: 'web_ready' } }), origin);
    expect(copy.classRefs?.map(ref => ref.name)).toEqual(['src:web_ready', 'src:db_ready', 'linux', 'other:web_ready']);
    expect(copy.classRefs?.map(ref => ref.negate)).toEqual([false, true, false, false]);
    expect(copy.condition).toEqual({ kind: 'class', mode: 'if', className: 'src:web_ready' });
    expect(copySubjectFields(subject({ condition: { kind: 'class', mode: 'unless', className: 'debian' } }), origin).condition?.className).toBe('debian');
  });

  it('qualifies variable references in steps across files', () => {
    const decorators = [{ id: 'd1', decoratorId: 'string-replace', params: { with: '$(vars.suffix)' } }];
    expect(copySubjectFields(subject({ decorators }), origin).decorators?.[0].params).toEqual({ with: '$(src:vars.suffix)' });
  });

  it('gives class references and steps fresh ids, keeping their content', () => {
    const decorators = [{ id: 'd1', decoratorId: 'string-trim', params: { a: '1' } }];
    const copy = copySubjectFields(subject({ classRefs: refs, decorators }));
    expect(copy.classRefs?.map(ref => ref.id)).not.toContain('r1');
    expect(copy.decorators?.[0].id).not.toBe('d1');
    expect(copy.decorators?.[0]).toMatchObject({ decoratorId: 'string-trim', params: { a: '1' } });
  });

  it('copies deeply, so editing the copy leaves the original alone', () => {
    const original = subject({
      decorators: [{ id: 'd1', decoratorId: 'string-trim', params: { a: '1' } }],
      condition: { kind: 'class', mode: 'if', className: 'x' },
      inventory: { attributeName: 'Role' }
    });
    const copy = copySubjectFields(original);
    copy.decorators![0].params.a = 'changed';
    copy.inventory!.attributeName = 'changed';
    copy.condition!.className = 'changed';
    expect(original.decorators![0].params.a).toBe('1');
    expect(original.inventory!.attributeName).toBe('Role');
    expect(original.condition!.className).toBe('x');
  });

  it('keeps missing fields missing', () => {
    expect(copySubjectFields(subject())).toEqual({ classRefs: undefined, condition: undefined, decorators: undefined, inventory: undefined });
  });
});

describe('requalifyParams', () => {
  const defineVariable = blockDescriptorsById.get('define-variable')!;
  const defineClass = blockDescriptorsById.get('define-class')!;

  it('copies parameters as they are within the same file', () => {
    const params = { value: '$(vars.port)' };
    const copy = requalifyParams(params, defineVariable, undefined);
    expect(copy).toEqual(params);
    expect(copy).not.toBe(params);
  });

  it('qualifies $(vars.x) and ${vars.x} with the origin namespace, but not what the block defines itself', () => {
    const params = { variable_name: 'url', value: 'http://$(vars.host):${vars.port}/$(sys.fqhost)/$(other:vars.x)/$(vars.own)' };
    expect(requalifyParams(params, defineVariable, origin)).toEqual({
      variable_name: 'url',
      value: 'http://$(src:vars.host):${src:vars.port}/$(sys.fqhost)/$(other:vars.x)/$(vars.own)'
    });
  });

  it('leaves Mustache paths alone: they always carry a namespace', () => {
    const params = { content: '{{{vars.src:vars.port}}} {{{vars.sys.fqhost}}} {{#classes.src:web_ready}}x{{/classes.src:web_ready}}' };
    expect(requalifyParams(params, blockDescriptorsById.get('render-template'), origin)).toEqual(params);
  });

  it('qualifies a parameter naming a variable', () => {
    expect(requalifyParams({ from_variable: 'vars.port' }, defineVariable, origin)).toEqual({ from_variable: 'src:vars.port' });
    expect(requalifyParams({ from_variable: 'sys.fqhost' }, defineVariable, origin)).toEqual({ from_variable: 'sys.fqhost' });
  });

  it('qualifies the origin file’s classes in a class expression, and in per-condition rows', () => {
    expect(requalifyParams({ condition: '(web_ready|linux).!other:db_ready' }, defineClass, origin)).toEqual({
      condition: '(src:web_ready|linux).!other:db_ready'
    });
    const cases = JSON.stringify([
      { className: 'web_ready', mode: 'if', value: '$(vars.a)' },
      { className: 'debian', mode: 'unless', value: 'b' }
    ]);
    expect(JSON.parse(requalifyParams({ cases }, defineVariable, origin).cases)).toEqual([
      { className: 'src:web_ready', mode: 'if', value: '$(src:vars.a)' },
      { className: 'debian', mode: 'unless', value: 'b' }
    ]);
  });
});

describe('copyParamBindings', () => {
  const bindings: Record<string, ParamBinding> = {
    package_name: {
      valueSourceId: 'file-content',
      params: { path: '/etc/pkg' },
      sampleInput: 'nginx',
      decorators: [{ id: 'd1', decoratorId: 'string-trim', params: { x: '1' } }]
    }
  };

  it('is undefined when there are none', () => {
    expect(copyParamBindings(undefined)).toBeUndefined();
  });

  it('copies each binding with fresh step ids', () => {
    const copy = copyParamBindings(bindings)!;
    expect(copy.package_name).toMatchObject({ valueSourceId: 'file-content', params: { path: '/etc/pkg' }, sampleInput: 'nginx' });
    expect(copy.package_name.decorators?.[0].id).not.toBe('d1');
    expect(copy.package_name.decorators?.[0]).toMatchObject({ decoratorId: 'string-trim', params: { x: '1' } });
  });

  it('copies deeply', () => {
    const copy = copyParamBindings(bindings)!;
    copy.package_name.params.path = 'changed';
    copy.package_name.decorators![0].params.x = 'changed';
    expect(bindings.package_name.params.path).toBe('/etc/pkg');
    expect(bindings.package_name.decorators![0].params.x).toBe('1');
  });
});

describe('uniqueParamValue', () => {
  it('keeps a free name, or an empty one', () => {
    expect(uniqueParamValue('web', new Set(['db']))).toBe('web');
    expect(uniqueParamValue('', new Set(['']))).toBe('');
  });

  it('suffixes _copy, then _copy2, _copy3…', () => {
    expect(uniqueParamValue('web', new Set(['web']))).toBe('web_copy');
    expect(uniqueParamValue('web', new Set(['web', 'web_copy']))).toBe('web_copy2');
    expect(uniqueParamValue('web', new Set(['web', 'web_copy', 'web_copy2']))).toBe('web_copy3');
  });
});

describe('definedNames', () => {
  const defineVariable = blockDescriptorsById.get('define-variable')!;
  const instance = (instanceId: string, blockId: string, names: string[]): BlockInstance => ({
    blockId,
    fileId: 'f1',
    instanceId,
    label: instanceId,
    params: {},
    entries: names.map((name, index) => ({ id: `${instanceId}-${index}`, valueSourceId: 'literal', params: { variable_name: name, class_name: name } }))
  });

  it('collects the trimmed names this kind of block defines', () => {
    const instances = [
      instance('a', 'define-variable', ['one', ' two ', '']),
      instance('b', 'define-variable', ['three']),
      instance('c', 'define-class', ['cls'])
    ];
    expect(definedNames(instances, 'define-variable', defineVariable)).toEqual(new Set(['one', 'two', 'three']));
  });

  it('is empty when nothing of that kind exists', () => {
    expect(definedNames([instance('c', 'define-class', ['cls'])], 'define-variable', defineVariable).size).toBe(0);
  });
});
