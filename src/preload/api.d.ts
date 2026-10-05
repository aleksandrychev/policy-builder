// Shape of the bridge exposed by preload/index.ts on `window.api`. Kept inline
// (rather than importing the value module) so the renderer's strict type check
// does not pull preload runtime code into the web program.
interface LayoutSettings {
  leftSidebarFraction: number;
  paletteHeightFraction: number;
  rightSidebarFraction: number;
}

type MenuAction = 'close-requested' | 'new-project' | 'open-project' | 'open-recent' | 'project-settings' | 'recents-changed' | 'save' | 'try-demo';

// What the builder saves: its cfbs.json modules (`build` entries for a policy set, the one
// `provides` entry for a module), and its own data for .policy-builder/project.json.
export interface ProjectContent {
  modules: object[];
  project: object;
  provided: object;
  // .policy-builder/test-environments.json (the file is removed when there are none).
  testEnvironments?: object[];
}

export type ProjectType = 'module' | 'policy-set';

// The Docker Engine as the test environments see it (`testenv doctor`).
export interface DockerStatus {
  arch?: string;
  available: boolean;
  host: string | null;
  message: string;
  problem: 'not_installed' | 'not_running' | null;
  version?: string;
}

// A base image a test host can run, and whether it's pulled.
export interface ImageSearch {
  hub: { description: string; name: string; official: boolean; stars: number }[];
  hubError: string | null;
  local: string[];
}

export interface BaseImage {
  id: string;
  image: string;
  label: string;
  present: boolean;
}

// A test host: one container. `ports` are published host:container (TCP).
export interface TestHost {
  env: Record<string, string>;
  id: string;
  name: string;
  platform: string;
  ports: { container: number; host: number }[];
}

// A test environment (.policy-builder/test-environments.json): hosts, which one is the hub, the
// CFEngine edition and version they run, and environment variables (plus an optional .env file).
export interface TestEnvironment {
  arch: 'aarch64' | 'x86_64';
  edition: 'community' | 'enterprise';
  env: Record<string, string>;
  // Relative to the project folder, e.g. "./.env"; its values are read at run time.
  envFile: string | null;
  hosts: TestHost[];
  hub: string;
  id: string;
  // Agent runs per host on Deploy & run, until one repairs nothing (default 3).
  maxRuns?: number;
  name: string;
  // "latest" or an exact release, e.g. "3.27.1".
  version: string;
}

// What Start / Run / Stop / Destroy get: the environment and the project to build and deploy.
export interface TestEnvRequest {
  // The terminal's command (exec).
  command?: string;
  content?: ProjectContent;
  // The .env file's absolute path (absent for an unsaved project).
  envFile?: string | null;
  environment: TestEnvironment;
  // Run / Exec / Destroy only these hosts (default: all).
  hosts?: string[];
  masterfiles?: string;
}

// An error of a host's last agent run, traced to the block (or group) that made it when it's ours.
export interface TestProblem {
  block: string | null;
  bundle: string | null;
  cause: string[];
  count: number;
  file: string | null;
  fileId: string | null;
  line: number | null;
  message: string;
}

// One event of a streaming test-environment run; `exit` always comes last.
export type TestEnvEvent =
  | { current: number; t: 'progress'; total: number }
  | { host?: string | null; line: string; stream?: string; t: 'log' }
  | { host?: string; message: string; step: string; t: 'step' }
  | { container?: string; converged?: boolean; host: string; ip?: string; state: string; t: 'host' }
  | { exit: number; host: string; kept?: number; notKept?: number; repaired?: number; run: number; t: 'result' }
  | { host: string; setup_code: string | null; t: 'hub'; url: string | null }
  | { image: string; os: string | null; platform: string | null; t: 'detected' }
  | { exit: number; host: string; t: 'exec' }
  | { host: string; problems: TestProblem[]; t: 'problems' }
  | { t: 'done' }
  | { message: string; t: 'error' }
  | { message?: string; ok: boolean; t: 'exit' };

