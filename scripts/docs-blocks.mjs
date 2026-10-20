#!/usr/bin/env node
// Writes the Block reference of the CFEngine documentation (content/policy-builder/blocks/)
// from the block descriptors: one page per palette category, and the section's index. The
// examples are the compiler's snapshots (python/tests/snapshots/), which its tests keep current.
//
//   node scripts/docs-blocks.mjs ../documentation/content/policy-builder/blocks
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/docs-blocks.mjs <output folder>');
  process.exit(1);
}

// Each category's page: its title (unique across the docs: titles are link targets) and intro.
const CATEGORIES = {
  Files: ['File blocks', 'Blocks that create, copy, change and remove files and directories, and set their permissions.'],
  'File Contents': ['File content blocks', 'Blocks that change what is inside a file, line by line, without replacing the whole file.'],
  'Variables & Classes': [
    'Variable and class blocks',
    'Blocks that define variables (values other blocks can use) and classes (conditions other blocks can depend on).'
  ],
  Packages: ['Package blocks', 'Blocks that install and remove software packages, with the host’s package manager.'],
  Commands: ['Command blocks', 'Blocks that run commands, now or on a schedule.'],
  Services: ['Service blocks', 'Blocks that keep services running, stopped, enabled or disabled.'],
  Users: ['User blocks', 'Blocks that create, change and remove local user accounts.'],
  Storage: ['Storage blocks', 'Blocks that mount file systems.'],
  Reports: ['Report blocks', 'Blocks that print messages in the agent’s output.'],
  Processes: ['Process blocks', 'Blocks that act on running processes.'],
  'From modules': [
    'Blocks from modules',
    'Blocks whose promise types come from CFEngine Build modules. Adding one adds its module to the project; saving installs it with `cfbs`. The module runs with Python, so hosts need `python3`.'
  ],
  Methods: ['Method blocks', 'Blocks for what no other block does: calling an existing bundle, or writing CFEngine policy yourself.']
};

