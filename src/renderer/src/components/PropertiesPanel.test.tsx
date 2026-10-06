import { fireEvent, screen, within } from '@testing-library/react';

import { newDefinitionEntry } from '../blocks/definitionEntries';
import { blockDescriptorsById } from '../blocks/loadBlocks';
import { useAppDispatch, useAppSelector } from '../store';
import {
  blockLabelChanged,
  blockParamChanged,
  blockValueSourceChanged,
  classRefAdded,
  classRefChanged,
  classRefRemoved,
  conditionClassNameChanged,
  conditionEnabled,
  conditionModeChanged,
  conditionRemoved,
  decoratorAdded,
  decoratorMoved,
  decoratorParamChanged,
  decoratorRemoved,
  entryAdded,
  entryMoved,
  entryRemoved,
  inventoryAttributeNameChanged,
  inventoryEnabled,
  inventoryRemoved,
  paramBound,
  paramUnbound
} from '../store/canvasSlice';
import type { BlockInstance, DefinitionEntry } from '../store/canvasSlice/types';
import { fileConditionClassNameChanged, fileConditionEnabled, fileSelected } from '../store/filesSlice';
import { type TestStore, addBlock, addFile, blockOf, makeStore } from '../store/test/storeTestUtils';
import { renderWithProviders } from '../test/render';
import { type IncomingArrow, PropertiesPanel } from './PropertiesPanel';

interface HarnessProps {
  arrows?: IncomingArrow[];
  instanceId: string;
  onArrowRemove?: (edgeId: string) => void;
  onConvertToData?: () => void;
  onIncomingModeChange?: (mode: 'all' | 'any') => void;
}

// Wired to the store the way ProjectView wires it (the gate-pill mode move left out).
function ConnectedPanel({ instanceId, arrows = [], onArrowRemove = vi.fn(), onConvertToData, onIncomingModeChange = vi.fn() }: HarnessProps) {
  const dispatch = useAppDispatch();
  const allInstances = useAppSelector(state => state.canvas);
  const { files, currentFileId } = useAppSelector(state => state.files);
  const instance = allInstances.find(item => item.instanceId === instanceId);
  const descriptor = instance && blockDescriptorsById.get(instance.blockId);
  return (
    <PropertiesPanel
      instance={instance}
      descriptor={descriptor}
      allInstances={allInstances}
      files={files}
      currentFileId={currentFileId}
      incomingArrows={arrows}
      emptyState={<p>Nothing selected</p>}
      onConvertToData={onConvertToData}
      onIncomingModeChange={onIncomingModeChange}
      onArrowOutcomesChange={vi.fn()}
      onArrowRemove={onArrowRemove}
      onLabelChange={label => dispatch(blockLabelChanged({ instanceId, label }))}
      onParamChange={(paramName, value, entryId) => dispatch(blockParamChanged({ instanceId, entryId, paramName, value }))}
      onValueSourceChange={(valueSourceId, entryId) => dispatch(blockValueSourceChanged({ instanceId, entryId, valueSourceId }))}
      onBindParam={(param, valueSourceId) => dispatch(paramBound({ instanceId, param, binding: { valueSourceId, params: {}, decorators: [] } }))}
      onUnbindParam={param => dispatch(paramUnbound({ instanceId, param }))}
      onEntryAdd={() => {
        const entry = newDefinitionEntry(descriptor!);
        dispatch(entryAdded({ instanceId, entry }));
        return entry.id;
      }}
      onEntryRemove={entryId => dispatch(entryRemoved({ instanceId, entryId }))}
      onEntryMove={(fromIndex, toIndex) => dispatch(entryMoved({ instanceId, fromIndex, toIndex }))}
      onDecoratorAdd={(decoratorId, entryId) => dispatch(decoratorAdded(instanceId, decoratorId, entryId))}
      onDecoratorRemove={(decoratorInstanceId, entryId) => dispatch(decoratorRemoved({ instanceId, entryId, decoratorInstanceId }))}
      onDecoratorParamChange={(decoratorInstanceId, paramName, value, entryId) =>
        dispatch(decoratorParamChanged({ instanceId, entryId, decoratorInstanceId, paramName, value }))
      }
      onDecoratorMove={(fromIndex, toIndex, entryId) => dispatch(decoratorMoved({ instanceId, entryId, fromIndex, toIndex }))}
      onClassRefAdd={entryId => dispatch(classRefAdded(instanceId, entryId))}
      onClassRefRemove={(classRefId, entryId) => dispatch(classRefRemoved({ instanceId, entryId, classRefId }))}
      onClassRefChange={(classRefId, patch, entryId) => dispatch(classRefChanged({ instanceId, entryId, classRefId, ...patch }))}
      onConditionEnable={entryId => dispatch(conditionEnabled({ instanceId, entryId }))}
      onConditionRemove={entryId => dispatch(conditionRemoved({ instanceId, entryId }))}
      onConditionModeChange={(mode, entryId) => dispatch(conditionModeChanged({ instanceId, entryId, mode }))}
      onConditionClassNameChange={(className, entryId) => dispatch(conditionClassNameChanged({ instanceId, entryId, className }))}
      onConditionCreateClass={vi.fn()}
      onCreateClass={vi.fn()}
      onInventoryEnable={entryId => dispatch(inventoryEnabled({ instanceId, entryId }))}
      onInventoryRemove={entryId => dispatch(inventoryRemoved({ instanceId, entryId }))}
      onInventoryAttributeNameChange={(attributeName, entryId) => dispatch(inventoryAttributeNameChanged({ instanceId, entryId, attributeName }))}
    />
  );
}

