import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import type { BuildResult, GitStatus, HubState, OperationResult, SavedHub } from '../../../preload/api';
import type { CompiledPolicyState } from '../project/useCompiledPolicy';
import { addBlock, addFile } from '../store/test/storeTestUtils';
import { installApi, renderWithProviders, uninstallApi } from '../test/render';

type Api = NonNullable<Window['api']>;
type Store = typeof import('../store').store;
type BuildReply = OperationResult<{ build: BuildResult }>;

const PATH = '/p';
const REMOTE = 'git@github.com:org/policy.git';
const HUB_URL = 'https://hub.example.com';

const gitStatus = (overrides: Partial<GitStatus> = {}): GitStatus => ({
  ahead: 0,
  behind: 0,
  branch: 'main',
  changedFiles: 2,
  changedPaths: ['a.cf', 'b.cf'],
  headBuilder: null,
  lastCommit: { date: '', hash: 'abcdef1234', subject: 'Initial' },
  remote: REMOTE,
  repo: true,
  upstream: 'origin/main',
  ...overrides
});
const clean = (overrides: Partial<GitStatus> = {}) => gitStatus({ changedFiles: 0, changedPaths: [], ...overrides });

const goodBuild: BuildResult = {
  lint: { ok: true, problems: [] },
  log: [],
  masterfiles: '3.27.0',
  promises: { how: 'local', ok: true, problems: [] },
  tarball: '/p/out/masterfiles.tgz'
};

const hubState = (url: string): HubState => ({
  deploysEnabled: true,
  hosts: 3,
  info: { hostkey: 'k', hostname: 'hub1', license: '', version: '3.27.0' },
  releaseId: null,
  vcs: { hasKey: false, refspec: 'main', subdirectory: '', type: 'GIT_CFBS', url, username: '' }
});

// A promise resolved from the test, to look at what shows while it's pending.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => (resolve = done));
  return { promise, resolve };
}

let store: Store;
let api: Api;
let progress: (stage: string) => void;

interface Setup {
  build?: () => Promise<BuildReply>;
  // Read after `prepare`, which may add the blocks it maps.
  compiled?: () => CompiledPolicyState;
  dirty?: boolean;
  git?: GitStatus;
  hubs?: SavedHub[];
  overrides?: Partial<Api>;
  prepare?: (store: Store) => void;
}

// deployRuns, testRuns and the app store live at module level: fresh ones per test.
async function setup({ build, compiled, dirty = false, git = gitStatus(), hubs = [], overrides = {}, prepare }: Setup = {}) {
  vi.resetModules();
  api = installApi({
    buildPolicySet: vi.fn(build ?? (async () => ({ ok: true as const, build: goodBuild }))),
    gitStatus: vi.fn(async () => ({ ok: true as const, status: git })),
    hubList: vi.fn(async () => hubs),
    onDeployProgress: vi.fn((callback: (stage: string) => void) => {
      progress = stage => act(() => callback(stage));
      return () => {};
    }),
    ...overrides
  });
  ({ store } = await import('../store'));
  const { projectCreated } = await import('../store/projectSlice');
  const { DeploymentView } = await import('./DeploymentView');
  store.dispatch(projectCreated({ name: 'Demo', path: PATH }));
  prepare?.(store);
  const props = {
    compiled: compiled?.() ?? { error: null, pathOf: {}, pending: false, result: null },
    onOpenTests: vi.fn(),
    onReload: vi.fn(async () => {}),
    onSave: vi.fn(async () => true),
    onShowBlock: vi.fn()
  };
  const ui = () => <DeploymentView dirty={dirty} {...props} />;
  const view = renderWithProviders(ui(), { store });
  await waitFor(() => expect(api.gitStatus).toHaveBeenCalledWith(PATH));
  return { ...props, ui, view };
}

const check = (label: string) => screen.getByTitle(new RegExp(`^${label}:`));
const tab = (name: string) => screen.getByRole('tab', { name });
const checksOut = () => waitFor(() => expect(check('Valid policy')).toHaveAttribute('title', 'Valid policy: Checks out'));

