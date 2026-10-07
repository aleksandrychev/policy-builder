// A test host: one Docker container. `ports` are published host:container (TCP).
export interface TestHost {
  env: Record<string, string>;
  id: string;
  // A custom Docker image to run instead of the platform's ("rockylinux:9"); `platform` then
  // says which CFEngine package it takes.
  image?: string;
  name: string;
  // A key of cfpb_testenv.PLATFORMS: "ubuntu-22", "ubuntu-24", "debian-12".
  platform: string;
  ports: { container: number; host: number }[];
}

// A test environment (.policy-builder/test-environments.json): hosts, which one is the hub (a
// single host is its own hub), the CFEngine edition and version they run, and environment
// variables — the environment's, each host's own, and an optional .env file's.
export interface TestEnvironment {
  // The hosts' CPU architecture. x86-64 by default — on Apple Silicon Docker emulates it — since
  // most platforms have x86-64 packages; arm64 runs natively there.
  arch: 'aarch64' | 'x86_64';
  edition: 'community' | 'enterprise';
  env: Record<string, string>;
  // Relative to the project folder, e.g. "./.env"; read when hosts start or run, never saved.
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

// The platforms a host can run (cfpb_testenv.PLATFORMS); which have packages depends on the
// edition, version and architecture (the sidecar's `testenv platforms`).
export const PLATFORMS = [
  { id: 'ubuntu-20', label: 'Ubuntu 20.04' },
  { id: 'ubuntu-22', label: 'Ubuntu 22.04' },
  { id: 'ubuntu-24', label: 'Ubuntu 24.04' },
  { id: 'debian-12', label: 'Debian 12' },
  { id: 'debian-13', label: 'Debian 13' },
  { id: 'rhel-7', label: 'RHEL 7 (CentOS 7)' },
  { id: 'rhel-8', label: 'RHEL 8 (AlmaLinux 8)' },
  { id: 'rhel-9', label: 'RHEL 9 (AlmaLinux 9)' },
  { id: 'rhel-10', label: 'RHEL 10 (AlmaLinux 10)' }
] as const;

// Whether a platform has a client / hub package (null: not known yet, e.g. offline).
export type PlatformSupport = Record<string, { client: boolean; hub: boolean }>;
