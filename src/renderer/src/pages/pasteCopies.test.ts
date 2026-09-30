import { blockDescriptorsById } from '../blocks/loadBlocks';
import type { BlockInstance, EditableSubject, ParamBinding } from '../store/canvasSlice/types';
import { copyParamBindings, copySubjectFields, definedNames, uniqueParamValue } from './pasteCopies';

const subject = (overrides: Partial<EditableSubject> = {}): EditableSubject => ({ params: {}, ...overrides });

const refs = [
  { id: 'r1', name: 'web_ready', negate: false },
  { id: 'r2', name: 'other:db_ready', negate: true }
];

describe('copySubjectFields', () => {
  it('qualifies same-file class references with the source namespace across files', () => {
    const copy = copySubjectFields(subject({ classRefs: refs, condition: { kind: 'class', mode: 'if', className: 'web_ready' } }), 'src_ns', true);
    expect(copy.classRefs?.map(ref => ref.name)).toEqual(['src_ns:web_ready', 'other:db_ready']);
    expect(copy.classRefs?.map(ref => ref.negate)).toEqual([false, true]);
    expect(copy.condition).toEqual({ kind: 'class', mode: 'if', className: 'src_ns:web_ready' });
  });

  it('leaves already-qualified names alone', () => {
    const copy = copySubjectFields(subject({ condition: { kind: 'class', mode: 'unless', className: 'other:db_ready' } }), 'src_ns', true);
    expect(copy.condition?.className).toBe('other:db_ready');
  });

  it('leaves names alone within the same file, without a namespace, or when empty', () => {
    const input = subject({ classRefs: refs, condition: { kind: 'class', mode: 'if', className: 'web_ready' } });
    expect(copySubjectFields(input, 'src_ns', false).classRefs?.[0].name).toBe('web_ready');
    expect(copySubjectFields(input, undefined, true).condition?.className).toBe('web_ready');
    expect(copySubjectFields(subject({ condition: { kind: 'class', mode: 'if', className: '' } }), 'src_ns', true).condition?.className).toBe('');
  });

  it('gives class references and steps fresh ids, keeping their content', () => {
    const decorators = [{ id: 'd1', decoratorId: 'string-trim', params: { a: '1' } }];
    const copy = copySubjectFields(subject({ classRefs: refs, decorators }), 'src_ns', false);
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
    const copy = copySubjectFields(original, 'src_ns', false);
    copy.decorators![0].params.a = 'changed';
    copy.inventory!.attributeName = 'changed';
    copy.condition!.className = 'changed';
    expect(original.decorators![0].params.a).toBe('1');
    expect(original.inventory!.attributeName).toBe('Role');
    expect(original.condition!.className).toBe('x');
  });

  it('keeps missing fields missing', () => {
    expect(copySubjectFields(subject(), 'src_ns', true)).toEqual({ classRefs: undefined, condition: undefined, decorators: undefined, inventory: undefined });
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
