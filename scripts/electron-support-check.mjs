// Checklist item 16 (SECURITY-CHECKLIST.md): the installed Electron is a supported major (Electron
// supports the latest three stable majors) and npm knows no advisory for it.
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

// From the lockfile, so no install is needed.
const installed = JSON.parse(readFileSync('package-lock.json', 'utf-8')).packages['node_modules/electron'].version;
const releases = await (await fetch('https://releases.electronjs.org/releases.json')).json();
const stable = releases.map(release => release.version).filter(version => !version.includes('-'));
const supported = [...new Set(stable.map(version => Number(version.split('.')[0])))].sort((a, b) => b - a).slice(0, 3);
const major = Number(installed.split('.')[0]);
const latestOfMajor = stable.find(version => version.startsWith(`${major}.`));

let failed = false;
if (supported.includes(major)) console.log(`✓ Electron ${installed} is a supported major (supported: ${supported.join(', ')})`);
else {
  console.log(`✗ Electron ${installed} is no longer supported (supported: ${supported.join(', ')})`);
  failed = true;
}
if (latestOfMajor && latestOfMajor !== installed) console.log(`  note: ${latestOfMajor} is the latest ${major}.x release`);

// npm audit exits non-zero when it finds anything; its JSON is on stdout either way.
let report;
try {
  report = JSON.parse(execFileSync('npm', ['audit', '--json'], { encoding: 'utf-8' }));
} catch (error) {
  report = JSON.parse(error.stdout);
}
const advisory = report.vulnerabilities?.electron;
if (advisory) {
  console.log(`✗ npm audit: electron is ${advisory.severity} (${advisory.via.map(via => (typeof via === 'string' ? via : via.title)).join('; ')})`);
  failed = true;
} else console.log('✓ npm audit reports no advisory for electron');

if (failed) process.exit(1);
