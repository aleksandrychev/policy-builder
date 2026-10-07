import { fireEvent, screen, waitFor } from '@testing-library/react';

import { installApi, renderWithProviders, uninstallApi } from '../../test/render';
import { DEFAULT_DESCRIPTION, NewProjectDialog, type ProjectFormValues, type SubmitResult } from './NewProjectDialog';

type Api = NonNullable<Window['api']>;
type TargetCheck = Awaited<ReturnType<Api['checkProjectTarget']>>;

const FREE: TargetCheck = { parentWritable: true, targetState: 'new' };

function setup({ mode = 'new', ...props }: { initialName?: string; mode?: 'new' | 'saveAs' } = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn(async (_values: ProjectFormValues): Promise<SubmitResult> => ({ ok: true }));
  renderWithProviders(<NewProjectDialog mode={mode} onClose={onClose} onSubmit={onSubmit} {...props} />);
  return { onClose, onSubmit };
}

const nameField = () => screen.getByRole('textbox', { name: /Project name/ });
const createButton = () => screen.getByRole('button', { name: 'Create' });
const typeName = (name: string) => fireEvent.change(nameField(), { target: { value: name } });

describe('NewProjectDialog without the Electron bridge', () => {
  it('creates an in-memory project from name and description', async () => {
    const { onSubmit } = setup();
    expect(screen.queryByRole('textbox', { name: 'Location' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Description/ })).toHaveValue(DEFAULT_DESCRIPTION);
    expect(createButton()).toBeDisabled();

    typeName('  My Web Server ');
    fireEvent.click(createButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'My Web Server',
      description: DEFAULT_DESCRIPTION,
      parent: null,
      folderName: 'my-web-server',
      masterfiles: '3.27.1',
      git: true,
      type: 'policy-set'
    });
  });

  it('rejects a name without letters or digits', () => {
    setup();
    typeName('!!!');
    expect(screen.getByText('Use at least one letter or digit.')).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it('needs a description', () => {
    setup({ initialName: 'web' });
    expect(createButton()).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox', { name: /Description/ }), { target: { value: '  ' } });
    expect(createButton()).toBeDisabled();
  });

  it('cancels', () => {
    const { onClose, onSubmit } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('serves Save As', () => {
    setup({ mode: 'saveAs', initialName: 'Demo' });
    expect(screen.getByRole('heading', { name: 'Save Project As' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.queryByText(/can’t be changed later/)).not.toBeInTheDocument();
  });
});

describe('NewProjectDialog with the Electron bridge', () => {
  let api: Api;
  let check: TargetCheck;
  beforeEach(() => {
    check = FREE;
    api = installApi({
      getDefaultProjectParent: vi.fn(async () => '/home/me/Projects'),
      getMasterfilesVersions: vi.fn(async () => ({ latest: '3.27.2' })),
      checkProjectTarget: vi.fn(async () => check),
      pickDirectory: vi.fn(async () => '/srv/policy')
    });
  });
  afterEach(uninstallApi);

  it('shows the default location, the latest version and the target path', async () => {
    setup();
    expect(screen.getByText(/can’t be changed later/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('/home/me/Projects'));
    expect(await screen.findByRole('radio', { name: 'Latest (3.27.2)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Initialize a git repository' })).toBeChecked();

    typeName('Web Server');
    expect(await screen.findByText('Will be created at: /home/me/Projects/web-server')).toBeInTheDocument();
    await waitFor(() => expect(api.checkProjectTarget).toHaveBeenCalledWith('/home/me/Projects', 'web-server'));
    await waitFor(() => expect(createButton()).toBeEnabled());
  });

  it('picks another location', async () => {
    setup({ initialName: 'web' });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('/home/me/Projects'));
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    expect(api.pickDirectory).toHaveBeenCalledWith('/home/me/Projects');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('/srv/policy'));
    expect(screen.getByText('Will be created at: /srv/policy/web')).toBeInTheDocument();
  });

  it('keeps the location when the picker is cancelled', async () => {
    vi.mocked(api.pickDirectory).mockResolvedValue(null);
    setup();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('/home/me/Projects'));
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    await waitFor(() => expect(api.pickDirectory).toHaveBeenCalled());
    expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('/home/me/Projects');
  });

  it('refuses a folder that exists and is not empty', async () => {
    check = { parentWritable: true, targetState: 'nonEmpty' };
    setup({ initialName: 'web' });
    expect(await screen.findByText(/^A folder named .web. already exists and isn’t empty\.$/)).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it('refuses a location it cannot write to', async () => {
    check = { parentWritable: false, targetState: 'new' };
    setup({ initialName: 'web' });
    expect(await screen.findByText('Can’t create a folder here — choose another location.')).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it('stays disabled until the target is checked', async () => {
    setup({ initialName: 'web' });
    expect(createButton()).toBeDisabled();
    await waitFor(() => expect(createButton()).toBeEnabled());
  });

  it('submits master branch masterfiles without git', async () => {
    const { onSubmit } = setup({ initialName: 'web' });
    fireEvent.click(await screen.findByRole('radio', { name: 'Master branch' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Initialize a git repository' }));
    await waitFor(() => expect(createButton()).toBeEnabled());
    fireEvent.click(createButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual({
      name: 'web',
      description: DEFAULT_DESCRIPTION,
      parent: '/home/me/Projects',
      folderName: 'web',
      masterfiles: 'master',
      git: false,
      type: 'policy-set'
    });
  });

  it('submits a module without masterfiles', async () => {
    const { onSubmit } = setup({ initialName: 'web' });
    await screen.findByRole('radio', { name: 'Latest (3.27.2)' });
    fireEvent.click(screen.getByRole('radio', { name: /^Module/ }));
    // The masterfiles choice is hidden, not removed.
    expect(screen.queryByRole('radio', { name: 'Master branch' })).not.toBeInTheDocument();
    await waitFor(() => expect(createButton()).toBeEnabled());
    fireEvent.click(createButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ type: 'module', masterfiles: 'no' });
  });

  it('shows progress while creating', async () => {
    const { onSubmit } = setup({ initialName: 'web' });
    onSubmit.mockReturnValue(new Promise(() => {}));
    await screen.findByRole('radio', { name: 'Latest (3.27.2)' });
    await waitFor(() => expect(createButton()).toBeEnabled());
    fireEvent.click(createButton());
    expect(await screen.findByText('Downloading masterfiles 3.27.2…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('shows a failure with its details and allows retrying', async () => {
    const { onSubmit } = setup({ initialName: 'web' });
    onSubmit.mockResolvedValue({ ok: false, message: 'cfbs init failed', details: 'git: not found' });
    await waitFor(() => expect(createButton()).toBeEnabled());
    fireEvent.click(createButton());
    expect(await screen.findByText('cfbs init failed')).toBeInTheDocument();
    expect(screen.getByText('git: not found')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    await waitFor(() => expect(screen.getByText('git: not found')).toBeVisible());
    expect(createButton()).toBeEnabled();
  });

  it('shows a thrown error', async () => {
    const { onSubmit } = setup({ initialName: 'web' });
    onSubmit.mockRejectedValue(new Error('boom'));
    await waitFor(() => expect(createButton()).toBeEnabled());
    fireEvent.click(createButton());
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Details' })).not.toBeInTheDocument();
  });
});
