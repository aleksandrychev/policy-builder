import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import type { PlatformSupport } from '../../store/testEnvironmentsSlice/types';
import { installApi, renderWithProviders, uninstallApi } from '../../test/render';
import { CustomImageDialog } from './CustomImageDialog';

type Api = NonNullable<Window['api']>;
type Search = Awaited<ReturnType<Api['testEnvSearch']>>;
type Listener = Parameters<Api['onTestEnvEvent']>[0];
type TestEnvEvent = Parameters<Listener>[1];

const SEARCH: Search = {
  local: ['rockylinux:9'],
  hub: [{ name: 'rockylinux', description: 'The official Rocky Linux image', official: true, stars: 250 }],
  hubError: null
};

let listeners: Listener[];
let api: Api;

beforeEach(() => {
  listeners = [];
  api = installApi({
    testEnvSearch: vi.fn(async () => SEARCH),
    testEnvStart: vi.fn(async () => 'run-1'),
    onTestEnvEvent: vi.fn((listener: Listener) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    })
  });
});
afterEach(uninstallApi);

function setup(support: PlatformSupport | null = null) {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  const view = renderWithProviders(<CustomImageDialog arch="x86_64" support={support} onAdd={onAdd} onClose={onClose} />);
  return { onAdd, onClose, view };
}

const imageField = () => screen.getByRole('combobox', { name: 'Image' });
const typeImage = (image: string) => fireEvent.change(imageField(), { target: { value: image } });
const emit = (event: TestEnvEvent, runId = 'run-1') => act(() => listeners.forEach(listener => listener(runId, event)));

async function checkImage(image = 'rockylinux:9') {
  typeImage(image);
  fireEvent.click(screen.getByRole('button', { name: 'Check image' }));
  await waitFor(() => expect(api.testEnvStart).toHaveBeenCalledWith('inspect', { image, arch: 'x86_64' }));
}

describe('CustomImageDialog', () => {
  it('lists local images and Docker Hub results', async () => {
    setup();
    await waitFor(() => expect(api.testEnvSearch).toHaveBeenCalledWith({ term: '', hub: false }));
    typeImage('rocky');
    await waitFor(() => expect(api.testEnvSearch).toHaveBeenCalledWith({ term: 'rocky', hub: true }));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('On this machine')).toBeInTheDocument();
    expect(within(listbox).getByText('Docker Hub')).toBeInTheDocument();
    expect(within(listbox).getByText('rockylinux:latest')).toBeInTheDocument();
    expect(within(listbox).getByText('★ 250')).toBeInTheDocument();
    expect(within(listbox).getByTitle('Docker official image')).toBeInTheDocument();

    fireEvent.click(within(listbox).getByText('rockylinux:9'));
    expect(imageField()).toHaveValue('rockylinux:9');
  });

  it('searches by name without the tag, Docker Hub from two letters', async () => {
    setup();
    typeImage('r');
    await waitFor(() => expect(api.testEnvSearch).toHaveBeenCalledWith({ term: 'r', hub: false }));
    typeImage('debian:12');
    await waitFor(() => expect(api.testEnvSearch).toHaveBeenCalledWith({ term: 'debian', hub: true }));
  });

  it('shows a Docker Hub error', async () => {
    vi.mocked(api.testEnvSearch).mockResolvedValue({ ...SEARCH, hubError: 'Docker Hub is unreachable' });
    setup();
    expect(await screen.findByText('Docker Hub is unreachable')).toBeInTheDocument();
  });

  it('checks only a valid image reference', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Check image' })).toBeDisabled();
    typeImage('-bad');
    expect(screen.getByRole('button', { name: 'Check image' })).toBeDisabled();
    typeImage('registry.example.com/base/rhel9:1.2');
    expect(screen.getByRole('button', { name: 'Check image' })).toBeEnabled();
  });

  it('adds a host with the detected platform', async () => {
    const { onAdd } = setup();
    await checkImage();
    expect(screen.getByText('Checking rockylinux:9…')).toBeInTheDocument();
    expect(imageField()).toBeDisabled();
    emit({ t: 'step', step: 'pull', message: 'Pulling rockylinux:9' });
    expect(screen.getByText('Pulling rockylinux:9')).toBeInTheDocument();
    emit({ t: 'detected', image: 'rockylinux:9', os: 'Rocky Linux 9.4', platform: 'rhel-9' });
    emit({ t: 'exit', ok: true });

    expect(screen.getByText('Rocky Linux 9.4: takes the RHEL 9 (AlmaLinux 9) package.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Install the CFEngine package for' })).toHaveTextContent('RHEL 9 (AlmaLinux 9)');
    fireEvent.click(screen.getByRole('button', { name: 'Add host' }));
    expect(onAdd).toHaveBeenCalledWith('rockylinux:9', 'rhel-9');
    expect(listeners).toHaveLength(0);
  });

  it('asks for a platform for an unknown OS', async () => {
    const { onAdd } = setup({ 'rhel-7': { client: false, hub: false } });
    await checkImage('alpine:3');
    emit({ t: 'detected', image: 'alpine:3', os: 'Alpine Linux', platform: null });
    expect(screen.getByText(/Alpine Linux isn't a platform CFEngine has packages for/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add host' })).toBeDisabled();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Install the CFEngine package for' }));
    expect(screen.getByRole('option', { name: /RHEL 7/ })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('option', { name: 'Debian 12' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add host' }));
    expect(onAdd).toHaveBeenCalledWith('alpine:3', 'debian-12');
  });

  it('applies events that arrive before the run id', async () => {
    vi.mocked(api.testEnvStart).mockImplementation(async () => {
      listeners.forEach(listener => listener('run-1', { t: 'detected', image: 'debian:12', os: 'Debian 12', platform: 'debian-12' }));
      listeners.forEach(listener => listener('other-run', { t: 'error', message: 'not ours' }));
      return 'run-1';
    });
    setup();
    await checkImage('debian:12');
    expect(await screen.findByText('Debian 12: takes the Debian 12 package.')).toBeInTheDocument();
    expect(screen.queryByText('not ours')).not.toBeInTheDocument();
  });

  it('shows a failed check and lets the image be changed', async () => {
    setup();
    await checkImage('nosuch:1');
    emit({ t: 'error', message: 'pull access denied' });
    emit({ t: 'exit', ok: false, message: 'exit 1' });
    expect(screen.getByRole('alert')).toHaveTextContent('pull access denied');
    typeImage('nosuch:2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check image' })).toBeEnabled();
  });

  it('shows an exit failure without an error event', async () => {
    setup();
    await checkImage();
    emit({ t: 'exit', ok: false });
    expect(screen.getByRole('alert')).toHaveTextContent('The check failed');
  });

  it('shows a start failure', async () => {
    vi.mocked(api.testEnvStart).mockRejectedValue(new Error('Docker is not running'));
    setup();
    typeImage('debian:12');
    fireEvent.click(screen.getByRole('button', { name: 'Check image' }));
    expect(await screen.findByText('Docker is not running')).toBeInTheDocument();
    expect(listeners).toHaveLength(0);
  });

  it('cancels a running check when closed', async () => {
    const { view } = setup();
    await checkImage();
    await waitFor(() => expect(screen.getByText('Checking rockylinux:9…')).toBeInTheDocument());
    view.unmount();
    expect(api.cancelTestEnvRun).toHaveBeenCalledWith('run-1');
  });

  it('cancels', () => {
    const { onAdd, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
