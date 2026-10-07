import { fireEvent, screen } from '@testing-library/react';

import { PLATFORMS, type PlatformSupport } from '../../store/testEnvironmentsSlice/types';
import { renderWithProviders } from '../../test/render';
import { AddHostMenu } from './AddHostMenu';

let anchor: HTMLButtonElement;
afterEach(() => anchor.remove());

function setup(props: { last?: string; support?: PlatformSupport | null } = {}) {
  const onClose = vi.fn();
  const onOther = vi.fn();
  const onSelect = vi.fn();
  anchor = document.body.appendChild(document.createElement('button'));
  renderWithProviders(
    <AddHostMenu anchor={anchor} last={props.last} support={props.support ?? null} onClose={onClose} onOther={onOther} onSelect={onSelect} />
  );
  return { onClose, onOther, onSelect };
}

const labels = () => screen.getAllByRole('menuitem').map(item => item.textContent);

describe('AddHostMenu', () => {
  it('lists every platform, then Other image', () => {
    setup();
    expect(labels()).toEqual([...PLATFORMS.map(platform => platform.label), 'Other image…']);
  });

  it('offers the last host’s platform first', () => {
    setup({ last: 'rhel-9' });
    expect(labels()[0]).toBe('RHEL 9 (AlmaLinux 9)');
    expect(labels().filter(label => label === 'RHEL 9 (AlmaLinux 9)')).toHaveLength(1);
  });

  it('disables platforms without a client package', () => {
    const { onSelect } = setup({ support: { 'rhel-7': { client: false, hub: false }, 'ubuntu-24': { client: true, hub: true } } });
    expect(screen.getByRole('menuitem', { name: /RHEL 7/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: /RHEL 7/ })).toHaveTextContent('no package');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ubuntu 24.04' }));
    expect(onSelect).toHaveBeenCalledWith('ubuntu-24');
  });

  it('opens the custom image dialog', () => {
    const { onOther, onSelect } = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Other image…' }));
    expect(onOther).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