const renderPanel = (store: TestStore, props: HarnessProps) => renderWithProviders(<ConnectedPanel {...props} />, { store });

const descriptorOf = (blockId: string) => blockDescriptorsById.get(blockId)!;

const entry = (blockId: string, overrides: Partial<Omit<DefinitionEntry, 'id'>>) => newDefinitionEntry(descriptorOf(blockId), overrides);

const addDefinitions = (store: TestStore, fileId: string, blockId: 'define-class' | 'define-variable', entries: DefinitionEntry[], label = 'Definitions') =>
  addBlock(store, fileId, { blockId, label, params: {}, entries });

const variable = (name: string, overrides: Partial<Omit<DefinitionEntry, 'id'>> = {}) =>
  entry('define-variable', { ...overrides, params: { variable_name: name, value: 'x', ...overrides.params } });

const entriesOf = (store: TestStore, instanceId: string) => blockOf(store, instanceId)?.entries ?? [];

const firstEntry = (store: TestStore, instanceId: string) => entriesOf(store, instanceId)[0];

// Opens an MUI select by its label and picks an option.
function choose(label: string, option: string | RegExp) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }));
}

const expandSection = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('PropertiesPanel', () => {
  let store: TestStore;
  let fileId: string;

  beforeEach(() => {
    store = makeStore();
    fileId = addFile(store, 'Main');
  });

  it('shows the empty state without a block', () => {
    renderPanel(store, { instanceId: 'missing' });
    expect(screen.getByText('Nothing selected')).toBeInTheDocument();
  });

  describe('a plain block', () => {
    const add = (blockId: string, params: Record<string, string> = {}, extra: Partial<Omit<BlockInstance, 'instanceId'>> = {}) =>
      addBlock(store, fileId, { blockId, label: descriptorOf(blockId).name, params, ...extra });

    it('edits the label', () => {
      const id = add('report-message', { message: 'hi' });
      renderPanel(store, { instanceId: id });
      fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Say hello' } });
      expect(blockOf(store, id)?.label).toBe('Say hello');
    });

    it('edits a text param', () => {
      const id = add('manage-service', { service_name: '', action: 'start' });
      renderPanel(store, { instanceId: id });
      fireEvent.change(screen.getByRole('textbox', { name: 'Service name' }), { target: { value: 'nginx' } });
      expect(blockOf(store, id)?.params.service_name).toBe('nginx');
    });

    it('picks a select param, showing the option help', () => {
      const id = add('manage-service', { service_name: 'nginx', action: 'start' });
      renderPanel(store, { instanceId: id });
      choose('Action', 'Restart');
      expect(blockOf(store, id)?.params.action).toBe('restart');
      expect(screen.getByText(/Restarts it every time this block runs/)).toBeInTheDocument();
    });

    it('labels an empty-valued option', () => {
      const id = add('report-message', { message: 'hi', run_interval: '' });
      renderPanel(store, { instanceId: id });
      expect(screen.getByRole('combobox', { name: 'How often' })).toHaveTextContent('Every agent run');
    });

    it('flags a relative path', () => {
      const id = add('report-message', { message: 'hi', report_to_file: '' });
      renderPanel(store, { instanceId: id });
      const field = screen.getByRole('textbox', { name: 'Report to file' });
      fireEvent.change(field, { target: { value: 'log.txt' } });
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByText('Must be an absolute path (start with /).')).toBeInTheDocument();
      fireEvent.change(field, { target: { value: '/var/log/x' } });
      expect(field).toHaveAttribute('aria-invalid', 'false');
    });

    it('flags each relative path of a list', () => {
      const id = add('remove-file', { path: '/tmp/a\nb\nc' });
      renderPanel(store, { instanceId: id });
      expect(screen.getByText('Not an absolute path: b, c')).toBeInTheDocument();
    });

    it('checks a number against its minimum and rejects non-digits', () => {
      const id = add('clean-up-old-files', { directory: '/tmp', days: '7', depth: 'inf' });
      renderPanel(store, { instanceId: id });
      const days = screen.getByRole('textbox', { name: 'Older than (days)' });
      fireEvent.change(days, { target: { value: '0' } });
      expect(screen.getByText('Must be at least 1.')).toBeInTheDocument();
      fireEvent.change(days, { target: { value: '-3' } });
      fireEvent.change(days, { target: { value: '1x' } });
      expect(blockOf(store, id)?.params.days).toBe('0');
    });

    it('opens the editor for a list field', () => {
      const id = add('install-package', { package_name: 'nginx' });
      renderPanel(store, { instanceId: id });
      const field = screen.getByRole('textbox', { name: 'Package name' });
      expect(field).toHaveAttribute('readonly');
      fireEvent.click(field);
      expect(screen.getByRole('dialog')).toHaveTextContent('Package name');
    });

    it('binds a param to data and back', () => {
      const id = add('report-message', { message: 'hi' });
      renderPanel(store, { instanceId: id });
      fireEvent.click(screen.getByRole('button', { name: /compute Message from data/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: /Command output/ }));
      expect(blockOf(store, id)?.paramBindings?.message?.valueSourceId).toBe('command-output');
      expect(screen.getByText('Message — from data')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Type it instead' }));
      expect(blockOf(store, id)?.paramBindings).toEqual({});
    });

    it('offers turning Run Command into data', () => {
      const id = add('run-command', { command: 'ls' });
      const onConvertToData = vi.fn();
      renderPanel(store, { instanceId: id, onConvertToData });
      fireEvent.click(screen.getByRole('button', { name: 'Use its output as data' }));
      expect(onConvertToData).toHaveBeenCalled();
    });

    it('lists incoming arrows', () => {
      const id = add('report-message', { message: 'hi' });
      const onArrowRemove = vi.fn();
      const onIncomingModeChange = vi.fn();
      const arrows: IncomingArrow[] = [
        { edgeId: 'e1', outcomes: ['kept'], sourceLabel: 'Install nginx', sourceOrder: 1 },
        { edgeId: 'e2', outcomes: ['repaired'], sourceLabel: 'Write config' }
      ];
      renderPanel(store, { instanceId: id, arrows, onArrowRemove, onIncomingModeChange });
      expect(screen.getByText('Install nginx')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Any of these' }));
      expect(onIncomingModeChange).toHaveBeenCalledWith('any');
      fireEvent.click(screen.getAllByTitle('Remove arrow')[1]);
      expect(onArrowRemove).toHaveBeenCalledWith('e2');
    });

    describe('condition', () => {
      const withCondition = () => add('report-message', { message: 'hi' }, { condition: { kind: 'class', mode: 'if', className: '' } });

      it('adds a condition', () => {
        const id = add('report-message', { message: 'hi' });
        renderPanel(store, { instanceId: id });
        expandSection(/^Condition \(0\)/);
        fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
        expect(blockOf(store, id)?.condition).toEqual({ kind: 'class', mode: 'if', className: '' });
      });

      it('types a class name, keeping only class characters', () => {
        const id = withCondition();
        renderPanel(store, { instanceId: id });
        fireEvent.change(screen.getByPlaceholderText('Search class names…'), { target: { value: 'debian-12' } });
        expect(blockOf(store, id)?.condition?.className).toBe('debian12');
      });

      it('switches between if and unless', () => {
        const id = withCondition();
        renderPanel(store, { instanceId: id });
        choose('Mode', 'Skip if');
        expect(blockOf(store, id)?.condition?.mode).toBe('unless');
      });

      it('removes a condition', () => {
        const id = withCondition();
        renderPanel(store, { instanceId: id });
        fireEvent.click(screen.getByRole('button', { name: 'Remove condition' }));
        expect(blockOf(store, id)?.condition).toBeUndefined();
      });

      it('offers classes from this file, other files and hard classes', () => {
        const otherId = addFile(store, 'Detect');
        store.dispatch(fileConditionEnabled({ fileId: otherId }));
        store.dispatch(fileConditionClassNameChanged({ fileId: otherId, className: 'linux' }));
        addDefinitions(store, otherId, 'define-class', [entry('define-class', { params: { class_name: 'is_web' } })]);
        addDefinitions(store, fileId, 'define-class', [entry('define-class', { params: { class_name: 'is_local' } })]);
        store.dispatch(fileSelected({ fileId }));
        const id = add('report-message', { message: 'hi' }, { condition: { kind: 'class', mode: 'if', className: '' } });
        renderPanel(store, { instanceId: id });

        fireEvent.mouseDown(screen.getByPlaceholderText('Search class names…'));
        const listbox = screen.getByRole('listbox');
        expect(within(listbox).getByText('Defined in this file')).toBeInTheDocument();
        expect(within(listbox).getByText('Defined in Detect · runs only if linux')).toBeInTheDocument();
        expect(within(listbox).getByText('Hard classes')).toBeInTheDocument();
        fireEvent.click(within(listbox).getByText('is_web'));
        expect(blockOf(store, id)?.condition?.className).toBe('is_web');
      });

      it('notes a condition the file already requires', () => {
        store.dispatch(fileConditionEnabled({ fileId }));
        store.dispatch(fileConditionClassNameChanged({ fileId, className: 'linux' }));
        const id = add('report-message', { message: 'hi' }, { condition: { kind: 'class', mode: 'if', className: 'linux' } });
        renderPanel(store, { instanceId: id });
        expect(screen.getByText('Already required by the file’s condition.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        expect(blockOf(store, id)?.condition).toBeUndefined();
      });

      it('warns about a condition opposite to the file’s', () => {
        store.dispatch(fileConditionEnabled({ fileId }));
        store.dispatch(fileConditionClassNameChanged({ fileId, className: 'linux' }));
        const id = add('report-message', { message: 'hi' }, { condition: { kind: 'class', mode: 'unless', className: 'linux' } });
        renderPanel(store, { instanceId: id });
        expect(screen.getByText('The file’s condition is the opposite, so this never runs.')).toBeInTheDocument();
      });
    });
  });

  describe('Define Variable with one entry', () => {
    let id: string;

    // Transforms apply to a computed value, not a typed-in one.
    const toCommandOutput = () =>
      store.dispatch(blockValueSourceChanged({ instanceId: id, entryId: firstEntry(store, id).id, valueSourceId: 'command-output' }));

    beforeEach(() => {
      id = addDefinitions(store, fileId, 'define-variable', [variable('greeting')]);
    });

    it('filters the variable name to allowed characters', () => {
      renderPanel(store, { instanceId: id });
      fireEvent.change(screen.getByRole('textbox', { name: 'Variable name' }), { target: { value: 'my-var!' } });
      expect(firstEntry(store, id).params.variable_name).toBe('myvar');
    });

    it('switches the value source', () => {
      renderPanel(store, { instanceId: id });
      choose('Value source', /Command output/);
      expect(firstEntry(store, id).valueSourceId).toBe('command-output');
      fireEvent.change(screen.getByRole('textbox', { name: 'Command' }), { target: { value: '/bin/date' } });
      expect(firstEntry(store, id).params.command).toBe('/bin/date');
    });

    const addStep = (label: RegExp) => {
      fireEvent.click(screen.getByRole('button', { name: 'Add transform' }));
      fireEvent.click(screen.getByRole('menuitem', { name: label }));
    };
    const steps = () => firstEntry(store, id).decorators?.map(step => step.decoratorId);
    const withSteps = (...decoratorIds: string[]) => {
      toCommandOutput();
      for (const decoratorId of decoratorIds) store.dispatch(decoratorAdded(id, decoratorId, firstEntry(store, id).id));
    };

    it('adds transforms that fit the chain', () => {
      toCommandOutput();
      renderPanel(store, { instanceId: id });
      expandSection(/^Data transformation \(0\)/);
      fireEvent.click(screen.getByRole('button', { name: 'Add transform' }));
      // A string chain can't take list transforms yet.
      expect(screen.getByRole('menuitem', { name: /Sort/ })).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(screen.getByRole('menuitem', { name: /Uppercase/ }));
      addStep(/Split into a list/);
      expect(steps()).toEqual(['string-upcase', 'split-list']);
      expect(screen.getByText('Result: list')).toBeInTheDocument();
    });

    it('edits a step parameter', () => {
      withSteps('split-list');
      renderPanel(store, { instanceId: id });
      fireEvent.change(screen.getByRole('textbox', { name: 'Split on (regex)' }), { target: { value: ',' } });
      expect(firstEntry(store, id).decorators?.[0].params.delimiter).toBe(',');
    });

    it('reorders and removes steps', () => {
      withSteps('string-upcase', 'split-list');
      renderPanel(store, { instanceId: id });
      expect(screen.getAllByRole('button', { name: 'Move step up' })[0]).toBeDisabled();
      fireEvent.click(screen.getAllByRole('button', { name: 'Move step up' })[1]);
      expect(steps()).toEqual(['split-list', 'string-upcase']);

      fireEvent.click(screen.getAllByRole('button', { name: 'Remove step' })[0]);
      expect(steps()).toEqual(['string-upcase']);
      expect(screen.getByText('Result: string')).toBeInTheDocument();
    });

    it('searches transforms', () => {
      toCommandOutput();
      renderPanel(store, { instanceId: id });
      expandSection(/^Data transformation/);
      fireEvent.click(screen.getByRole('button', { name: 'Add transform' }));
      fireEvent.change(screen.getByPlaceholderText('Search transforms…'), { target: { value: 'trim' } });
      const items = screen.getAllByRole('menuitem');
      expect(items).toHaveLength(1);
      expect(items[0]).toHaveTextContent('Trim whitespace');
    });

    it('previews a chain', () => {
      withSteps('string-upcase');
      renderPanel(store, { instanceId: id });
      fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('offers transforms only for a computed value', () => {
      renderPanel(store, { instanceId: id });
      expect(screen.queryByRole('button', { name: /Data transformation/ })).not.toBeInTheDocument();
      choose('Value source', /File content/);
      expect(screen.getByRole('button', { name: 'Data transformation (0)' })).toBeInTheDocument();
      choose('Value source', /Structured data \(JSON\)/);
      expect(screen.queryByRole('button', { name: /Data transformation/ })).not.toBeInTheDocument();
    });

    it('tags the variable for inventory', () => {
      renderPanel(store, { instanceId: id });
      expandSection(/^Inventory/);
      fireEvent.click(screen.getByRole('switch', { name: 'Report variable' }));
      expect(firstEntry(store, id).inventory).toEqual({ attributeName: '' });

      fireEvent.change(screen.getByRole('textbox', { name: 'Attribute name' }), { target: { value: 'Owner' } });
      expect(firstEntry(store, id).inventory).toEqual({ attributeName: 'Owner' });

      fireEvent.click(screen.getByRole('button', { name: 'Remove inventory tag' }));
      expect(firstEntry(store, id).inventory).toBeUndefined();
    });

    it('puts the block condition on the block, not the entry', () => {
      renderPanel(store, { instanceId: id });
      expandSection(/^Condition \(0\)/);
      fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
      expect(blockOf(store, id)?.condition).toBeDefined();
      expect(firstEntry(store, id).condition).toBeUndefined();
    });

    it('adds another variable and opens it', () => {
      renderPanel(store, { instanceId: id });
      fireEvent.click(screen.getByRole('button', { name: 'Add another variable' }));
      expect(entriesOf(store, id)).toHaveLength(2);
      expect(screen.getByText('Variable 2 of 2')).toBeInTheDocument();
    });
  });

  describe('Define Variable with several entries', () => {
    let id: string;
    const names = () => entriesOf(store, id).map(item => item.params.variable_name);

    beforeEach(() => {
      id = addDefinitions(store, fileId, 'define-variable', [variable('a'), variable('b'), variable('c')], 'Vars');
    });

    it('lists the entries', () => {
      renderPanel(store, { instanceId: id });
      expect(screen.getByText('Variables (3)')).toBeInTheDocument();
      for (const name of ['a', 'b', 'c']) expect(screen.getByRole('button', { name: `Edit ${name}` })).toBeInTheDocument();
    });

    it('reorders entries', () => {
      renderPanel(store, { instanceId: id });
      expect(screen.getByRole('button', { name: 'Move a up' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move c down' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Move a down' }));
      expect(names()).toEqual(['b', 'a', 'c']);
    });

    it('removes an entry from the list', () => {
      renderPanel(store, { instanceId: id });
      fireEvent.click(screen.getByRole('button', { name: 'Remove b' }));
      expect(names()).toEqual(['a', 'c']);
    });

    it('marks names used twice in the file', () => {
      addDefinitions(store, fileId, 'define-variable', [variable('a')]);
      renderPanel(store, { instanceId: id });
      expect(within(screen.getByRole('button', { name: 'Edit a' })).getByText('Name already used in this file')).toBeInTheDocument();
    });

    it('steps through entries', () => {
      renderPanel(store, { instanceId: id });
      fireEvent.click(screen.getByRole('button', { name: 'Edit a' }));
      expect(screen.getByText('Variable 1 of 3')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(screen.getByRole('textbox', { name: 'Variable name' })).toHaveValue('b');
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      // The last entry offers adding one instead of Next.
      expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('title', 'Add another variable');
      fireEvent.click(screen.getByTitle('Back to all variables'));
      expect(screen.getByText('Variables (3)')).toBeInTheDocument();
    });

    it('edits the open entry, warning on a taken name', () => {
      renderPanel(store, { instanceId: id });
      fireEvent.click(screen.getByRole('button', { name: 'Edit b' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Variable name' }), { target: { value: 'bee' } });
      expect(names()).toEqual(['a', 'bee', 'c']);
      expect(screen.queryByText(/already uses this name/)).not.toBeInTheDocument();
      fireEvent.change(screen.getByRole('textbox', { name: 'Variable name' }), { target: { value: 'a' } });
      expect(screen.getByText(/Another variable in this file already uses this name/)).toBeInTheDocument();
    });

    it('removes the open entry and returns to the list', () => {
      renderPanel(store, { instanceId: id });
      fireEvent.click(screen.getByRole('button', { name: 'Edit c' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      expect(names()).toEqual(['a', 'b']);
      expect(screen.getByText('Variables (2)')).toBeInTheDocument();
    });

    it('gates an open entry with its own condition', () => {
      renderPanel(store, { instanceId: id });
      fireEvent.click(screen.getByRole('button', { name: 'Edit a' }));
      expandSection(/^Condition \(0\)/);
      fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
      expect(firstEntry(store, id).condition).toBeDefined();
      expect(blockOf(store, id)?.condition).toBeUndefined();
    });

    it('describes the block condition as covering every entry', () => {
      renderPanel(store, { instanceId: id });
      expect(screen.getByText('Gates whether every variable in this block evaluates at all.')).toBeInTheDocument();
    });
  });

  describe('Define Class combining classes', () => {
    it('adds, negates and removes classes', () => {
      const id = addDefinitions(store, fileId, 'define-class', [entry('define-class', { params: { class_name: 'both' }, valueSourceId: 'combine-and' })]);
      renderPanel(store, { instanceId: id });
      fireEvent.click(screen.getByRole('button', { name: 'Add class' }));
      fireEvent.change(screen.getByPlaceholderText('Class name'), { target: { value: 'linux' } });
      fireEvent.click(screen.getByRole('checkbox', { name: 'NOT' }));
      expect(firstEntry(store, id).classRefs).toEqual([expect.objectContaining({ name: 'linux', negate: true })]);

      fireEvent.click(screen.getByRole('button', { name: 'Remove class' }));
      expect(firstEntry(store, id).classRefs).toEqual([]);
    });
  });
});
