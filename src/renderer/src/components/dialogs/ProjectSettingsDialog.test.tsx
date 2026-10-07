import { fireEvent, screen, waitFor } from '@testing-library/react';

import type { Project, ProjectType } from '../../store/projectSlice/types';
import { renderWithProviders } from '../../test/render';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';

const PROJECT: Project = {
  id: 'p1',
  name: 'Web',
  description: 'Web servers',
  moduleName: 'web',
  path: '/home/me/web',
  masterfiles: '3.27.1',
  type: 'policy-set'
};

function setup(project: Partial<Project> = {}, result = true) {
  const onClose = vi.fn();
  const onTypeChange = vi.fn(async (_type: ProjectType, _masterfiles: string | null) => result);
  renderWithProviders(<ProjectSettingsDialog latestMasterfiles="3.27.2" project={{ ...PROJECT, ...project }} onClose={onClose} onTypeChange={onTypeChange} />);
  return { onClose, onTypeChange };
}

describe('ProjectSettingsDialog', () => {
  it('closes without saving when nothing changed', () => {
    const { onClose, onTypeChange } = setup();
    expect(screen.getByRole('radio', { name: /^Policy set/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onTypeChange).not.toHaveBeenCalled();
  });

  it('converts a saved policy set to a module', async () => {
    const { onClose, onTypeChange } = setup();
    fireEvent.click(screen.getByRole('radio', { name: /^Module/ }));
    expect(screen.getByText(/Saves the project as a module/)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Latest/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onTypeChange).toHaveBeenCalledWith('module', null);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('asks a module without masterfiles which version to use', async () => {
    const { onTypeChange } = setup({ type: 'module', masterfiles: null });
    expect(screen.queryByRole('radio', { name: /Latest/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /^Policy set/ }));
    expect(screen.getByText(/Saves the project as a policy set/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Latest (3.27.2)' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onTypeChange).toHaveBeenCalledWith('policy-set', '3.27.2');
  });

  it('can pick the master branch', () => {
    const { onTypeChange } = setup({ type: 'module', masterfiles: null });
    fireEvent.click(screen.getByRole('radio', { name: /^Policy set/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Master branch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onTypeChange).toHaveBeenCalledWith('policy-set', 'master');
  });

  it('keeps the masterfiles a module already has', () => {
    const { onTypeChange } = setup({ type: 'module', masterfiles: '3.27.1' });
    fireEvent.click(screen.getByRole('radio', { name: /^Policy set/ }));
    expect(screen.queryByRole('radio', { name: /Latest/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onTypeChange).toHaveBeenCalledWith('policy-set', null);
  });

  it('stays open when saving fails', async () => {
    const { onClose, onTypeChange } = setup({}, false);
    fireEvent.click(screen.getByRole('radio', { name: /^Module/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onTypeChange).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('changes an unsaved project without a Save button', () => {
    const { onTypeChange } = setup({ path: null });
    fireEvent.click(screen.getByRole('radio', { name: /^Module/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onTypeChange).toHaveBeenCalledWith('module', null);
  });

  it('cancels', () => {
    const { onClose, onTypeChange } = setup();
    fireEvent.click(screen.getByRole('radio', { name: /^Module/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onTypeChange).not.toHaveBeenCalled();
  });
});
