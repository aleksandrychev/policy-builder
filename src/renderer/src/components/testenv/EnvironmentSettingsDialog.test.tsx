import { fireEvent, screen } from '@testing-library/react';

import type { TestEnvironment } from '../../store/testEnvironmentsSlice/types';
import { renderWithProviders } from '../../test/render';
import { EnvironmentSettingsDialog } from './EnvironmentSettingsDialog';

const ENVIRONMENT: TestEnvironment = {
  id: 'e1',
  name: 'Staging',
  arch: 'x86_64',
  edition: 'community',
  version: 'latest',
  env: { APP_ENV: 'staging' },
  envFile: null,
  hosts: [],
  hub: 'h1'
};

interface Options {
  busy?: boolean;
  canDestroy?: boolean;
  engineArch?: string;
  environment?: Partial<TestEnvironment>;
  saved?: boolean;
}

function setup({ environment, busy = false, canDestroy = true, saved = true, engineArch }: Options = {}) {
  const callbacks = { onChange: vi.fn(), onClose: vi.fn(), onDestroy: vi.fn(), onEnvChange: vi.fn() };
  const { unmount } = renderWithProviders(
    <EnvironmentSettingsDialog
      environment={{ ...ENVIRONMENT, ...environment }}
      busy={busy}
      canDestroy={canDestroy}
      saved={saved}
      engineArch={engineArch}
      {...callbacks}
    />
  );
  return { ...callbacks, unmount };
}

const select = (name: string) => screen.getByRole('combobox', { name });
function pick(name: string, option: string) {
  fireEvent.mouseDown(select(name));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

describe('EnvironmentSettingsDialog', () => {
  it('renames the environment once, on blur', () => {
    const { onChange } = setup();
    const name = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: 'P' } });
    fireEvent.change(name, { target: { value: 'Prod' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(name);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ name: 'Prod' });
  });

  it('changes the edition', () => {
    const { onChange } = setup();
    expect(select('Edition')).toHaveTextContent('Community');
    pick('Edition', 'Enterprise');
    expect(onChange).toHaveBeenCalledWith({ edition: 'enterprise' });
  });

  it('notes Mission Portal for Enterprise', () => {
    setup({ environment: { edition: 'enterprise' } });
    expect(screen.getByText('The hub runs Mission Portal (publish port 443)')).toBeInTheDocument();
  });

  it('changes the architecture and says when it is emulated', () => {
    const { onChange } = setup({ engineArch: 'aarch64' });
    expect(screen.getByText('Emulated by Docker (slower)')).toBeInTheDocument();
    pick('Architecture', 'arm64');
    expect(onChange).toHaveBeenCalledWith({ arch: 'aarch64' });
  });

  it('says native when the engine matches', () => {
    setup({ engineArch: 'x86_64' });
    expect(screen.getByText('Native')).toBeInTheDocument();
  });

  it('trims the version and falls back to latest', () => {
    const { onChange } = setup();
    const version = screen.getByRole('textbox', { name: 'CFEngine version' });
    fireEvent.change(version, { target: { value: ' 3.27.1 ' } });
    expect(onChange).toHaveBeenLastCalledWith({ version: '3.27.1' });
    fireEvent.change(version, { target: { value: '  ' } });
    expect(onChange).toHaveBeenLastCalledWith({ version: 'latest' });
  });

  it('picks the agent runs count, 3 by default', () => {
    const { onChange } = setup();
    expect(select('Agent runs per Deploy & run')).toHaveTextContent('Up to 3 (default)');
    fireEvent.mouseDown(select('Agent runs per Deploy & run'));
    expect(screen.getAllByRole('option')).toHaveLength(10);
    expect(screen.getByRole('option', { name: '1 (a single run)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Up to 5' }));
    expect(onChange).toHaveBeenCalledWith({ maxRuns: 5 });
  });

  it('shows a stored runs count', () => {
    setup({ environment: { maxRuns: 1 } });
    expect(select('Agent runs per Deploy & run')).toHaveTextContent('1 (a single run)');
  });

  it('locks the hosts’ setup while busy', () => {
    setup({ busy: true });
    expect(select('Edition')).toHaveAttribute('aria-disabled', 'true');
    expect(select('Architecture')).toHaveAttribute('aria-disabled', 'true');
    expect(select('Agent runs per Deploy & run')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('textbox', { name: 'CFEngine version' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Destroy containers' })).toBeDisabled();
  });

  it('saves environment variables on blur, dropping invalid lines', () => {
    const { onEnvChange } = setup();
    const field = screen.getByRole('textbox', { name: 'Environment variables (all hosts)' });
    expect(field).toHaveValue('APP_ENV=staging');
    fireEvent.change(field, { target: { value: 'APP_ENV=prod\nnot a variable\n1BAD=x\nTOKEN=a=b' } });
    expect(onEnvChange).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(onEnvChange).toHaveBeenCalledWith({ APP_ENV: 'prod', TOKEN: 'a=b' });
  });

  it('saves environment variables when the dialog goes away without a blur (Escape)', () => {
    const { onEnvChange, unmount } = setup();
    fireEvent.change(screen.getByRole('textbox', { name: 'Environment variables (all hosts)' }), { target: { value: 'APP_ENV=prod' } });
    unmount();
    expect(onEnvChange).toHaveBeenCalledExactlyOnceWith({ APP_ENV: 'prod' });
  });

  it('sets and clears the .env file', () => {
    const { onChange } = setup({ environment: { envFile: './old.env' } });
    const field = screen.getByRole('textbox', { name: 'Secrets file (.env), optional' });
    expect(screen.getByText(/A file in the project folder with KEY=value lines/)).toBeInTheDocument();
    fireEvent.change(field, { target: { value: ' ./.env ' } });
    // Typed as is; trimmed when it's saved.
    expect(field).toHaveValue(' ./.env ');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(onChange).toHaveBeenLastCalledWith({ envFile: './.env' });
    fireEvent.change(field, { target: { value: ' ' } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenLastCalledWith({ envFile: null });
  });

  it('needs a saved project for the .env file', () => {
    setup({ saved: false, environment: { envFile: './.env' } });
    expect(screen.getByRole('textbox', { name: 'Secrets file (.env), optional' })).toBeDisabled();
    expect(screen.getByText('Save the project to use one: the path is relative to its folder.')).toBeInTheDocument();
  });

  it('destroys containers and closes', () => {
    const { onClose, onDestroy } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Destroy containers' }));
    expect(onDestroy).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('cannot destroy without containers', () => {
    setup({ canDestroy: false });
    expect(screen.getByRole('button', { name: 'Destroy containers' })).toBeDisabled();
  });
});
