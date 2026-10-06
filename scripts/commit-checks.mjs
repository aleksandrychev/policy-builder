// Checks each commit in a range against the repo's commit rules:
// a signed-off-by line from the author, and a title of at most 80 characters with no ending
// punctuation, separated from any body by a blank line. Merge commits are skipped, and bots
// (Dependabot) are exempt from signing off. Run: node scripts/commit-checks.mjs <base>..<head>
import { execFileSync } from 'child_process';

const MAX_TITLE = 80;
// The check began here: earlier history is as it is.
const SINCE = 'ae504bad211e14fbed541dab6428b23543b178ee';
const range = process.argv[2];
if (!range) throw new Error('usage: node scripts/commit-checks.mjs <base>..<head>');

const git = (...args) => execFileSync('git', args, { encoding: 'utf-8' });
const known = hash => {
  try {
    git('cat-file', '-e', `${hash}^{commit}`);
    return true;
  } catch {
    return false;
  }
};
const hashes = git('rev-list', '--no-merges', '--reverse', range, ...(known(SINCE) ? [`^${SINCE}`] : []))
  .split('\n')
  .filter(Boolean);

let failed = 0;
for (const hash of hashes) {
  const [author, message] = git('log', '-1', '--format=%ae%x00%B', hash).split('\0');
  const [title = '', second = ''] = message.split('\n');
  const problems = [];
  if (title.length > MAX_TITLE) problems.push(`title is ${title.length} characters (max ${MAX_TITLE})`);
  if (/[.!?;:,]$/.test(title.trim())) problems.push('title ends with punctuation');
  if (second.trim()) problems.push('no blank line after the title');
  const signOffs = [...message.matchAll(/^Signed-off-by: .+ <([^>]+)>$/gm)].map(match => match[1].toLowerCase());
  const bot = /\[bot\]@users\.noreply\.github\.com$/.test(author);
  // Dependabot signs off as itself, not as its author address.
  if (!bot && !signOffs.length) problems.push('no Signed-off-by line (commit with git commit -s)');
  else if (!bot && !signOffs.includes(author.toLowerCase())) problems.push(`Signed-off-by doesn’t match the author <${author}>`);
  if (problems.length) failed += 1;
  console.log(`${problems.length ? '✗' : '✓'} ${hash.slice(0, 7)} ${title}${problems.map(problem => `\n    ${problem}`).join('')}`);
}

console.log(`\n${hashes.length - failed} of ${hashes.length} commits follow the commit rules.`);
if (failed) process.exit(1);
