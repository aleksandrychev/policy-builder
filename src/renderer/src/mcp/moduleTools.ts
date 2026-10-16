import { requiredModule } from '../blocks/requiredModule';
import { type CatalogModule, TAG_CHIPS, filterCatalog, modulesToAdd, modulesToRemove, parseIndex } from '../modules/catalog';
import { type ReadmeNode, parseDetails } from '../modules/moduleDetails';
import { isAnswered, isSupported, needsInput } from '../modules/moduleInput';
import type { RootState } from '../store';
import { type ModuleInputResponse, moduleInputChanged, modulesAdded, modulesRemoved } from '../store/modulesSlice';
import { ToolError, optionalStr, str } from './shared';
import type { Input, Tool, ToolEnv } from './shared';

/** CFEngine Build modules (build.cfengine.com): searched, read, added to the project and answered. */

let catalogRequest: Promise<{ byName: Map<string, CatalogModule>; modules: CatalogModule[]; offline: boolean }> | null = null;

function catalog() {
  catalogRequest ??= (async () => {
    if (!window.api) throw new ToolError('Modules need the Policy Builder desktop app');
    const result = await window.api.getModuleIndex();
    if (!result.index) {
      catalogRequest = null;
      throw new ToolError(`Can’t load the module list (offline?): ${result.error ?? 'no copy downloaded yet'}`);
    }
    const modules = parseIndex(result.index);
    return { modules, byName: new Map(modules.map(module => [module.name, module])), offline: result.offline };
  })();
  return catalogRequest;
}

async function moduleOf(name: string) {
  const { byName } = await catalog();
  const module = byName.get(name);
  if (!module) throw new ToolError(`No module ${name}; search_modules finds them`);
  return module;
}

// Modules go into a policy set's build; a module project can't hold them.
function policySet(state: RootState) {
  if (!state.project) throw new ToolError('No project is open in Policy Builder; open or create one first');
  if (state.project.type === 'module') throw new ToolError('This project is a cfbs module: modules go into policy-set projects');
}

const usedBy = (state: RootState, name: string) => state.canvas.filter(block => requiredModule(block) === name).map(block => block.label);

// The README as plain text, headings and list items on lines of their own.
function readmeText(nodes: ReadmeNode[]): string {
  const blocks = new Set(['p', 'div', 'pre', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'dd', 'blockquote', 'figure', 'br', 'hr']);
  return nodes
    .map(node => {
      if (typeof node === 'string') return node;
      const inner = readmeText(node.children);
      if (node.tag === 'img') return `[image: ${node.alt ?? ''}]`;
      if (node.tag === 'a' && node.href && inner.trim() && inner.trim() !== node.href) return `${inner} (${node.href})`;
      return blocks.has(node.tag) ? `\n${node.tag === 'li' ? '- ' : ''}${inner}\n` : inner;
    })
    .join('')
    .replace(/\n{3,}/g, '\n\n');
}

const README_LIMIT = 8000;

async function readme(module: CatalogModule) {
  const result = await window.api?.getModuleDetails(module.name).catch(() => null);
  if (!result?.details) return { readme: undefined, author: undefined, downloads: undefined };
  const details = parseDetails(result.details);
  const text = readmeText(details.readme).trim();
  return {
    author: details.author?.name,
    downloads: details.downloads,
    readme: text.length > README_LIMIT ? `${text.slice(0, README_LIMIT)}… (cut; the module's page has the rest)` : text
  };
}

const summary = (module: CatalogModule, state: RootState) => ({
  name: module.name,
  kind: module.kind,
  version: module.version,
  description: module.description,
  tags: module.tags,
  experimental: module.experimental || undefined,
  inProject: state.modules.some(added => added.name === module.name) || undefined
});

async function searchModules(env: ToolEnv, input: Input) {
  const { modules, offline } = await catalog();
  const tag = optionalStr(input, 'tag');
  const found = filterCatalog(modules, { search: optionalStr(input, 'query') ?? '', supportedOnly: input.supportedOnly === true, tag: tag ?? null }, true);
  const state = env.getState();
  return {
    modules: found.slice(0, 40).map(({ module, alias }) => ({ ...summary(module, state), alsoKnownAs: alias })),
    more: found.length > 40 ? `${found.length - 40} more: narrow the query or pick a tag` : undefined,
    tags: TAG_CHIPS.map(chip => chip.tag),
    offline: offline || undefined
  };
}

