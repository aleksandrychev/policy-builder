import { describe, expect, it } from 'vitest';

import { environmentsFrom } from './cfbsProject';

describe('environmentsFrom', () => {
  it('keeps a valid environment and fills in what is missing', () => {
    const [environment] = environmentsFrom([
      { id: 'e1', hosts: [{ id: 'h1', name: 'web', ports: [{ host: 8080, container: 80 }, { host: 'x' }], env: { A: '1', B: 2 } }] }
    ]);

    expect(environment).toEqual({
      id: 'e1',
      name: 'Environment',
      arch: 'x86_64',
      edition: 'community',
      version: 'latest',
      hub: 'h1',
      env: {},
      envFile: null,
      hosts: [{ id: 'h1', name: 'web', platform: 'ubuntu-22', ports: [{ host: 8080, container: 80 }], env: { A: '1' } }]
    });
  });

  it('drops environments without hosts and points a missing hub at the first host', () => {
    const environments = environmentsFrom([
      { id: 'empty', hosts: [] },
      { id: 'e2', edition: 'enterprise', hub: 'gone', hosts: [{ id: 'a' }, { id: 'b' }] },
      'junk'
    ]);

    expect(environments.map(environment => [environment.id, environment.edition, environment.hub])).toEqual([['e2', 'enterprise', 'a']]);
  });
});