// The generated files by project path (.cf and ./templates/), and where each block or group
// landed in each .cf: id → [first, last] line ranges, 1-based.
export interface CompiledPolicy {
  files: Record<string, string>;
  sourceMap: Record<string, Record<string, [number, number][]>>;
}

// How cfbs.json is stored on save; a different type than on disk converts it.
export interface ProjectStorage {
  // Wanted when a module becomes a policy set without masterfiles: "3.27.1", "master", or null.
  masterfiles: string | null;
  type: ProjectType;
}

export interface CreateProjectRequest extends ProjectContent {
  description: string;
  folderName: string;
  git: boolean;
  // An exact version ("3.27.1"), "master", or "no".
  masterfiles: string;
  name: string;
  parent: string;
  type: ProjectType;
}

// Errors come back as data: Electron drops custom Error properties like `details`.
// One finding of Deployment's checks, at a project file's line when it's in one ("./security.cf").
export interface BuildProblem {
  file: string | null;
  line: number;
  message: string;
}

// Deployment's Build: the policy set cfbs built, and what the linter and cf-promises found.
export interface BuildResult {
  lint: { ok: boolean; problems: BuildProblem[] };
  log: string[];
  masterfiles: string;
  // cf-promises ran locally, in a test-host image, or not at all (ok null, with why).
  promises: { how: 'docker' | 'local' | 'skipped'; message?: string; ok: boolean | null; problems: BuildProblem[] };
  tarball: string | null;
}

// A saved Enterprise hub (its password stays in main, encrypted).
export interface SavedHub {
  // SHA-256 of the pinned certificate, when the system doesn't trust it.
  fingerprint?: string;
  url: string;
  username: string;
}

// The hub's certificate, for the user to accept when the system doesn't trust it.
export interface HubProbe {
  fingerprint: string;
  pem: string;
  subject: string;
  trusted: boolean;
  url: string;
  validTo: string;
}

export interface HubInfo {
  hostkey: string;
  hostname: string;
  license: string;
  version: string;
}

// What a hub deploys from and runs: its VCS settings, whether VCS deploys are on (the CMDB class
// cfengine_internal_masterfiles_update), and the policy release (git commit) it last reported.
export interface HubState {
  deploysEnabled: boolean;
  hosts: number | null;
  info: HubInfo;
  releaseId: string | null;
  vcs: { hasKey: boolean; refspec: string; subdirectory: string; type: string; url: string; username: string } | null;
}

// The project folder's git state, for Deployment's Commit & push.
export interface GitStatus {
  ahead: number;
  behind: number;
  branch: string | null;
  // Uncommitted files (cfbs's out/ is ignored).
  changedFiles: number;
  // .policy-builder/project.json at HEAD, parsed: what "changes since the last commit" compares with.
  headBuilder: unknown;
  lastCommit: { date: string; hash: string; subject: string } | null;
  remote: string | null;
  // The folder is its own git repository (not inside another one).
  repo: boolean;
  upstream: string | null;
}

export type OperationResult<T> = ({ ok: true } & T) | { details: string; message: string; ok: false };

export interface MasterfilesVersions {
  latest: string;
}

export interface OpenedProject {
  // The parsed .policy-builder/project.json (or an older project's cfbs.json meta), null without.
  builder: Record<string, unknown> | null;
  // The parsed cfbs.json.
  cfbs: Record<string, unknown>;
  path: string;
  // The parsed .policy-builder/test-environments.json's environments, null without.
  testEnvironments: unknown[] | null;
}

export interface RecentProject {
  // False once the folder or its cfbs.json is gone.
  exists: boolean;
  name: string;
  path: string;
}

export interface TargetCheck {
  parentWritable: boolean;
  targetState: 'empty' | 'new' | 'nonEmpty';
}