async function getModule(env: ToolEnv, input: Input) {
  const module = await moduleOf(str(input, 'name'));
  const state = env.getState();
  const added = state.modules.find(item => item.name === module.name);
  return {
    ...summary(module, state),
    supported: module.supported,
    by: module.by,
    source: module.repo,
    dependencies: module.dependencies,
    aliases: module.aliases.length ? module.aliases : undefined,
    promiseType:
      module.kind === 'promise-type'
        ? 'Adds a promise type: use its block (list_block_types, category "From modules") or Custom Promise. Hosts need python3.'
        : undefined,
    input: module.input.length
      ? module.input.map(question => ({
          variable: question.variable,
          label: question.label,
          question: question.question,
          type: question.type,
          fields: Array.isArray(question.subtype)
            ? question.subtype.map(field => ({ key: field.key, label: field.label, question: field.question, default: field.default }))
            : undefined,
          listOf: question.subtype && !Array.isArray(question.subtype) ? 'text' : undefined,
          supported: isSupported(question) || undefined,
          answer: added?.input?.[question.variable ?? ''],
          answered: added ? isAnswered(question, added.input?.[question.variable ?? '']) : undefined
        }))
      : undefined,
    project: added
      ? { addedFor: added.addedBy, needsInput: needsInput(module.input, added.input) || undefined, usedBy: usedBy(state, module.name) }
      : undefined,
    ...(await readme(module))
  };
}

async function addModule(env: ToolEnv, input: Input) {
  policySet(env.getState());
  const { byName } = await catalog();
  const module = await moduleOf(str(input, 'name'));
  const state = env.getState();
  if (state.modules.some(added => added.name === module.name)) throw new ToolError(`${module.name} is in the project already`);
  const added = modulesToAdd(byName, module.name, state.modules);
  env.dispatch(modulesAdded(added));
  return {
    added: added.map(item => item.name),
    input: module.input.length ? 'It asks for input: answer each question with set_module_input (get_module lists them)' : undefined,
    note: 'Installed with cfbs when the project is saved (needs the internet once); it runs before the project’s own policy.'
  };
}

function removeModule(env: ToolEnv, input: Input) {
  const state = env.getState();
  policySet(state);
  const name = str(input, 'name');
  const added = state.modules.find(item => item.name === name);
  if (!added) throw new ToolError(`${name} isn’t in the project`);
  if (added.addedBy) throw new ToolError(`${name} came with ${added.addedBy}: it goes when nothing needs it`);
  const blocks = usedBy(state, name);
  if (blocks.length) throw new ToolError(`${name} is used by ${blocks.join(', ')}: remove those blocks first`);
  return catalog().then(({ byName }) => {
    const removed = modulesToRemove(byName, name, state.modules);
    env.dispatch(modulesRemoved(removed));
    return { removed };
  });
}

// The answer as the question takes it: text, a list of texts, or rows of the question's fields.
function checkedResponse(question: CatalogModule['input'][number], response: unknown): ModuleInputResponse {
  if (question.type === 'string') {
    if (typeof response !== 'string') throw new ToolError(`${question.variable} takes text`);
    return response;
  }
  if (!Array.isArray(response)) throw new ToolError(`${question.variable} takes a list`);
  if (!Array.isArray(question.subtype)) {
    if (!response.every(item => typeof item === 'string')) throw new ToolError(`${question.variable} takes a list of texts`);
    return response as string[];
  }
  const fields = question.subtype;
  const keys = fields.map(field => field.key ?? '');
  return response.map((row, index) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row))
      throw new ToolError(`${question.variable}[${index}] takes an object with ${keys.join(', ')}`);
    const unknown = Object.keys(row).filter(key => !keys.includes(key));
    if (unknown.length) throw new ToolError(`${question.variable}[${index}]: no field ${unknown.join(', ')}; its fields: ${keys.join(', ')}`);
    const given = row as Record<string, unknown>;
    return Object.fromEntries(fields.map(field => [field.key ?? '', String(given[field.key ?? ''] ?? field.default ?? '')]));
  });
}

async function setModuleInput(env: ToolEnv, input: Input) {
  policySet(env.getState());
  const module = await moduleOf(str(input, 'name'));
  if (!env.getState().modules.some(added => added.name === module.name)) throw new ToolError(`${module.name} isn’t in the project: add_module first`);
  const variable = str(input, 'variable');
  const question = module.input.find(item => item.variable === variable);
  if (!question)
    throw new ToolError(`${module.name} has no question ${variable}; its questions: ${module.input.map(item => item.variable).join(', ') || 'none'}`);
  if (!isSupported(question)) throw new ToolError(`${variable}'s input type isn’t supported in the builder: answer it with cfbs input`);
  env.dispatch(moduleInputChanged({ name: module.name, variable, response: checkedResponse(question, input.response) }));
  const added = env.getState().modules.find(item => item.name === module.name);
  return { needsInput: needsInput(module.input, added?.input) || undefined };
}

export const MODULE_TOOLS: Record<string, Tool> = {
  search_modules: searchModules,
  get_module: getModule,
  add_module: addModule,
  remove_module: removeModule,
  set_module_input: setModuleInput
};
