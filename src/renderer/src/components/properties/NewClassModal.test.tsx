import { fireEvent, screen, within } from '@testing-library/react';

import { renderWithProviders } from '../../test/render';
import { NewClassModal } from './NewClassModal';

function setup() {
  const onClose = vi.fn();
  const onCreate = vi.fn();
  renderWithProviders(<NewClassModal open classNameOptions={[]} templateTokens={[]} onClose={onClose} onCreate={onCreate} />);
  return { onClose, onCreate };
}

const nameField = () => screen.getByRole('textbox', { name: 'Class name' });
const createButton = () => screen.getByRole('button', { name: 'Create' });

function pickConditionType(label: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Condition type' }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: new RegExp(label) }));
}

describe('NewClassModal', () => {
  it('needs a class name', () => {
    setup();
    expect(createButton()).toBeDisabled();
    expect(screen.getByText('Letters, numbers, and underscores only.')).toBeInTheDocument();
  });

  it('keeps only canonical class name characters', () => {
    setup();
    fireEvent.change(nameField(), { target: { value: 'web-server 01.ok:x' } });
    expect(nameField()).toHaveValue('webserver01okx');
    fireEvent.change(nameField(), { target: { value: '-.' } });
    expect(nameField()).toHaveValue('');
    expect(createButton()).toBeDisabled();
  });

  it('creates an always-true class by default', () => {
    const { onClose, onCreate } = setup();
    expect(screen.getByRole('combobox', { name: 'Condition type' })).toHaveTextContent('Always true');
    fireEvent.change(nameField(), { target: { value: 'web_ready' } });
    fireEvent.click(createButton());
    expect(onCreate).toHaveBeenCalledWith({ className: 'web_ready', valueSourceId: 'always-true', params: {}, classRefs: [] });
    expect(onClose).toHaveBeenCalled();
    expect(nameField()).toHaveValue('');
  });

  it('creates a check with its parameters', () => {
    const { onCreate } = setup();
    fireEvent.change(nameField(), { target: { value: 'has_nginx' } });
    pickConditionType('File exists');
    fireEvent.change(screen.getByRole('textbox', { name: /File path/ }), { target: { value: '/usr/sbin/nginx' } });
    fireEvent.click(createButton());
    expect(onCreate).toHaveBeenCalledWith({ className: 'has_nginx', valueSourceId: 'check-file-exists', params: { path: '/usr/sbin/nginx' }, classRefs: [] });
  });

  it('creates a combination of classes', () => {
    const { onCreate } = setup();
    fireEvent.change(nameField(), { target: { value: 'debian_web' } });
    pickConditionType('All of these classes');
    fireEvent.click(screen.getByRole('button', { name: 'Add class' }));
    fireEvent.change(screen.getByPlaceholderText('Class name'), { target: { value: 'debian' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'NOT' }));
    fireEvent.click(createButton());
    expect(onCreate).toHaveBeenCalledWith({
      className: 'debian_web',
      valueSourceId: 'combine-and',
      params: {},
      classRefs: [{ id: expect.any(String), name: 'debian', negate: true }]
    });
  });

  it('cancels and resets the form', () => {
    const { onClose, onCreate } = setup();
    fireEvent.change(nameField(), { target: { value: 'web_ready' } });
    pickConditionType('Custom expression');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
    expect(nameField()).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Condition type' })).toHaveTextContent('Always true');
  });
});
