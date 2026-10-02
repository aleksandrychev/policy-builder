import { type Extension, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, GutterMarker, WidgetType, gutter } from '@codemirror/view';

// One block (or group) of the generated file: where it is and how it's drawn.
export interface PolicyRegion {
  color: string;
  id: string;
  // A group's frame: drawn behind its blocks, picked only where no block is.
  isGroup: boolean;
  label: string;
  ranges: [number, number][];
  // Shown after its first line, e.g. "Set Config Values".
  type: string;
}

// A class or variable the project defines, and the block that defines it.
export interface PolicyReference {
  fileId: string;
  id: string;
  // A class name ("sshd_installed") or a qualified variable ("security_vars.port").
  name: string;
}

const lineRegions = (regions: PolicyRegion[]) => {
  const byLine = new Map<number, PolicyRegion>();
  // Groups first, so their blocks win the lines they share.
  for (const region of [...regions].sort((a, b) => Number(b.isGroup) - Number(a.isGroup))) {
    for (const [first, last] of region.ranges) for (let line = first; line <= last; line += 1) byLine.set(line, region);
  }
  return byLine;
};

class BarMarker extends GutterMarker {
  constructor(
    readonly region: PolicyRegion,
    readonly first: boolean
  ) {
    super();
  }

  eq(other: BarMarker) {
    return other.region.id === this.region.id && other.first === this.first;
  }

  toDOM() {
    const bar = document.createElement('div');
    bar.className = this.region.isGroup ? 'cm-block-bar cm-group-bar' : 'cm-block-bar';
    bar.style.background = this.region.color;
    bar.title = `${this.region.label} · ${this.region.type}`;
    return bar;
  }
}

class TypeWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: TypeWidget) {
    return other.text === this.text;
  }

  toDOM() {
    const tag = document.createElement('span');
    tag.className = 'cm-block-type';
    tag.textContent = this.text;
    return tag;
  }
}

const setHovered = StateEffect.define<string | null>();
const hovered = StateField.define<string | null>({
  create: () => null,
  update: (value, transaction) => transaction.effects.find(effect => effect.is(setHovered))?.value ?? (transaction.docChanged ? null : value)
});

const WORD = /[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?/g;

/**
 * The generated file's structure: a coloured bar per block in the gutter, its type after its first
 * line, a tint on hover; a click selects the block under it, and the project's classes and
 * variables are links to the block that defines them.
 */
export function policyBlocks(
  regions: PolicyRegion[],
  references: PolicyReference[],
  onSelect: (id: string) => void,
  onFollow: (reference: PolicyReference) => void
): Extension {
  const byLine = lineRegions(regions);
  const byName = new Map(references.map(reference => [reference.name, reference]));
  const at = (view: EditorView, pos: number) => byLine.get(view.state.doc.lineAt(pos).number);

  const decorations = EditorView.decorations.compute(['doc', hovered], state => {
    const builder = new RangeSetBuilder<Decoration>();
    const active = state.field(hovered);
    for (let number = 1; number <= state.doc.lines; number += 1) {
      const line = state.doc.line(number);
      const region = byLine.get(number);
      if (region && region.id === active) builder.add(line.from, line.from, Decoration.line({ class: 'cm-hovered-block' }));
      for (const match of line.text.matchAll(WORD)) {
        const reference = byName.get(match[0]);
        if (!reference) continue;
        const from = line.from + (match.index ?? 0);
        builder.add(from, from + match[0].length, Decoration.mark({ class: 'cm-project-ref', attributes: { 'data-ref': reference.name } }));
      }
      if (region && !region.isGroup && region.ranges.some(([first]) => first === number)) {
        builder.add(line.to, line.to, Decoration.widget({ widget: new TypeWidget(region.type), side: 1 }));
      }
    }
    return builder.finish() as DecorationSet;
  });

  return [
    hovered,
    decorations,
    gutter({
      class: 'cm-block-gutter',
      lineMarker: (view, line) => {
        const region = at(view, line.from);
        if (!region) return null;
        const number = view.state.doc.lineAt(line.from).number;
        return new BarMarker(
          region,
          region.ranges.some(([first]) => first === number)
        );
      },
      lineMarkerChange: update => update.docChanged
    }),
    EditorView.domEventHandlers({
      mousemove: (event, view) => {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const id = pos === null ? null : (at(view, pos)?.id ?? null);
        if (id !== view.state.field(hovered)) view.dispatch({ effects: setHovered.of(id) });
      },
      mouseleave: (_event, view) => {
        if (view.state.field(hovered) !== null) view.dispatch({ effects: setHovered.of(null) });
      },
      click: (event, view) => {
        // A drag that selected text is for copying, not picking a block.
        if (!view.state.selection.main.empty) return false;
        const link = (event.target as HTMLElement).closest('[data-ref]');
        const reference = link && byName.get(link.getAttribute('data-ref') ?? '');
        if (reference) {
          onFollow(reference);
          return true;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const region = pos === null ? undefined : at(view, pos);
        if (region) onSelect(region.id);
        return false;
      }
    }),
    EditorView.theme({
      '.cm-block-gutter': { width: '6px', paddingLeft: '2px' },
      '.cm-block-gutter .cm-gutterElement': { padding: 0, height: '100%' },
      '.cm-block-bar': { width: '4px', height: '100%', borderRadius: '1px', cursor: 'pointer' },
      '.cm-group-bar': { opacity: 0.35 },
      '.cm-block-type': { marginLeft: '12px', fontSize: '11px', fontFamily: 'sans-serif', opacity: 0.55 },
      '.cm-project-ref': { textDecoration: 'underline dotted', textUnderlineOffset: '3px', cursor: 'pointer' },
      '.cm-project-ref:hover': { textDecorationStyle: 'solid' },
      '.cm-content': { cursor: 'pointer' }
    })
  ];
}
