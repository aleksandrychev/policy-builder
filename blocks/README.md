# Block descriptors

The contract between the editor and the policy compiler: what each block type shows in the UI, and
exactly what CFEngine it compiles to. Both the renderer and the Python compiler read these files, so
block shape is defined here and nowhere else.

| File | What it is |
|---|---|
| `*.json` | One block type per file, named `<id>.json` |
| [`lib/decorators.json`](lib/decorators.json) | Value transforms a variable (or a data-fed parameter) can be chained through |
| [`lib/bodies.json`](lib/bodies.json) | Bodies the blocks need that the stdlib lacks; the compiler writes the ones a file uses into it |
| [`schemas/common.v1.json`](schemas/common.v1.json) | Parameters and value expressions, shared by both schemas below |
| [`schemas/block-descriptor.v1.json`](schemas/block-descriptor.v1.json) | Block descriptors |
| [`schemas/decorator.v1.json`](schemas/decorator.v1.json) | The decorator library |
| [`schemas/bodies.v1.json`](schemas/bodies.v1.json) | The builder bodies |

`python/tests/test_blocks_contract.py` validates every file against the schemas and checks what JSON
Schema can't: every `{{placeholder}}` is a parameter and every parameter is used, bodies exist,
`outcome_step`/`name_param` point at something real, defaults match their type and options. It runs
in CI with the other backend tests (`npm run backend:test`).

Compiled policy targets **CFEngine 3.24 and later** (verified on 3.28). Nothing in the contract is
newer than 3.17 — `content` (3.16), `execresult()`'s output selector (3.17), `edit_template_string`
and `inline_mustache` (3.12) — so anything added should keep to 3.24's language.

Nothing is released yet, so the schemas stay at v1 and change in place. Once released, a change that
affects stored instances or compiled output bumps the block's `version` (migrations key on
`(id, version)`).

## Descriptors

- **`compile_target`** — `own_bundle`: a sequenced block, compiled to its own `bundle agent`, with
  outcomes and arrows. `file_vars`: its entries compile into the file's shared `bundle common vars`
  (Define Variable, Define Class) — not sequenced, no arrows.
- **`steps`** — ordered promises; each compiles to its own chained bundle, called in order. That's
  how a block controls ordering across promise types (CFEngine evaluates promise types within one
  bundle in a fixed order). Every built-in block has one step today.
- **`value_sources`** — instead of `steps`/`parameters`, for blocks whose promise depends on how the
  value is produced (Define Variable: literal, command output, file…; Define Class: check, combine,
  custom…). Each source has one step and its own parameters, on top of the shared ones. `value_type`
  (vars sources) is what it produces — the start of a decorator chain; `literal` marks typed-in
  values, which get no data chain.
- **`entries`** — one instance holds a list of definitions (several variables or classes), each
  with its own name (`name_param`), value source, parameters and optional condition.
- **`outcome_step`**, **`arrow_default_outcome`** — see "Outcomes and arrows" below.

## Compiled shape (per policy file)

```cfengine3
body file control { namespace => "<file namespace>"; }

bundle common vars                       # every file_vars entry of the file
{
  vars:    "<name>" <type> => <value>, if => <entry condition>;
  classes: "<name>" <attribute> => <value>;
}

bundle agent <entry bundle>              # called via cfbs; the file condition guards this call
{
  methods:
    "<label>" usebundle => <ns>:block_<instance>,
      inherit => "true",
      if => <block condition, and the arrows it waits for>,
      classes => default:results("bundle", "block_<instance>");   # only if an arrow starts here
}

bundle agent block_<instance> { <promise type>: "<promiser>" <attributes>; }
```

The compiled policy needs masterfiles' `lib/` (the stdlib) in its inputs. A body the stdlib lacks
comes from [`lib/bodies.json`](lib/bodies.json): the compiler writes each one a file uses into that
file, once, and references it with the file's namespace. There are two today — `mog_dirs` (the
stdlib's `mog()` sets `rxdirs => "false"` since 3.20, so a mode like `644` applied to a directory
tree makes its directories impossible to enter) and `remote_mount` (the stdlib's `nfs()` is NFS
only).

## Values

Every promiser and attribute value is an **expression**:

| Expression | Compiles to |
|---|---|
| `"text {{param}}"` | One quoted CFEngine string. The template's own text is written as-is; substituted values are escaped |
| `{"call": "readfile", "args": [...]}` | `readfile(...)` — arguments are expressions too |
| `{"body": "mog", "args": [...]}` | `default:mog(...)` (the stdlib); with `"lib": "builder"`, `<ns>:mog_dirs(...)`, the body written into the file from `lib/bodies.json` |
| `{"list": [...]}` | `{ "a", "b" }` |
| `{"list_param": "items"}` | `{ "a", "b" }` from a one-value-per-line parameter, blank lines dropped |
| `{"class_refs": true}` | The entry's picked classes, `{ "a", "!b" }` (Define Class's combine sources) |
| `{"class_expression": "{{condition}}"}` | Quoted when plain (`"linux.!debian"`), as-is when a function call (`not(fileexists("/x"))` — quoting it is a syntax error) |
| `{"bundle": "{{bundle_name}}"}` | A `usebundle` target, qualified with `default:` when it names no namespace |
| `{"variable": "{{param}}", "as": ...}` | A picked variable, always namespace-qualified: `scalar` → `"$(ns:vars.x)"`, `list` → `{ @(ns:vars.x) }`, `name` → `"ns:vars.x"` |
| `{"previous": "value"}` | Decorators only: the incoming value (see "Chains") |
| `{"if_set": "param", "value": ...}` | The attribute, or nothing when the parameter is empty (`report_to_file => ""` is a hard error) |

