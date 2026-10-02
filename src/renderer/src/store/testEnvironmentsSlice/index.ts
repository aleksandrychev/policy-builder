import { type PayloadAction, createSlice } from '@reduxjs/toolkit';

import { projectCreated, projectLoaded } from '../projectSlice';
import type { TestEnvironment, TestHost } from './types';

const newHost = (name: string, platform = 'ubuntu-22'): TestHost => ({ id: crypto.randomUUID(), name, platform, ports: [], env: {} });

/** A fresh environment: one Ubuntu host, its own hub, Community. */
export function newEnvironment(name: string, host: Partial<TestHost> = {}): TestEnvironment {
  const first = { ...newHost('hub'), ...host };
  return { id: crypto.randomUUID(), name, arch: 'x86_64', edition: 'community', version: 'latest', hub: first.id, env: {}, envFile: null, hosts: [first] };
}

const find = (state: TestEnvironment[], id: string) => state.find(environment => environment.id === id);

const testEnvironmentsSlice = createSlice({
  name: 'testEnvironments',
  initialState: [] as TestEnvironment[],
  reducers: {
    environmentAdded(state, action: PayloadAction<TestEnvironment>) {
      state.push(action.payload);
    },
    environmentChanged(
      state,
      action: PayloadAction<{ changes: Partial<Pick<TestEnvironment, 'arch' | 'edition' | 'envFile' | 'name' | 'version'>>; environmentId: string }>
    ) {
      const environment = find(state, action.payload.environmentId);
      if (environment) Object.assign(environment, action.payload.changes);
    },
    hubChanged(state, action: PayloadAction<{ environmentId: string; hostId: string }>) {
      const environment = find(state, action.payload.environmentId);
      if (environment?.hosts.some(host => host.id === action.payload.hostId)) environment.hub = action.payload.hostId;
    },
    hostAdded(state, action: PayloadAction<{ environmentId: string; platform?: string }>) {
      const environment = find(state, action.payload.environmentId);
      if (!environment) return;
      const names = new Set(environment.hosts.map(host => host.name));
      let number = environment.hosts.length;
      while (names.has(`client${number}`)) number += 1;
      environment.hosts.push(newHost(`client${number}`, action.payload.platform ?? environment.hosts.at(-1)?.platform));
    },
    hostRemoved(state, action: PayloadAction<{ environmentId: string; hostId: string }>) {
      const environment = find(state, action.payload.environmentId);
      if (!environment || environment.hosts.length <= 1) return;
      environment.hosts = environment.hosts.filter(host => host.id !== action.payload.hostId);
      if (environment.hub === action.payload.hostId) environment.hub = environment.hosts[0].id;
    },
    hostRenamed(state, action: PayloadAction<{ environmentId: string; hostId: string; name: string }>) {
      const host = find(state, action.payload.environmentId)?.hosts.find(item => item.id === action.payload.hostId);
      if (host) host.name = action.payload.name;
    },
    hostChanged(state, action: PayloadAction<{ changes: Partial<Pick<TestHost, 'platform' | 'ports'>>; environmentId: string; hostId: string }>) {
      const host = find(state, action.payload.environmentId)?.hosts.find(item => item.id === action.payload.hostId);
      if (host) Object.assign(host, action.payload.changes);
    },
    // The environment's variables (no hostId), or one host's own.
    envVarsChanged(state, action: PayloadAction<{ env: Record<string, string>; environmentId: string; hostId?: string }>) {
      const environment = find(state, action.payload.environmentId);
      const target = action.payload.hostId ? environment?.hosts.find(host => host.id === action.payload.hostId) : environment;
      if (target) target.env = action.payload.env;
    }
  },
  extraReducers: builder => {
    builder.addCase(projectCreated, () => []).addCase(projectLoaded, (_state, action) => action.payload.content.testEnvironments ?? []);
  }
});

export const { environmentAdded, environmentChanged, hubChanged, hostAdded, hostRemoved, hostRenamed, hostChanged, envVarsChanged } =
  testEnvironmentsSlice.actions;
export default testEnvironmentsSlice.reducer;
