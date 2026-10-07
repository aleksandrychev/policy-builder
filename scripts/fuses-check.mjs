// Checklist item 19 (SECURITY-CHECKLIST.md): the fuses electron-builder.yml asks for are flipped
// in the packaged binary. Run: node scripts/fuses-check.mjs <packaged app or executable>
import { execFileSync } from 'child_process';

const EXPECTED = {
  RunAsNode: 'Disabled',
  EnableCookieEncryption: 'Enabled',
  EnableNodeOptionsEnvironmentVariable: 'Disabled',
  EnableNodeCliInspectArguments: 'Disabled',
  EnableEmbeddedAsarIntegrityValidation: 'Enabled',
  OnlyLoadAppFromAsar: 'Enabled',
  GrantFileProtocolExtraPrivileges: 'Disabled'
};

const app = process.argv[2];
if (!app) throw new Error('usage: node scripts/fuses-check.mjs <packaged app>');
const output = execFileSync('npx', ['electron-fuses', 'read', '--app', app], { encoding: 'utf-8' });
const actual = Object.fromEntries([...output.matchAll(/^\s+(\w+) is (Enabled|Disabled)$/gm)].map(([, name, state]) => [name, state]));

let failed = false;
for (const [name, state] of Object.entries(EXPECTED)) {
  const ok = actual[name] === state;
  failed ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${name} is ${actual[name] ?? 'missing'}${ok ? '' : ` (expected ${state})`}`);
}
if (failed) process.exit(1);
