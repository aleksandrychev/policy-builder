// The CFEngine Build index (build.cfengine.com) as the Modules view lists it.

export type ModuleKind = 'configured' | 'library' | 'policy' | 'promise-type';

// A list question's field (one per column of its rows; a single one for a list of texts).
export interface ModuleInputField {
  default?: string;
  key?: string;
  label?: string;
  question?: string;
  type: string;
}

export interface ModuleInputQuestion {
  default?: string;
  label?: string;
  question?: string;
  // A list's fields: several (rows of named fields), or one (a list of texts).
  subtype?: ModuleInputField | ModuleInputField[];
  type: string;
  variable?: string;
  // A list's "add another" question.
  while?: string;
}

export interface CatalogModule {
  aliases: string[];
  by?: string;
  dependencies: string[];
  description: string;
  experimental: boolean;
  input: ModuleInputQuestion[];
  kind: ModuleKind;
  name: string;
  repo?: string;
  subdirectory?: string;
  supported: boolean;
  tags: string[];
  version?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

const inputField = (field: Record<string, unknown>): ModuleInputField => ({
  default: text(field.default),
  key: text(field.key),
  label: text(field.label),
  question: text(field.question),
  type: text(field.type) ?? 'string'
});

function inputQuestion(question: Record<string, unknown>): ModuleInputQuestion {
  const { subtype } = question;
  return {
    ...inputField(question),
    subtype: Array.isArray(subtype) ? subtype.filter(isRecord).map(inputField) : isRecord(subtype) ? inputField(subtype) : undefined,
    variable: text(question.variable),
    while: text(question.while)
  };
}

function kindOf(tags: string[], input: unknown[]): ModuleKind {
  if (tags.includes('promise-type')) return 'promise-type';
  if (tags.includes('library')) return 'library';
  return input.length ? 'configured' : 'policy';
}

/** The index's modules, A–Z; aliases (old names) are folded into the module they point to. */
export function parseIndex(index: Record<string, unknown>): CatalogModule[] {
  const modules = new Map<string, CatalogModule>();
  for (const [name, entry] of Object.entries(index)) {
    if (!isRecord(entry) || 'alias' in entry) continue;
    const tags = strings(entry.tags);
    const input = Array.isArray(entry.input) ? entry.input.filter(isRecord) : [];
    modules.set(name, {
      aliases: [],
      by: text(entry.by)?.replace(/^https:\/\/github\.com\//, ''),
      dependencies: strings(entry.dependencies),
      description: text(entry.description) ?? '',
      experimental: tags.includes('experimental'),
      input: input.map(inputQuestion),
      kind: kindOf(tags, input),
      name,
      repo: text(entry.repo),
      subdirectory: text(entry.subdirectory),
      supported: tags.includes('supported'),
      tags,
      version: text(entry.version)
    });
  }
  for (const [name, entry] of Object.entries(index)) {
    const target = isRecord(entry) ? text(entry.alias) : undefined;
    if (target) modules.get(target)?.aliases.push(name);
  }
  return [...modules.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Where a module's source lives: its repo, or its folder in it. */
export const sourceUrl = (module: CatalogModule) =>
  module.repo && module.subdirectory ? `${module.repo.replace(/\/$/, '')}/tree/HEAD/${module.subdirectory}` : module.repo;

// The tag chips: the frequent tags; the rest are found by searching.
export const TAG_CHIPS: { label: string; tag: string }[] = [
  { label: 'Security', tag: 'security' },
  { label: 'Inventory', tag: 'inventory' },
  { label: 'Compliance', tag: 'compliance' },
  { label: 'Management', tag: 'management' },
  { label: 'Promise types', tag: 'promise-type' },
  { label: 'Windows', tag: 'windows' },
  { label: 'SSH', tag: 'ssh' },
  { label: 'Libraries', tag: 'library' }
];

export interface CatalogFilter {
  search: string;
  supportedOnly: boolean;
  tag: string | null;
}

export interface CatalogMatch {
  // The alias the search matched, when only an old name did.
  alias?: string;
  module: CatalogModule;
}

// Every word of the search, in any order, in the name, description or tags ("delete files").
const matchesTerm = (module: CatalogModule, term: string) => {
  const text = [module.name, module.description, ...module.tags].join(' ').toLowerCase();
  return term.split(/\s+/).every(word => text.includes(word));
};

// Tag chip, Supported and libraries; the search is matched by filterCatalog.
function keeps(module: CatalogModule, { supportedOnly, tag }: CatalogFilter, term: string, showLibraries: boolean) {
  if ((tag && !module.tags.includes(tag)) || (supportedOnly && !module.supported)) return false;
  if (module.kind !== 'library' || showLibraries || tag === 'library') return true;
  return term !== '' && module.name.toLowerCase().includes(term);
}

/**
 * The modules a filter keeps: name, description, tags or an alias contain the search, the tag
 * chip and Supported apply. Libraries only show with their chip or when searched for by name.
 */
export function filterCatalog(modules: CatalogModule[], filter: CatalogFilter, showLibraries = false): CatalogMatch[] {
  const term = filter.search.trim().toLowerCase();
  const matches: CatalogMatch[] = [];
  for (const module of modules) {
    if (!keeps(module, filter, term, showLibraries)) continue;
    if (!term || matchesTerm(module, term)) {
      matches.push({ module });
      continue;
    }
    const alias = module.aliases.find(name => name.toLowerCase().includes(term));
    if (alias) matches.push({ module, alias });
  }
  return matches;
}

export interface AddedModule {
  addedBy?: string;
  name: string;
  version?: string;
}

/** What adding `name` adds: the module, then its dependencies (theirs too) not in the project yet. */
export function modulesToAdd(catalog: Map<string, CatalogModule>, name: string, present: AddedModule[]): AddedModule[] {
  const have = new Set(present.map(module => module.name));
  const added: AddedModule[] = [];
  const visit = (current: string, addedBy?: string) => {
    if (have.has(current)) return;
    have.add(current);
    added.push({ name: current, version: catalog.get(current)?.version, ...(addedBy ? { addedBy } : {}) });
    for (const dependency of catalog.get(current)?.dependencies ?? []) visit(dependency, name);
  };
  visit(name);
  return added;
}

/** What removing `name` removes: it, and the dependencies it brought that nothing left needs. */
export function modulesToRemove(catalog: Map<string, CatalogModule>, name: string, present: AddedModule[]): string[] {
  const removed = new Set([name]);
  let changed = true;
  while (changed) {
    changed = false;
    const kept = present.filter(module => !removed.has(module.name));
    const needed = new Set(kept.flatMap(module => catalog.get(module.name)?.dependencies ?? []));
    for (const module of kept) {
      if (module.addedBy && removed.has(module.addedBy) && !needed.has(module.name)) {
        removed.add(module.name);
        changed = true;
      }
    }
  }
  return present.filter(module => removed.has(module.name)).map(module => module.name);
}