**Escaping.** CFEngine strings have exactly two escapes, `\\` and `\"`: every other backslash stays
literal, so regexes like `\d+` need no special handling, and a real newline can sit inside a string.
Substituted values are escaped with those two (`\` → `\\`, `"` → `\"`) and nothing else. `$(…)` is
left alone on purpose — it's how a value references a variable — so a literal `$(` is written
`$(const.dollar)(`. A promiser is always a template; the compiler quotes it.

**Parameters.** Values are stored as strings. `required` means non-empty. Numbers go into function
calls quoted (`"-2"` parses, a bare `-2` doesn't); `integer`/`minimum` are enforced in the editor.
`path: "absolute"` too — CFEngine rejects relative paths, `readfile()` and friends fatally. Options
are either plain strings or `{value, label, help}`. An `allow_list` parameter (one value per line) used
in a promiser makes the promise iterate: the compiler emits `vars: "<param>" slist => { … };` and
the promiser becomes `"$(<param>)"`.

**References.** Always namespace-qualified, even within the same file: in a namespaced file, `@(vars.x)`
stays literal text and `length("vars.x")` or `isvariable("vars.x")` don't resolve — only
`$(vars.x)` happens to work. Stdlib bodies and bundles need `default:` for the same reason.
`cf-promises` doesn't catch a missing prefix (nor a `usebundle` of a bundle that doesn't exist) — the
agent fails at run time instead — so compiled output should also go through `cfengine lint`.

Mustache templates (`render-template`) render against `datastate()`, so variables are
`{{{vars.<ns>:vars.<name>}}}` and classes `{{#classes.<ns>:<name>}}`. CFEngine expands `$(…)` in the
template text before Mustache sees it.

## Chains (decorators)

A Define Variable entry (or a data-fed parameter) can pass its value through decorators — grep, count,
join, … Each decorator's `expression` wraps the incoming value, which appears as
`{"previous": "value"}`, and chains **nest inline**:

```cfengine3
"workers" int => length(grep("processor.*", readstringlist("/proc/cpuinfo", "", "\n", "1000", "1048576")));
```

- A literal list arriving as a function argument is written as inline JSON (`'["a","b"]'`) — a
  `{ … }` literal can't be an argument; a list variable as its qualified name (`"ns:vars.x"`).
- The variable's type is the last step's `output_type` (or the source's `value_type` with no chain).
  `length` produces `int` — `string => length(…)` is a *fatal* error when the list couldn't be read
  (e.g. its file is missing), which takes the whole policy down. `data` can't be transformed.
- A **`fallback`** decorator (Default if empty) can't nest: a function over an undefined value never
  evaluates, so the fallback would never fire. The incoming value goes into an intermediate variable,
  then two promises:

  ```cfengine3
  "workers__in" int => length(...);
  "workers" string => "$(ns:vars.workers__in)",
    if => and(isvariable("ns:vars.workers__in"), not(strcmp("$(ns:vars.workers__in)", "0")));
  "workers" string => "auto", unless => isvariable("ns:vars.workers");
  ```

  Verified for all three cases: undefined → fallback, equal to the trigger → fallback, else the value.

## Classes

- Define Class entries live in `bundle common vars`, so they're namespace-scoped: other files use
  them as `ns:name`.
- `and => { }` is *true*: a combine source needs at least one class (the compiler refuses an empty
  one).
- A class named like a hard class (`linux`) is legal but still reads as the hard class — the editor
  should refuse it.
- **Caveat for entry conditions:** vars are evaluated before classes in each pass, so an entry
  `unless => "c"` where `c` is defined in the same bundle sees `c` as undefined on the first pass
  and the variable keeps its value. `if` converges correctly.

## Outcomes and arrows

An arrow means "run the target after the source, when its outcome is …". The compiler puts
`classes => default:results("bundle", "block_<source>")` on the source's `methods:` call and
`if => "block_<source>_repaired|…"` on the target's (several incoming arrows joined with `.` for
"All of these", `|` for "Any of these"). With `outcome_step`, the `results()` moves onto that step
instead, with `namespace` scope, since the gate is checked in the entry bundle.

A command's success counts as *repaired*, never *kept*, so `run-command` sets
`arrow_default_outcome: "repaired"` (as does `render-template`: "only if the file changed").

Blocks that act every time they run — Run Command, Signal Process, Report Message to a file — have a
"How often" option (`if_elapsed`). Manage Service's reload/restart run every time too; their help
points at a "repaired" arrow.

## Data-fed parameters

Any string parameter of an action block can take its value from a data chain ("Compute from data…"):
a Define Variable value source plus decorators, stored on the instance as `paramBindings[<param>]`.
It compiles to a hidden `vars:` promise `data_<instance>_<param>` in the block's own bundle, and the
parameter's value becomes `$(data_<instance>_<param>)` (a list iterates, as with `allow_list`).

## Conditions and inventory

A block instance, and each entry, can carry one **condition** (`if` or `unless` a class — see
`Condition` in `src/renderer/src/store/canvasSlice/types.ts`), compiled as `if =>`/`unless =>` on its
`methods:` call (a skipped bundle would still report "kept" if the condition sat inside it) and on an
entry's own promise; a file's condition guards its entry bundle's call. Several conditions on one
promise are combined with `and(…)`. There's deliberately one condition per thing: combining several
means defining a class with Define Class first.

A Define Variable entry's inventory tag compiles to `meta => { "inventory", "attribute_name=…" }`
(Enterprise; a no-op on Community).
