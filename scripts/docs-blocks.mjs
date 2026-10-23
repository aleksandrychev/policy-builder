#!/usr/bin/env node
// Writes the Block reference of the CFEngine documentation (content/policy-builder/blocks/)
// from the block descriptors: one page per palette category, and the section's index. The
// examples are scripts/docs-examples.json, compiled by the sidecar's compiler (docs_examples.py).
//
//   node scripts/docs-blocks.mjs ../documentation/content/policy-builder/blocks
import { spawnSync } from 'child_process';
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
  Methods: [
    'Method blocks',
    'Blocks for what no other block does: calling an existing bundle, or writing CFEngine policy yourself. [Custom CFEngine and Call Method][] explains when and how to use them.'
  ]
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
// An option as the app shows it: its label, bold, so labels with commas stay apart.
const optionLabel = option => (typeof option === 'string' ? `\`${option}\`` : `**${option.label}**`);

// A default as the app shows it: an option's label, Yes or No, or the value.
function defaultOf(param) {
  if (param.default === undefined || param.default === null || param.default === '') return null;
  const option = param.options?.find(item => (typeof item === 'string' ? item : item.value) === String(param.default));
  if (option) return optionLabel(option);
  if (typeof param.default === 'boolean') return param.default ? 'Yes' : 'No';
  return `\`${param.default}\``;
}

function describe(param) {
  const parts = [param.help ?? ''];
  if (param.allow_list && !/per line/i.test(param.help ?? '')) parts.push('One per line.');
  if (param.options?.length) parts.push(`${param.other_label ? 'For example' : 'One of'}: ${param.options.map(optionLabel).join(', ')}.`);
  if (param.type === 'number' && param.minimum !== undefined) parts.push(`At least ${param.minimum}.`);
  const fallback = defaultOf(param);
  if (fallback) parts.push(`Default: ${fallback}.`);
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

// Each block's example policy: scripts/docs-examples.json compiled by the sidecar's compiler.
function examples() {
  const run = spawnSync('uv', ['run', '--directory', join(ROOT, 'python'), 'python', join(ROOT, 'scripts/docs_examples.py')], { encoding: 'utf-8' });
  if (run.status !== 0) throw new Error(`docs_examples.py failed: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

// Its lines, out of their bundle's indentation; definitions under the section they belong to.
function example(id, compiled) {
  const policy = compiled[id];
  if (!policy) return null;
  const lines = policy.split('\n');
  // The bundles and bodies after it (Custom CFEngine's) keep their own indentation.
  const own = lines.findIndex(line => /^(bundle|body|#)/.test(line));
  const main = own === -1 ? lines : lines.slice(0, own);
  const indent = Math.min(...main.filter(line => line.trim()).map(line => line.match(/^ */)[0].length));
  const section = { 'define-variable': 'vars:', 'define-class': 'classes:' }[id];
  const body = [...main.map(line => line.slice(indent)), ...(own === -1 ? [] : lines.slice(own))];
  return section ? [section, ...body.map(line => (line ? `  ${line}` : line))].join('\n') : body.join('\n');
}

const promiseTypes = descriptor => [
  ...new Set((descriptor.steps ?? descriptor.value_sources?.flatMap(source => source.steps) ?? []).map(step => step.promise_type))
];

function blockSection(descriptor, compiled) {
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
  const policy = example(descriptor.id, compiled);
  if (policy) lines.push('### Example', '', 'The policy it generates, for example:', '', '```cf3', policy, '```', '');
  return lines;
}

// Marks the pages this script writes: only those are replaced, so hand-written ones can sit beside them.
const GENERATED = '# Generated by scripts/docs-blocks.mjs in cfengine/policy-builder, from its block descriptors: edit those, not this page.';

const header = (title, sorting) => ['---', 'layout: default', `title: ${title}`, `sorting: ${sorting}`, GENERATED, '---', ''];

const order = categoryOrder();
const compiled = examples();
const categories = [...new Set(descriptors.map(descriptor => descriptor.category))].sort((a, b) => {
  const rank = category => (order.includes(category) ? order.indexOf(category) : order.length);
  return rank(a) - rank(b) || a.localeCompare(b);
});
const slug = category => CATEGORIES[category]?.[0].toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? category.toLowerCase().replace(/[^a-z0-9]+/g, '-');

mkdirSync(out, { recursive: true });
const pages = readdirSync(out).filter(name => name.endsWith('.markdown'));
const handWritten = [];
for (const name of pages) {
  const text = readFileSync(join(out, name), 'utf-8');
  if (text.includes(GENERATED)) rmSync(join(out, name));
  else handWritten.push(text.match(/^title: (.*)$/m)?.[1]);
}
const index = [
  ...header('Block reference', 110),
  'Every block Policy Builder offers, by category: what it does, its settings, and the CFEngine policy it generates.',
  ''
];
categories.forEach((category, rank) => {
  const [title, intro] = CATEGORIES[category] ?? [`${category} blocks`, ''];
  const blocks = descriptors.filter(descriptor => descriptor.category === category).sort((a, b) => a.name.localeCompare(b.name));
  const page = [...header(title, (rank + 1) * 10), intro, '', ...blocks.flatMap(block => blockSection(block, compiled))];
  writeFileSync(join(out, `${slug(category)}.markdown`), page.join('\n').replace(/\n+$/, '\n'));
  index.push(`- [${title}][]: ${blocks.map(block => block.name).join(', ')}`);
});
// The hand-written pages in the section (Custom CFEngine and Call Method), after the generated ones.
for (const title of handWritten.filter(Boolean)) index.push(`- [${title}][]`);
writeFileSync(join(out, '_index.markdown'), index.join('\n') + '\n');
console.log(`${descriptors.length} blocks in ${categories.length} categories → ${out}`);
