import type { ComponentProps } from 'react';

import { fireEvent, screen, within } from '@testing-library/react';

import { renderWithProviders } from '../test/render';
import { PROJECT_TABS, TopBar } from './TopBar';

type Props = ComponentProps<typeof TopBar>;

function renderTopBar(overrides: Partial<Props> = {}) {
  const props: Props = {
    activeTab: 0,
    blockCount: 3,
    namespace: 'main',
    dirty: false,
    masterfiles: null,
    onOpenSettings: vi.fn(),
    onSave: vi.fn(),
    onTabChange: vi.fn(),
    projectName: 'Web servers',
    savedToDisk: true,
    type: 'policy-set',
    ...overrides
  };
  renderWithProviders(<TopBar {...props} />);
  return props;
}

describe('TopBar', () => {
  it('shows every view as a tab, named by its full title', () => {
    renderTopBar();
    const tablist = screen.getByRole('tablist', { name: 'Project views' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map(tab => tab.getAttribute('aria-label'))).toEqual([...PROJECT_TABS]);
  });

  it('marks only the active view as selected', () => {
    renderTopBar({ activeTab: 2 });
    expect(screen.getByRole('tab', { name: 'Test Results & Logs' })).toHaveAttribute('aria-selected', 'true');
    for (const name of ['Canvas', 'Generated Policy (.cf)', 'Deployment']) {
      expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'false');
    }
  });

  it('calls back with the clicked view index', () => {
    const { onTabChange } = renderTopBar();
    fireEvent.click(screen.getByRole('tab', { name: 'Deployment' }));
    expect(onTabChange).toHaveBeenCalledWith(3);
  });

  it('shows a tab badge after its name', () => {
    renderTopBar({ tabBadges: { 2: <span>running</span> } });
    expect(within(screen.getByRole('tab', { name: 'Test Results & Logs' })).getByText('running')).toBeInTheDocument();
  });

  it('disables Save when a saved project has no changes', () => {
    renderTopBar();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves a dirty project and marks it unsaved', () => {
    const { onSave } = renderTopBar({ dirty: true });
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('offers Save As for a project not on disk', () => {
    renderTopBar({ savedToDisk: false });
    expect(screen.getByRole('button', { name: 'Save As…' })).toBeEnabled();
  });

  it('opens the project settings', () => {
    const { onOpenSettings } = renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: 'Project settings' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
