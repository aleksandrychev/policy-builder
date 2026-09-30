import { type Completion, type CompletionContext, type CompletionSource } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';

// Two distinct destinations for a token, with two distinct real CFEngine
// syntaxes — never interchangeable:
// - "mustache": the field is an actual Mustache template body, rendered by
//   CFEngine's own template engine (edit_template + template_method
//   "mustache", e.g. render-template's template_content). A variable inserts
//   as triple-brace "{{{name}}}" — mustache HTML-escapes double-brace output
//   (confirmed against
//   core/tests/acceptance/10_files/templating/mustache_html_escape.cf: "&"
//   becomes "&amp;" through "{{...}}" but passes through unchanged via
//   "{{{...}}}"), which is almost never wanted for a config file rather than
//   HTML. A class inserts as a mustache section — the renderer can't evaluate
//   class expressions, only test whether a single class is set (see
//   mustache_classes.cf in the CFEngine docs) — so it needs a paired
//   "{{#name}}...{{/name}}" (or "{{^name}}...{{/name}}" for "not set");
//   sections aren't interpolation, so they're unaffected by escaping and stay
//   double-brace.
// - "cfengine": the field is plain CFEngine promise text (a commands:
//   promiser, a vars: string literal, ...) that the agent evaluates directly
//   — Mustache braces mean nothing there, only the agent's own scalar
//   reference syntax does, so a variable inserts as "$(name)". There's no
//   class equivalent: a class can't be substituted inline outside a
//   template, it gates a whole promise via the block's own Condition, so
//   callers should simply not offer class tokens in this mode.
export type TemplateTokenSyntax = 'cfengine' | 'mustache';

export interface TemplateToken {
  group?: string;
  kind: 'class' | 'variable';
  label?: string;
  // Path inside datastate(), which Mustache templates render against:
  // "vars.<ns>:<bundle>.<name>" / "classes.<ns>:<name>" (verified with
  // string_mustache). Defaults to `name` when unset.
  mustachePath?: string;
  name: string;
}

export function insertTemplateToken(view: EditorView, token: TemplateToken, from: number, to = from, syntax: TemplateTokenSyntax = 'mustache'): void {
  if (syntax === 'cfengine') {
    const insert = `$(${token.name})`;
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
    return;
  }

  const path = token.mustachePath ?? token.name;
  if (token.kind === 'variable') {
    const insert = `{{{${path}}}}`;
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
    return;
  }

  const open = `{{#${path}}}`;
  const close = `{{/${path}}}`;
  view.dispatch({ changes: { from, to, insert: open + close }, selection: { anchor: from + open.length } });
}

// "@name" completes to a variable; "#name" completes to a class section
// (mustache syntax only — callers pass a class-free token list in cfengine
// mode, so "#" naturally yields no candidates there).
export function templateTokenCompletionSource(tokens: TemplateToken[], syntax: TemplateTokenSyntax = 'mustache'): CompletionSource {
  return (context: CompletionContext) => {
    const word = context.matchBefore(/[@#][\w.:]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    const trigger = word.text[0];
    const kind = trigger === '#' ? 'class' : 'variable';
    const candidates = tokens.filter(token => token.kind === kind);

    return {
      from: word.from,
      options: candidates.map(token => ({
        label: `${trigger}${token.name}`,
        detail: token.label,
        type: token.kind,
        apply: (view: EditorView, _completion: Completion, from: number, to: number) => insertTemplateToken(view, token, from, to, syntax)
      })),
      validFor: /^[@#][\w.:]*$/
    };
  };
}
