// One chained transform on top of a value source's expression, e.g.
// string_head(...) applied to the result of readfile(...). Order in the
// array is the nesting order — each wraps the previous one's expression.
// `id` is this chain entry's own identity (for reordering/removal); it's
// distinct from `decoratorId`, which decorator from blocks/decorators.ts is
// applied — the same decorator could appear more than once in a chain.
export interface DecoratorInstance {
  decoratorId: string;
  id: string;
  params: Record<string, string>;
}

// One entry in a Define Class "Combine other classes" condition (and/or)
// — a class name (free text: a hard class, another block's defined class,
// or anything else) plus whether it's negated. `id` is this entry's own
// identity (for reordering/removal), distinct from `name`. There's no
// compiler yet (see blocks/README.md's Known gaps) to expand these into a
// CFEngine list literal for the `and`/`or` attribute — that's future work.
export interface ClassReference {
  id: string;
  name: string;
  negate: boolean;
}

// Gates whether this block evaluates at all: compiled as an if=>/unless=>
// attribute on the block's `methods:` call, not on its inner steps — a real
// cf-agent run showed that a bundle whose every step is skipped by its own
// `if` still reports *kept*, which would wrongly fire "kept" arrows out of
// it; gating the call itself sets no outcome classes at all. At most one
// condition per instance, mirroring CFEngine's attribute shape. `className`
// is a hard class or one built with Define Class. Ordering and
// "run after that block kept/repaired/didn't keep" are arrows (see
// BlockEdge in edgesSlice), not conditions.
export type Condition = { className: string; kind: 'class'; mode: 'if' | 'unless' };
// Tags a Define Variable instance's compiled vars: promise as a CFEngine
// Enterprise inventory attribute (meta => { "inventory", "attribute_name=..."
// }), aggregated hub-wide into Mission Portal — a no-op on Community. Unlike
// Condition, this attribute is independent of which value source is active,
// so (like Condition) it needs to be spliced onto the compiled step at
// generation time rather than living inside a value source's own template.
export interface InventoryTag {
  attributeName: string;
}

// One definition inside a block whose descriptor declares `entries` (Define
// Variable / Define Class). Carries everything that used to live on the
// instance itself for those blocks — the defined name sits in
// params[descriptor.entries.name_param]. Compiles to one promise; the
// instance's own `condition` still gates every entry, and this entry's
// `condition` gates just this one.
export interface DefinitionEntry {
  classRefs?: ClassReference[];
  condition?: Condition;
  decorators?: DecoratorInstance[];
  id: string;
  inventory?: InventoryTag;
  params: Record<string, string>;
  // Sample value to preview the data chain against on the canvas; editor-only.
  sampleInput?: string;
  valueSourceId?: string;
}

// A block parameter computed from data instead of typed: a Define Variable
// value source plus its transformation steps, feeding the parameter
// directly. Compiles to a generated vars: promise (data_<instance>_<param>)
// whose $(...) reference replaces the parameter's text.
export interface ParamBinding {
  decorators?: DecoratorInstance[];
  params: Record<string, string>;
  sampleInput?: string;
  valueSourceId: string;
}

// The fields a Properties form edits. Both a plain BlockInstance and a
// DefinitionEntry have this shape, so the same form and reducers serve both.
export type EditableSubject = Pick<BlockInstance, 'classRefs' | 'condition' | 'decorators' | 'inventory' | 'params' | 'valueSourceId'> & {
  sampleInput?: string;
};

/**
 * A placed block on its file's canvas. The compiled methods: call order is
 * derived from arrows plus canvas position (canvas/executionOrder.ts), not
 * from this array's order. Each policy file has its own canvas.
 */
export interface BlockInstance {
  blockId: string;
  // Only meaningful for Define Class value sources "combine-and"/"combine-or".
  classRefs?: ClassReference[];
  condition?: Condition;
  // Only meaningful for a block with value_sources whose active source
  // produces a string (see blocks/decorators.ts).
  decorators?: DecoratorInstance[];
  // Set (with at least one entry) exactly when the descriptor declares
  // `entries`; those blocks leave params/valueSourceId/decorators/
  // classRefs/inventory empty and keep them per entry instead.
  entries?: DefinitionEntry[];
  fileId: string;
  // The group (store/groupsSlice) whose frame this block sits in, if any.
  groupId?: string;
  // How several incoming arrows combine: 'all' (default) runs only when every
  // source ended with its arrow's outcome, 'any' when at least one did.
  incomingMode?: 'all' | 'any';
  instanceId: string;
  // Only meaningful for Define Variable instances.
  inventory?: InventoryTag;
  label: string;
  // Parameters computed from a data chain instead of typed, by param name.
  paramBindings?: Record<string, ParamBinding>;
  params: Record<string, string>;
  // Top-left corner on the canvas, in flow coordinates. Besides layout it
  // breaks ties in execution order (see canvas/executionOrder.ts): blocks
  // not ordered by arrows run top-to-bottom, then left-to-right.
  position?: { x: number; y: number };
  // Which of the block descriptor's value_sources is active, for blocks that
  // have them (e.g. Define Variable's "Value source" selector). Undefined
  // for blocks with a plain, single steps/parameters shape.
  valueSourceId?: string;
}