// The palette's category order, from the renderer (the one place it's defined).
function categoryOrder() {
  const source = readFileSync(join(ROOT, 'src/renderer/src/blocks/loadBlocks.ts'), 'utf-8');
  const list = source.match(/const CATEGORY_ORDER = \[([^\]]*)\]/);
  if (!list) throw new Error('CATEGORY_ORDER not found in loadBlocks.ts');
  return [...list[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
}

const descriptors = readdirSync(join(ROOT, 'blocks'))
  .filter(name => name.endsWith('.json'))
  .map(name => JSON.parse(readFileSync(join(ROOT, 'blocks', name), 'utf-8')))
  .filter(descriptor => descriptor.schema_version === 1);

const cell = text => String(text).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
const optionList = options => options.map(option => (typeof option === 'string' ? `\`${option}\`` : `\`${option.value}\` (${option.label})`)).join(', ');

function describe(param) {
  const parts = [param.help ?? ''];
  if (param.allow_list && !/per line/i.test(param.help ?? '')) parts.push('One per line.');
  if (param.options?.length) parts.push(`${param.other_label ? 'For example' : 'One of'}: ${optionList(param.options)}.`);
  if (param.type === 'number' && param.minimum !== undefined) parts.push(`At least ${param.minimum}.`);
  if (param.default !== undefined && param.default !== '' && param.default !== null) parts.push(`Default: \`${param.default}\`.`);
  return cell(parts.filter(Boolean).join(' '));
}

// A markdown table with every column padded to its widest cell, so the source lines up.
function table(head, rows) {
  const widths = head.map((title, column) => Math.max(3, title.length, ...rows.map(row => row[column].length)));
  const line = cells => `| ${cells.map((text, column) => text.padEnd(widths[column])).join(' | ')} |`;
  return [line(head), line(widths.map(width => '-'.repeat(width))), ...rows.map(line)];
}

function settingsTable(params) {
  if (!params.length) return [];
  return table(
    ['Setting', 'Required', 'Description'],
    params.map(param => [`**${cell(param.label)}**`, param.required ? 'Yes' : 'No', describe(param)])
  );
}

// The snapshot's first case: the policy the block generates from the test's example settings.
function example(id) {
  let text;
  try {
    text = readFileSync(join(ROOT, 'python/tests/snapshots', `${id}.cf`), 'utf-8');
  } catch {
    return null;
  }
  const first = text.split(/^### .*$/m)[1] ?? '';
  const lines = first.split('\n').filter(line => !/^\s*# Case \d+$/.test(line));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const indent = Math.min(...lines.filter(line => line.trim()).map(line => line.match(/^ */)[0].length));
  return lines.map(line => line.slice(indent)).join('\n');
}

const promiseTypes = descriptor => [
  ...new Set((descriptor.steps ?? descriptor.value_sources?.flatMap(source => source.steps) ?? []).map(step => step.promise_type))
];

function blockSection(descriptor) {
  const lines = [`## ${descriptor.name}`, '', descriptor.description, ''];
  const types = promiseTypes(descriptor);
  if (descriptor.custom) lines.push('**Generates:** the promises and definitions you write.', '');
  else if (types.length)
    lines.push(
      `**Generates:** ${types.length > 1 ? '' : 'a '}${types.map(type => `\`${type}\``).join(', ')} ${types.length > 1 ? 'promises' : 'promise'}.`,
      ''
    );
  if (descriptor.requires_module) lines.push(`**Module:** \`${descriptor.requires_module}\`, added to the project with the block.`, '');
  const settings = settingsTable(descriptor.parameters ?? []);
  if (settings.length) lines.push('### Settings', '', ...settings, '');
  if (descriptor.value_sources) {
    lines.push(
      '### Sources',
      '',
      `Where the ${descriptor.entries?.noun ?? 'value'} comes from:`,
      '',
      ...table(
        ['Source', 'CFEngine', 'Settings'],
        descriptor.value_sources.map(source => [
          `**${cell(source.label)}**`,
          source.badge ? `\`${cell(source.badge)}\`` : '—',
          cell(source.parameters.map(param => param.label).join(', ')) || '—'
        ])
      ),
      ''
    );
  }
  const policy = example(descriptor.id);
  if (policy) lines.push('### Example', '', 'The policy it generates, for example:', '', '```cf3', policy, '```', '');
  return lines;
}

const header = (title, sorting) => [
  '---',
  'layout: default',
  `title: ${title}`,
  `sorting: ${sorting}`,
  '# Generated by scripts/docs-blocks.mjs in cfengine/policy-builder, from its block descriptors: edit those, not this page.',
  '---',
  ''
];

const order = categoryOrder();
const categories = [...new Set(descriptors.map(descriptor => descriptor.category))].sort((a, b) => {
  const rank = category => (order.includes(category) ? order.indexOf(category) : order.length);
  return rank(a) - rank(b) || a.localeCompare(b);
});
const slug = category => CATEGORIES[category]?.[0].toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? category.toLowerCase().replace(/[^a-z0-9]+/g, '-');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const index = [
  ...header('Block reference', 70),
  'Every block Policy Builder offers, by category: what it does, its settings, and the CFEngine policy it generates.',
  ''
];
categories.forEach((category, rank) => {
  const [title, intro] = CATEGORIES[category] ?? [`${category} blocks`, ''];
  const blocks = descriptors.filter(descriptor => descriptor.category === category).sort((a, b) => a.name.localeCompare(b.name));
  const page = [...header(title, (rank + 1) * 10), intro, '', ...blocks.flatMap(blockSection)];
  writeFileSync(join(out, `${slug(category)}.markdown`), page.join('\n').replace(/\n+$/, '\n'));
  index.push(`- [${title}][]: ${blocks.map(block => block.name).join(', ')}`);
});
writeFileSync(join(out, '_index.markdown'), index.join('\n') + '\n');
console.log(`${descriptors.length} blocks in ${categories.length} categories → ${out}`);
