import { fireEvent, screen, waitFor } from '@testing-library/react';

import { installApi, renderWithProviders, uninstallApi } from '../../test/render';
import type { TemplateToken } from '../editor/templateTokens';
import { TemplateEditorDialog } from './TemplateEditorDialog';

const TOKENS: TemplateToken[] = [
  { kind: 'variable', name: 'pkg_name', label: 'Package' },
  { kind: 'variable', name: 'listen_port', label: 'Port', mustachePath: 'vars.web:main.listen_port' },
  { kind: 'class', name: 'is_debian', label: 'Debian hosts', group: 'Classes' }
];

function setup(props: { help?: string; mustache?: boolean; value?: string; variables?: TemplateToken[] } = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn();
  const view = renderWithProviders(
    <TemplateEditorDialog
      open
      title="Command"
      value={props.value ?? 'echo '}
      variables={props.variables ?? TOKENS}
      mustache={props.mustache ?? false}
      help={props.help}
      onClose={onClose}
      onSave={onSave}
    />
  );
  return { onClose, onSave, view };
}

const editorText = () => document.querySelector('.cm-content')?.textContent;
const chip = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

describe('TemplateEditorDialog', () => {
  afterEach(uninstallApi);

  it('edits CFEngine text with variables only', () => {
    setup({ help: 'Mustache help' });
    expect(screen.getByRole('heading', { name: 'Command' })).toBeInTheDocument();
    expect(screen.queryByText('Mustache help')).not.toBeInTheDocument();
    expect(editorText()).toBe('echo ');
    expect(chip('pkg_name')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /is_debian/ })).not.toBeInTheDocument();
  });

  it('inserts a variable as $(name) and saves', async () => {
    const { onClose, onSave } = setup();
    await waitFor(() => {
      fireEvent.click(chip('pkg_name'));
      expect(editorText()).toContain('$(pkg_name)');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('$(pkg_name)echo ');
    expect(onClose).toHaveBeenCalled();
  });

  it('inserts Mustache variables and class sections', async () => {
    const { onSave } = setup({ mustache: true, value: '', help: 'Mustache help' });
    expect(screen.getByText('Mustache help')).toBeInTheDocument();
    await waitFor(() => {
      fireEvent.click(chip('listen_port'));
      expect(editorText()).toBe('{{{vars.web:main.listen_port}}}');
    });
    fireEvent.click(chip('is_debian'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('{{{vars.web:main.listen_port}}}{{#is_debian}}{{/is_debian}}');
  });

  it('filters tokens by name or label', () => {
    setup({ mustache: true });
    fireEvent.change(screen.getByPlaceholderText('Filter…'), { target: { value: 'debian' } });
    expect(chip('is_debian')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pkg_name/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Filter…'), { target: { value: 'package' } });
    expect(chip('pkg_name')).toBeInTheDocument();
  });

  it('collapses long groups until filtered', () => {
    const many = Array.from({ length: 13 }, (_, index): TemplateToken => ({ kind: 'variable', name: `sys_var_${index}`, group: 'Special' }));
    setup({ variables: many });
    const header = screen.getByRole('button', { name: 'Special (13)' });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /sys_var_0/ })).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(chip('sys_var_0')).toBeInTheDocument();
    fireEvent.click(header);
    fireEvent.change(screen.getByPlaceholderText('Filter…'), { target: { value: 'var_1' } });
    expect(screen.getByRole('button', { name: 'Special (4)' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('imports a file into the editor', async () => {
    const api = installApi({ importTextFile: vi.fn(async () => ({ content: 'imported text', fileName: 'a.txt' })) });
    const { onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Import from file' }));
    await waitFor(() => expect(editorText()).toBe('imported text'));
    expect(api.importTextFile).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('imported text');
  });

  it('shows an import error', async () => {
    installApi({ importTextFile: vi.fn(async () => Promise.reject(new Error('Not a text file'))) });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Import from file' }));
    expect(await screen.findByText('Not a text file')).toBeInTheDocument();
    expect(editorText()).toBe('echo ');
  });

  it('cancels without saving', () => {
    const { onClose, onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('closes on Escape only without edits', async () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      fireEvent.click(chip('pkg_name'));
      expect(editorText()).toContain('$(pkg_name)');
    });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
