import reducer, { envVarsChanged, hostAdded, hostChanged, hostRemoved, hubChanged, newEnvironment } from '.';
import type { TestEnvironment } from './types';

const ENV = 'env';

// An environment with hosts of these names (ids = names); the first is the hub.
function environment(...names: string[]): TestEnvironment {
  const base = newEnvironment('Test');
  const hosts = names.map(name => ({ ...base.hosts[0], id: name, name }));
  return { ...base, id: ENV, hub: hosts[0].id, hosts };
}

const reduce = (start: TestEnvironment, ...actions: Parameters<typeof reducer>[1][]) => actions.reduce(reducer, [start])[0];

describe('newEnvironment', () => {
  it('starts with one host that is its own hub', () => {
    const created = newEnvironment('Test', { platform: 'debian-12' });
    expect(created.hosts).toHaveLength(1);
    expect(created.hub).toBe(created.hosts[0].id);
    expect(created.hosts[0]).toMatchObject({ name: 'hub', platform: 'debian-12' });
  });

  it('gives every environment and host a fresh id', () => {
    const [one, two] = [newEnvironment('A'), newEnvironment('B')];
    expect(one.id).not.toBe(two.id);
    expect(one.hosts[0].id).not.toBe(two.hosts[0].id);
  });
});

describe('testEnvironments reducer', () => {
  it('names added hosts client1, client2…, skipping names still in use', () => {
    let state = reduce(environment('hub'), hostAdded({ environmentId: ENV }), hostAdded({ environmentId: ENV }));
    expect(state.hosts.map(host => host.name)).toEqual(['hub', 'client1', 'client2']);

    state = reduce(state, hostRemoved({ environmentId: ENV, hostId: state.hosts[1].id }), hostAdded({ environmentId: ENV }));
    expect(state.hosts.map(host => host.name)).toEqual(['hub', 'client2', 'client3']);
  });

  it('gives an added host the last host’s platform unless one is given, and a custom image when given', () => {
    const state = reduce(
      environment('hub'),
      hostChanged({ environmentId: ENV, hostId: 'hub', changes: { platform: 'rhel-9' } }),
      hostAdded({ environmentId: ENV }),
      hostAdded({ environmentId: ENV, platform: 'debian-12', image: 'debian:bookworm' })
    );
    expect(state.hosts.map(host => host.platform)).toEqual(['rhel-9', 'rhel-9', 'debian-12']);
    expect(state.hosts[1]).not.toHaveProperty('image');
    expect(state.hosts[2].image).toBe('debian:bookworm');
  });

  it('never removes the last host', () => {
    expect(reduce(environment('hub'), hostRemoved({ environmentId: ENV, hostId: 'hub' })).hosts).toHaveLength(1);
  });

  it('makes the first remaining host the hub when the hub is removed', () => {
    const state = reduce(environment('a', 'b', 'c'), hubChanged({ environmentId: ENV, hostId: 'b' }), hostRemoved({ environmentId: ENV, hostId: 'b' }));
    expect(state.hub).toBe('a');
  });

  it('only makes one of its own hosts the hub', () => {
    expect(reduce(environment('a', 'b'), hubChanged({ environmentId: ENV, hostId: 'elsewhere' })).hub).toBe('a');
    expect(reduce(environment('a', 'b'), hubChanged({ environmentId: ENV, hostId: 'b' })).hub).toBe('b');
  });

  it('drops a cleared custom image rather than keeping it empty', () => {
    const withImage = reduce(environment('a'), hostChanged({ environmentId: ENV, hostId: 'a', changes: { image: 'rockylinux:9' } }));
    expect(withImage.hosts[0].image).toBe('rockylinux:9');
    expect(reduce(withImage, hostChanged({ environmentId: ENV, hostId: 'a', changes: { image: '' } })).hosts[0]).not.toHaveProperty('image');
  });

  it('sets the environment’s variables, or one host’s own', () => {
    const state = reduce(
      environment('a', 'b'),
      envVarsChanged({ environmentId: ENV, env: { SHARED: '1' } }),
      envVarsChanged({ environmentId: ENV, hostId: 'b', env: { OWN: '2' } })
    );
    expect(state.env).toEqual({ SHARED: '1' });
    expect(state.hosts.map(host => host.env)).toEqual([{}, { OWN: '2' }]);
  });

  it('ignores changes to an environment that is gone', () => {
    const state = [environment('a')];
    expect(reducer(state, hostAdded({ environmentId: 'gone' }))).toBe(state);
  });
});