declare global {
  interface Window {
    // Optional on purpose: the bridge only exists inside Electron. Renderer
    // code runs without it under vitest/jsdom (and any future browser mode),
    api?: {
      /** Deployment's Build: `cfbs build` in the saved project, then the linter and cf-promises. */
      buildPolicySet: (path: string) => Promise<OperationResult<{ build: BuildResult }>>;
      /** Stops a streaming test-environment run (its last event is an `exit`). */
      cancelTestEnvRun: (runId: string) => Promise<void>;
      /** Checks whether a project folder can be created at parent/folderName. */
      checkProjectTarget: (parent: string, folderName: string) => Promise<TargetCheck>;
      /** Compiles the builder's project data (.policy-builder/project.json) without saving it. */
      compilePolicy: (project: object) => Promise<CompiledPolicy>;
      /** Tells main the user agreed to close the window despite unsaved changes. */
      confirmWindowClose: () => Promise<void>;
      /** Runs `cfbs init` into parent/folderName, then writes the builder's content into its cfbs.json. */
      createProject: (request: CreateProjectRequest) => Promise<OperationResult<{ masterfiles: string | null; path: string }>>;
      /** Builds and checks the saved project, then copies it to a hub over SSH (the user's ssh, no prompts) as its masterfiles. */
      deployOverSsh: (
        path: string,
        target: { host: string; key: string | null; port: number | null }
      ) => Promise<OperationResult<{ build: BuildResult; deployed: boolean; log: string }>>;
      /** Removes a project from the recent-projects list. */
      forgetRecentProject: (path: string) => Promise<void>;
      /** Formats CFEngine policy, rejecting with a message if it cannot. */
      formatPolicy: (source: string) => Promise<string>;
      /** The folder new projects go in by default: the last one used, else ~/Documents. */
      getDefaultProjectParent: () => Promise<string>;
      /** Returns the last-saved sidebar/palette sizes, or null if none were saved yet. */
      getLayoutSettings: () => Promise<LayoutSettings | null>;
      /** Newest 3.27.x masterfiles release (built-in fallback when offline). */
      getMasterfilesVersions: () => Promise<MasterfilesVersions>;
      /** The file-system path of a File dropped onto the window. */
      getPathForFile: (file: File) => string;
      /** The last few opened/created projects, most recent first. */
      getRecentProjects: () => Promise<RecentProject[]>;
      /** Commits everything in the project folder (adding out/ to .gitignore). */
      gitCommit: (path: string, message: string) => Promise<OperationResult<{ status: GitStatus }>>;
      /** Makes the project folder a git repository, with a first commit. */
      gitInit: (path: string) => Promise<OperationResult<{ status: GitStatus }>>;
      /** Pushes the current branch to origin, with the user's own git credentials; never prompts. */
      gitPush: (path: string) => Promise<OperationResult<{ status: GitStatus }>>;
      /** Sets (or adds) the origin remote. */
      gitSetRemote: (path: string, url: string) => Promise<OperationResult<{ status: GitStatus }>>;
      gitStatus: (path: string) => Promise<OperationResult<{ status: GitStatus }>>;
      /** After a rejected push: rebase onto the remote's commits then push ('rebase', aborted on conflicts), or force-push with lease ('force'). */
      gitSync: (path: string, mode: 'force' | 'rebase') => Promise<OperationResult<{ pulled: boolean; status: GitStatus }>>;
      /** Points an Enterprise hub's VCS deployment at a cfbs project repository (GIT_CFBS); credentials left out are cleared on the hub. */
      hubConfigureVcs: (
        url: string,
        settings: {
          gitPassword?: string;
          gitPrivateKeyFile?: string;
          gitRefspec: string;
          gitServer: string;
          gitUsername?: string;
          projectSubdirectory?: string;
        }
      ) => Promise<OperationResult<{ state: HubState }>>;
      /** Logs in to a hub and saves it (password encrypted in main); `fingerprint` is the accepted certificate, null when the system trusts it. */
      hubConnect: (request: {
        fingerprint: string | null;
        password: string;
        url: string;
        username: string;
      }) => Promise<OperationResult<{ hub: SavedHub; state: HubState }>>;
      /** Deploy now: turns VCS deploys on if needed, then runs the hub's agent (pull, cfbs build, validate, swap). */
      hubDeploy: (url: string) => Promise<OperationResult<{ deployed: 'no' | 'unknown' | 'yes'; enabledDeploys?: boolean; output: string; state: HubState }>>;
      hubForget: (url: string) => Promise<void>;
      hubList: () => Promise<SavedHub[]>;
      /** The hub's certificate, and whether the system trusts it. */
      hubProbe: (url: string) => Promise<OperationResult<{ probe: HubProbe }>>;
      hubState: (url: string) => Promise<OperationResult<{ state: HubState }>>;
      /** Opens a native file picker and reads the chosen file as text, or null if cancelled. */
      importTextFile: () => Promise<{ content: string; fileName: string } | null>;
      /** Each step of a running Build or SSH deploy as it starts (build, lint, promises, copy, validate, install, update, policy). */
      onDeployProgress: (callback: (stage: string) => void) => () => void;
      /** Subscribes to native menu clicks, window-close requests and recent-project changes; call the returned function to unsubscribe. */
      onMenuAction: (callback: (action: MenuAction, path?: string) => void) => () => void;
      /** Subscribes to the events of streaming test-environment runs; call the returned function to unsubscribe. */
      onTestEnvEvent: (callback: (runId: string, event: TestEnvEvent) => void) => () => void;
      /** Reads a project's cfbs.json: `path` is its folder or the cfbs.json; without one, a native picker asks (null: cancelled). */
      openProject: (request?: { path?: string }) => Promise<OperationResult<OpenedProject> | null>;
      /** Opens a native folder picker, or null if cancelled. */
      pickDirectory: (defaultPath?: string) => Promise<string | null>;
      /** A file picker in ~/.ssh for the hub's private key (the path only), or null if cancelled. */
      pickSshKey: () => Promise<string | null>;
      /** Shows a file inside the project in the OS file manager. */
      revealInProject: (path: string, file: string) => Promise<void>;
      /** Shows the project's cfbs.json in the OS file manager. */
      revealProject: (path: string) => Promise<void>;
      /** Merges the builder's content into the project's cfbs.json. */
      saveProject: (path: string, content: ProjectContent, storage: ProjectStorage) => Promise<OperationResult<{ masterfiles: string | null }>>;
      /** Sets the window title (null: no project) and the unsaved-changes state. */
      setDocument: (document: { edited: boolean; title: string | null }) => Promise<void>;
      /** Persists sidebar/palette sizes so they survive an app restart. */
      setLayoutSettings: (settings: LayoutSettings) => Promise<void>;
      shouldUseDarkColors: () => Promise<boolean>;
      /** Docker's state for test environments: available, or not installed / not running. */
      testEnvDoctor: () => Promise<DockerStatus>;
      /** The base images test hosts run, and which are pulled. */
      testEnvImages: () => Promise<{ platforms: BaseImage[] }>;
      /** Which platforms have a client / hub package for an edition, version and architecture. */
      testEnvPlatforms: (query: {
        arch: string;
        edition: string;
        version: string;
      }) => Promise<{ platforms: { client: boolean; hub: boolean; id: string; label: string }[] }>;
      /** Images for a custom host: pulled ones matching `term`, and Docker Hub's when `hub`. */
      testEnvSearch: (query: { hub: boolean; term: string }) => Promise<ImageSearch>;
      /** Starts a streaming action (pull a base image; an environment's up / run / stop / destroy); resolves with the run id its events (onTestEnvEvent) carry. */
      testEnvStart: (
        action: 'destroy' | 'exec' | 'inspect' | 'pull' | 'reset' | 'run' | 'start' | 'stop' | 'test' | 'up',
        request: TestEnvRequest | { arch?: string; image: string }
      ) => Promise<string>;
      /** Each host's container as Docker sees it: running, exited, absent… */
      testEnvStatus: (request: TestEnvRequest) => Promise<{ hosts: Record<string, { container?: string; ip?: string | null; state: string }> }>;
    };
  }
}

export {};
