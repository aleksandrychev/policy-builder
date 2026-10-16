import { Provider } from 'react-redux';

import { fireEvent, render, screen, within } from '@testing-library/react';

import App from '../../App';
import { AppThemeProvider } from '../../ThemeProvider';
import { projectFilesInitialized } from '../../store/filesSlice';
import { projectCreated, projectTypeChanged } from '../../store/projectSlice';
import { type TestStore, makeStore } from '../../store/test/storeTestUtils';
import { installApi, uninstallApi } from '../../test/render';

const INDEX = {
  'delete-files': {
    description: 'Deletes files you list',
    tags: ['supported', 'management'],
    version: '2.0.0',
    repo: 'https://github.com/nickanderson/cfengine-delete-files',
    input: [
      {
        type: 'list',
        variable: 'files',
        label: 'Files',
        subtype: [
          { key: 'path', type: 'string', label: 'Path' },
          { key: 'why', type: 'string', label: 'Why', default: 'Unknown' }
        ]
      }
    ]
  },
  clamav: { description: 'Runs ClamAV scans', tags: ['experimental', 'security'], version: '0.1.0' },
  'promise-type-git': {
    description: 'Manage git repos',
    tags: ['supported', 'promise-type'],
    version: '0.2.6',
    dependencies: ['library-for-promise-types-in-python']
  },
  'library-for-promise-types-in-python': { description: 'Python library', tags: ['library'], version: '0.3.1' }
};
const README = '<h2>Delete files</h2><p>See the <a href="https://github.com/x/y">repository</a>.</p><script>window.ran = true</script>';

let store: TestStore;

// A project in memory, open in the app.
async function renderApp() {
  store.dispatch(projectCreated({ name: 'Mods' }));
  store.dispatch(projectFilesInitialized('Mods', []));
  render(
    <Provider store={store}>
      <AppThemeProvider>
        <App />
      </AppThemeProvider>
    </Provider>
  );
  await screen.findByPlaceholderText('Search blocks…');
}

const sideBar = () => screen.getByRole('navigation', { name: 'Side bar views' });

beforeEach(() => {
  store = makeStore();
  installApi({
    getModuleIndex: async () => ({ index: INDEX, fetchedAt: '2026-10-16T00:00:00Z', offline: false }),
    getModuleDetails: async () => ({
      details: { readme: README, author: { name: 'Nick Anderson' }, downloads: 89, versions: { '2.0.0': { date: 'Jun 30, 2023', latest: true } } },
      offline: false
    })
  });
});
afterEach(() => uninstallApi());

describe('the Modules view', () => {
  it('lists, searches and filters the index; libraries only on request', async () => {
    await renderApp();
    fireEvent.click(within(sideBar()).getByRole('button', { name: 'Modules' }));
    expect(await screen.findByText('delete-files')).toBeInTheDocument();
    expect(screen.getByText(/All modules \(3\)/i)).toBeInTheDocument();
    expect(screen.queryByText('library-for-promise-types-in-python')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search modules…'), { target: { value: 'git' } });
    expect(screen.getByText('promise-type-git')).toBeInTheDocument();
    expect(screen.queryByText('delete-files')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search modules…'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Libraries' }));
    expect(screen.getByText('library-for-promise-types-in-python')).toBeInTheDocument();
  });

  it('opens a module’s page, adds it, and answers its input', async () => {
    await renderApp();
    fireEvent.click(within(sideBar()).getByRole('button', { name: 'Modules' }));
    fireEvent.click(await screen.findByText('delete-files'));

    expect(screen.getByRole('heading', { name: 'delete-files' })).toBeInTheDocument();
    // The README as plain markup: its link opens outside the app, its script is gone.
    expect(await screen.findByRole('heading', { name: 'Delete files' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'repository' })).toHaveAttribute('href', 'https://github.com/x/y');
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('Total downloads: 89')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add to project' }));
    expect(store.getState().modules).toEqual([{ name: 'delete-files', version: '2.0.0' }]);
    expect(within(sideBar()).getByText('1')).toBeInTheDocument(); // needs input

    fireEvent.click(screen.getByRole('tab', { name: 'Input' }));
    // The Input tab's Add (the module list's rows have theirs).
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' }).at(-1)!);
    fireEvent.change(screen.getByRole('textbox', { name: 'Path' }), { target: { value: '/etc/hosts.equiv' } });
    expect(store.getState().modules[0].input).toEqual({ files: [{ path: '/etc/hosts.equiv', why: 'Unknown' }] });
    expect(within(sideBar()).queryByText('1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Back to Canvas/ }));
    expect(screen.queryByRole('heading', { name: 'delete-files' })).not.toBeInTheDocument();
  });

  it('lists modules in a module project, but doesn’t add them', async () => {
    await renderApp();
    store.dispatch(projectTypeChanged({ type: 'module' }));
    fireEvent.click(within(sideBar()).getByRole('button', { name: 'Modules' }));
    fireEvent.click(await screen.findByText('delete-files'));
    expect(screen.getByRole('button', { name: 'Add to project' })).toBeDisabled();
    expect(screen.getByText(/modules go into policy-set projects/)).toBeInTheDocument();
  });

  it('collapses the side bar from its open view’s icon', async () => {
    await renderApp();
    expect(screen.getByPlaceholderText('Search blocks…')).toBeInTheDocument();
    fireEvent.click(within(sideBar()).getByRole('button', { name: 'Blocks and files' }));
    expect(screen.queryByPlaceholderText('Search blocks…')).not.toBeInTheDocument();
    fireEvent.click(within(sideBar()).getByRole('button', { name: 'Blocks and files' }));
    expect(screen.getByPlaceholderText('Search blocks…')).toBeInTheDocument();
  });
});

describe('modules from the Blocks palette', () => {
  it('points a search no block matches at the modules that do', async () => {
    await renderApp();
    fireEvent.change(screen.getByPlaceholderText('Search blocks…'), { target: { value: 'clamav' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Browse modules…' }));
    expect(screen.getByPlaceholderText('Search modules…')).toHaveValue('clamav');
    expect(screen.getByText('clamav')).toBeInTheDocument();
  });

  it('brings a promise type’s module with its block, and keeps it while the block is there', async () => {
    await renderApp();
    fireEvent.click(screen.getByText(/^Git Checkout$/));
    expect(store.getState().modules).toEqual([{ name: 'promise-type-git' }]);

    fireEvent.click(within(sideBar()).getByRole('button', { name: 'Modules' }));
    // Its library, which cfbs adds on save, shows under it already.
    expect(await screen.findByText('added for promise-type-git, on save')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('promise-type-git')[0]);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(screen.getByText(/Used by Git Checkout/)).toBeInTheDocument();
  });
});
