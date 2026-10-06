import { fireEvent, screen } from '@testing-library/react';

import type { PlatformSupport, TestHost } from '../../store/testEnvironmentsSlice/types';
import { renderWithProviders } from '../../test/render';
import { HostSettingsDialog } from './HostSettingsDialog';

const HOST: TestHost = { id: 'h1', name: 'web-1', platform: 'ubuntu-24', env: {}, ports: [] };

interface Options {
  busy?: boolean;
  canRemove?: boolean;
  container?: string;
  exists?: boolean;
  host?: Partial<TestHost>;
  isHub?: boolean;
  otherPorts?: number[];
  support?: PlatformSupport | null;
}

function setup({ host, busy = false, canRemove = true, exists = true, isHub = false, otherPorts = [], support = null, container }: Options = {}) {
  const callbacks = { onChange: vi.fn(), onClose: vi.fn(), onMakeHub: vi.fn(), onRemove: vi.fn(), onRename: vi.fn(), onReset: vi.fn() };
  renderWithProviders(
    <HostSettingsDialog
      host={{ ...HOST, ...host }}
      busy={busy}
      canRemove={canRemove}
      exists={exists}
      isHub={isHub}
      otherPorts={new Set(otherPorts)}
      support={support}
      container={container}
      {...callbacks}
    />
  );
  return callbacks;
}

const platformSelect = (name = 'Platform') => screen.getByRole('combobox', { name });

describe('HostSettingsDialog', () => {
  it('renames the host', () => {
    const { onRename } = setup();
    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('web-1');
    expect(name).toHaveAttribute('maxlength', '40');
    fireEvent.change(name, { target: { value: 'web-2' } });
    expect(onRename).toHaveBeenCalledWith('web-2');
  });

  it('changes the platform', () => {
    const { onChange } = setup();
    expect(platformSelect()).toHaveTextContent('Ubuntu 24.04');
    fireEvent.mouseDown(platformSelect());
    fireEvent.click(screen.getByRole('option', { name: 'Debian 12' }));
    expect(onChange).toHaveBeenCalledWith({ platform: 'debian-12' });
  });

  it('disables platforms without a client package', () => {
    setup({ support: { 'rhel-7': { client: false, hub: false }, 'debian-12': { client: true, hub: false } } });
    fireEvent.mouseDown(platformSelect());
    expect(screen.getByRole('option', { name: /RHEL 7/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: /RHEL 7/ })).toHaveTextContent('no package');
    expect(screen.getByRole('option', { name: 'Debian 12' })).not.toHaveAttribute('aria-disabled');
  });

  it('disables platforms without a hub package for the hub', () => {
    setup({ isHub: true, support: { 'debian-12': { client: true, hub: false } } });
    fireEvent.mouseDown(platformSelect());
    expect(screen.getByRole('option', { name: /Debian 12/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: /Debian 12/ })).toHaveTextContent('no hub package');
  });

  it('shows a custom image and goes back to the standard one', () => {
    const { onChange } = setup({ host: { image: 'rockylinux:9', platform: 'rhel-9' } });
    expect(platformSelect('CFEngine package for')).toHaveTextContent('RHEL 9');
    expect(screen.getByText('rockylinux:9')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use the standard image' }));
    expect(onChange).toHaveBeenCalledWith({ image: '' });
  });

  it('makes a client the hub', () => {
    const { onMakeHub } = setup();
    expect(screen.getByRole('button', { name: 'Client' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Hub — serves the policy' }));
    expect(onMakeHub).toHaveBeenCalled();
  });

  it('cannot turn the hub into a client', () => {
    setup({ isHub: true });
    expect(screen.getByRole('button', { name: 'Hub — serves the policy' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Client' })).toBeDisabled();
  });

  it('adds a port on the first free host port', () => {
    const { onChange } = setup({ host: { ports: [{ host: 8080, container: 80 }] }, otherPorts: [8081] });
    fireEvent.click(screen.getByRole('button', { name: 'Port' }));
    expect(onChange).toHaveBeenCalledWith({
      ports: [
        { host: 8080, container: 80 },
        { host: 8082, container: 80 }
      ]
    });
  });

  it('edits and removes ports', () => {
    const { onChange } = setup({ host: { ports: [{ host: 8080, container: 80 }] } });
    const hostPort = screen.getByDisplayValue('8080');
    fireEvent.change(hostPort, { target: { value: '90a90' } });
    expect(onChange).toHaveBeenLastCalledWith({ ports: [{ host: 9090, container: 80 }] });
    fireEvent.change(screen.getByDisplayValue('80'), { target: { value: '443' } });
    expect(onChange).toHaveBeenLastCalledWith({ ports: [{ host: 8080, container: 443 }] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove port' }));
    expect(onChange).toHaveBeenLastCalledWith({ ports: [] });
  });

  it('keeps an invalid port out and restores it on blur', () => {
    const { onChange } = setup({ host: { ports: [{ host: 8080, container: 80 }] } });
    const hostPort = screen.getByDisplayValue('8080');
    fireEvent.change(hostPort, { target: { value: '70000' } });
    expect(hostPort).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(hostPort, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(hostPort);
    expect(hostPort).toHaveValue('8080');
    expect(hostPort).toHaveAttribute('aria-invalid', 'false');
  });

  it('flags a host port another host publishes', () => {
    setup({ host: { ports: [{ host: 8080, container: 80 }] }, otherPorts: [8080] });
    expect(screen.getByDisplayValue('8080')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTitle('Already published by another host')).toBeInTheDocument();
  });

  it('saves environment variables on blur', () => {
    const { onChange } = setup({ host: { env: { A: '1' } } });
    const field = screen.getByRole('textbox', { name: 'Environment variables (this host)' });
    expect(field).toHaveValue('A=1');
    fireEvent.change(field, { target: { value: 'A=2\nB=x' } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenCalledWith({ env: { A: '2', B: 'x' } });
  });

  it('copies the shell command for its container', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup({ container: 'cfpb-web-1' });
    expect(screen.getByRole('textbox', { name: 'Shell in this container' })).toHaveValue('docker exec -it cfpb-web-1 bash');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('docker exec -it cfpb-web-1 bash');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('has no shell command before the container exists', () => {
    setup();
    expect(screen.queryByRole('textbox', { name: 'Shell in this container' })).not.toBeInTheDocument();
  });

  it('removes, resets and closes', () => {
    const { onClose, onRemove, onReset } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Remove host' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onRemove).toHaveBeenCalled();
    expect(onReset).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('cannot remove the last host or reset a missing container', () => {
    setup({ canRemove: false, exists: false });
    expect(screen.getByRole('button', { name: 'Remove host' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
  });

  it('locks everything but the environment variables while busy', () => {
    setup({ busy: true, host: { ports: [{ host: 8080, container: 80 }] } });
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeDisabled();
    expect(platformSelect()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByDisplayValue('8080')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Port' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove host' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Environment variables (this host)' })).toBeEnabled();
  });
});