describe('DeploymentView', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    uninstallApi();
  });

  describe('pre-flight', () => {
    it('builds the saved project on open', async () => {
      const pending = deferred<BuildReply>();
      await setup({ build: () => pending.promise });
      expect(api.buildPolicySet).toHaveBeenCalledWith(PATH);
      expect(check('Valid policy')).toHaveAttribute('title', 'Valid policy: Saving the project');
      await act(async () => pending.resolve({ ok: true, build: goodBuild }));
      await checksOut();
    });

    it('renders the five checks with their statuses', async () => {
      await setup({ git: clean({ ahead: 1 }) });
      await checksOut();
      expect(check('Saved')).toHaveAttribute('title', 'Saved: All saved');
      expect(check('Tested')).toHaveAttribute('title', 'Tested: Not run yet');
      expect(check('Committed')).toHaveAttribute('title', 'Committed: abcdef1 · Initial');
      expect(check('Pushed')).toHaveAttribute('title', 'Pushed: 1 commit to push');
    });

    it('opens a check’s detail on click, and closes it on a second click', async () => {
      await setup();
      await checksOut();
      fireEvent.click(check('Valid policy'));
      expect(screen.getByText('Linter: no problems')).toBeInTheDocument();
      expect(screen.getByText('cf-promises: valid (local CFEngine)')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
      expect(api.revealInProject).toHaveBeenCalledWith(PATH, '/p/out/masterfiles.tgz');

      fireEvent.click(check('Committed'));
      expect(screen.queryByText('Linter: no problems')).not.toBeInTheDocument();
      expect(screen.getByText('a.cf, b.cf')).toBeInTheDocument();
      fireEvent.click(check('Committed'));
      expect(screen.queryByText('a.cf, b.cf')).not.toBeInTheDocument();
    });

    it('opens the tests from Tested', async () => {
      const { onOpenTests } = await setup();
      fireEvent.click(check('Tested'));
      fireEvent.click(screen.getByRole('button', { name: 'Open Test Results & Logs' }));
      expect(onOpenTests).toHaveBeenCalled();
    });

    it('links a problem to its block', async () => {
      let fileId = '';
      let blockId = '';
      const problems = [{ file: './main.cf', line: 4, message: 'Undefined variable' }];
      const { onShowBlock } = await setup({
        build: async () => ({ ok: true, build: { ...goodBuild, lint: { ok: false, problems } } }),
        prepare: created => {
          fileId = addFile(created);
          blockId = addBlock(created, fileId, { label: 'Say hello' });
        },
        compiled: () => ({
          error: null,
          pathOf: { [fileId]: './main.cf' },
          pending: false,
          result: { files: {}, sourceMap: { './main.cf': { [blockId]: [[2, 6]] } } }
        })
      });
      await waitFor(() => expect(check('Valid policy')).toHaveAttribute('title', 'Valid policy: 1 problems'));
      fireEvent.click(check('Valid policy'));
      expect(screen.getByText('Undefined variable')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Show Say hello' }));
      expect(onShowBlock).toHaveBeenCalledWith(fileId, blockId);
    });

    it('shows the build’s progress, then its failure with details, until Close', async () => {
      const pending = deferred<BuildReply>();
      await setup({ build: () => pending.promise });
      await act(async () => pending.resolve({ ok: true, build: goodBuild }));
      await checksOut();

      const second = deferred<BuildReply>();
      vi.mocked(api.buildPolicySet).mockImplementationOnce(() => second.promise);
      fireEvent.click(screen.getByRole('button', { name: 'Run pre-flight' }));
      await waitFor(() => expect(api.buildPolicySet).toHaveBeenCalledTimes(2));
      progress('lint');
      expect(screen.getByText('Step 3 of 4 · Checking with the linter…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Run pre-flight' })).toBeDisabled();

      await act(async () => second.resolve({ ok: false, message: 'cfbs build failed', details: 'Traceback: no masterfiles' }));
      expect(screen.getByText('cfbs build failed')).toBeInTheDocument();
      expect(screen.getByText('Traceback: no masterfiles')).toBeInTheDocument();
      expect(check('Valid policy')).toHaveAttribute('title', 'Valid policy: Build failed');
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByText('cfbs build failed')).not.toBeInTheDocument();
    });
  });

  describe('deploy tabs', () => {
    it('names each tab with its worst status', async () => {
      await setup({ git: clean() });
      await checksOut();
      expect(within(tab('Git repository')).getByTestId('CheckCircleIcon')).toBeInTheDocument();
      expect(within(tab('Hub over SSH')).getByTestId('WarningAmberIcon')).toBeInTheDocument();
      expect(within(tab('Enterprise hub')).getByTestId('WarningAmberIcon')).toBeInTheDocument();
      expect(screen.getByText('In sync with origin/main')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Up to date' })).toBeDisabled();
    });

    it('asks for the remote when there is none', async () => {
      const setRemote = vi.fn(async () => ({ ok: true as const, status: clean() }));
      await setup({ git: gitStatus({ remote: null }), overrides: { gitSetRemote: setRemote } });
      const field = await screen.findByRole('textbox', { name: 'Remote (origin)' });
      expect(screen.getByRole('button', { name: 'Set' })).toBeDisabled();
      fireEvent.change(field, { target: { value: REMOTE } });
      fireEvent.click(screen.getByRole('button', { name: 'Set' }));
      expect(setRemote).toHaveBeenCalledWith(PATH, REMOTE);
      expect(await screen.findByText(`${REMOTE} · main`)).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: 'Remote (origin)' })).not.toBeInTheDocument();
    });

    it('offers to initialize git, then shows a notice', async () => {
      const init = vi.fn(async () => ({ ok: true as const, status: clean({ remote: null }) }));
      await setup({ git: gitStatus({ repo: false, remote: null }), overrides: { gitInit: init } });
      expect(await screen.findByText('This project folder isn’t a git repository yet.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Initialize git' }));
      expect(init).toHaveBeenCalledWith(PATH);
      expect(await screen.findByText('Initialized git: first commit abcdef1.')).toBeInTheDocument();
    });

    it('asks for the SSH host, and Forget clears it', async () => {
      await setup();
      fireEvent.click(tab('Hub over SSH'));
      const host = screen.getByRole('textbox', { name: 'Hub' });
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      fireEvent.change(host, { target: { value: 'root@hub.example.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(localStorage.getItem(`cfpb.deploy.ssh:${PATH}`)).toBe('root@hub.example.com||');
      expect(screen.getByText('root@hub.example.com')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Deploy to root@hub.example.com' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      const dialog = screen.getByRole('dialog', { name: 'Hub over SSH' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Forget' }));
      expect(localStorage.getItem(`cfpb.deploy.ssh:${PATH}`)).toBeNull();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('textbox', { name: 'Hub' })).toHaveValue('');
    });

    it('asks to connect a hub when there is none', async () => {
      await setup();
      fireEvent.click(tab('Enterprise hub'));
      expect(await screen.findByRole('textbox', { name: 'Hub (Mission Portal) URL' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
    });

    it('shows the hub’s source form when it deploys another repository', async () => {
      localStorage.setItem(`cfpb.deploy.hub:${PATH}`, HUB_URL);
      const other = 'https://github.com/org/other.git';
      await setup({
        hubs: [{ url: HUB_URL, username: 'admin' }],
        overrides: { hubState: vi.fn(async () => ({ ok: true as const, state: hubState(other) })) }
      });
      fireEvent.click(tab('Enterprise hub'));
      expect(await screen.findByText(`The hub deploys ${other}, not this project’s ${REMOTE}.`)).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Repository the hub pulls' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save to the hub' })).toBeInTheDocument();
      expect(api.hubState).toHaveBeenCalledWith(HUB_URL);
    });

    it('opens the target settings', async () => {
      await setup();
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      const dialog = screen.getByRole('dialog', { name: 'Git repository' });
      expect(within(dialog).getByRole('textbox', { name: 'Remote (origin)' })).toHaveValue(REMOTE);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('remembers the chosen tab per project', async () => {
      const { ui, view } = await setup();
      fireEvent.click(tab('Enterprise hub'));
      expect(localStorage.getItem(`cfpb.deploy.target:${PATH}`)).toBe('hub');
      view.unmount();
      renderWithProviders(ui(), { store });
      expect(tab('Enterprise hub')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Git repository')).toHaveAttribute('aria-selected', 'false');
      await waitFor(() => expect(api.hubList).toHaveBeenCalledTimes(2));
    });
  });

  describe('shipping', () => {
    async function openShip() {
      await checksOut();
      fireEvent.click(screen.getByRole('button', { name: 'Commit & push' }));
      return screen.getByRole('dialog', { name: 'Commit & push' });
    }

    it('lists the steps and warnings, with the commit message prefilled and required', async () => {
      await setup();
      const dialog = await openShip();
      expect(within(dialog).getByText('Commit the changes')).toBeInTheDocument();
      expect(within(dialog).getByText('Push to origin')).toBeInTheDocument();
      expect(within(dialog).getByText('Tested: Not run yet.')).toBeInTheDocument();
      const message = within(dialog).getByRole('textbox', { name: 'Commit message' });
      expect(message).toHaveValue('Updated a.cf, b.cf');
      const ship = within(dialog).getByRole('button', { name: 'Ship anyway' });
      expect(ship).toBeEnabled();
      fireEvent.change(message, { target: { value: '   ' } });
      expect(ship).toBeDisabled();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('commits and pushes, then shows a notice that hides by itself', async () => {
      const commit = vi.fn(async () => ({ ok: true as const, status: clean({ ahead: 1 }) }));
      const push = vi.fn(async () => ({ ok: true as const, status: clean() }));
      await setup({ overrides: { gitCommit: commit, gitPush: push } });
      const dialog = await openShip();
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Commit message' }), { target: { value: 'Tuned nginx' } });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ship anyway' }));
      expect(await screen.findByText('Pushed abcdef1 to origin/main.')).toBeInTheDocument();
      expect(commit).toHaveBeenCalledWith(PATH, 'Tuned nginx');
      expect(push).toHaveBeenCalledWith(PATH);
      await act(async () => vi.advanceTimersByTime(5000));
      await waitFor(() => expect(screen.queryByText('Pushed abcdef1 to origin/main.')).not.toBeInTheDocument());
    });

    it('shows a rejected push in the run panel', async () => {
      const commit = deferred<OperationResult<{ status: GitStatus }>>();
      const push = vi.fn(async () => ({ ok: false as const, message: 'Push rejected', details: '! [rejected] main -> main (fetch first)' }));
      await setup({ overrides: { gitCommit: vi.fn(() => commit.promise), gitPush: push } });
      fireEvent.click(within(await openShip()).getByRole('button', { name: 'Ship anyway' }));
      expect(await screen.findByText('Committing…')).toBeInTheDocument();
      await act(async () => commit.resolve({ ok: true, status: clean({ ahead: 1 }) }));
      expect(await screen.findByText('Push rejected')).toBeInTheDocument();
      expect(screen.getByText('! [rejected] main -> main (fetch first)')).toBeInTheDocument();
      // A rejected push offers to pull the remote's commits.
      expect(check('Pushed')).toHaveAttribute('title', 'Pushed: The remote has commits you don’t');
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByText('Push rejected')).not.toBeInTheDocument();
    });

    it('saves unsaved edits before pulling the remote’s commits, and doesn’t pull when that fails', async () => {
      const sync = vi.fn(async () => ({ ok: true as const, status: clean(), pulled: true }));
      const { onReload, onSave } = await setup({ dirty: true, git: clean({ behind: 1 }), overrides: { gitSync: sync } });
      fireEvent.click(check('Pushed'));
      const pull = async () => fireEvent.click(await screen.findByRole('button', { name: 'Pull theirs, then push' }));
      onSave.mockResolvedValueOnce(false);
      await pull();
      expect(await screen.findByText('Not pulled: the project isn’t saved.')).toBeInTheDocument();
      expect(sync).not.toHaveBeenCalled();
      expect(onReload).not.toHaveBeenCalled();

      await pull();
      await waitFor(() => expect(onReload).toHaveBeenCalled());
      expect(onSave).toHaveBeenCalledTimes(2);
      expect(onSave.mock.invocationCallOrder[1]).toBeLessThan(sync.mock.invocationCallOrder[0]);
    });
  });
});
