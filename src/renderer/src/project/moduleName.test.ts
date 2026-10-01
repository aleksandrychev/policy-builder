import { moduleNameFor } from './moduleName';

describe('moduleNameFor', () => {
  it.each([
    ['Web Server Hardening', 'web-server-hardening'],
    ['  Nginx -- demo!! ', 'nginx-demo'],
    ['2024 plan', 'policy-2024-plan'],
    ['***', 'policy']
  ])('%s → %s', (name, expected) => {
    expect(moduleNameFor(name)).toBe(expected);
  });
});
