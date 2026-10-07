"""Policy Builder canvases -> CFEngine policy, one .cf per policy file.

The contract is blocks/README.md: descriptors (blocks/*.json), decorators and
builder bodies (blocks/lib/). Input is the project's .policy-builder/project.json;
output is {file path: contents} — each .cf, plus the template files its
blocks render (in ./templates/, one cfbs directory module). Targets CFEngine
3.27+: every file evaluates top-down, all of its blocks in its one entry
bundle. Each file is a namespace of its own: `<ns>:vars` and `<ns>:main`.
"""

from __future__ import annotations

import io
import json
import re
import sys
import textwrap
from dataclasses import dataclass, field, replace
from pathlib import Path

from cfengine_cli.format import format_policy_fin_fout

PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")
FUNCTION_CALL = re.compile(r"^\s*[A-Za-z_]\w*\s*\(")
# Arrow outcome -> the results() class suffix; all three together are "reached".
OUTCOME_SUFFIX = {"kept": "kept", "repaired": "repaired", "not_kept": "not_kept"}
# A Mustache tag: {{name}}, {{{name}}}, {{&name}}, {{#name}}, {{^name}}, {{/name}}, {{!comment}}.
MUSTACHE_TAG = re.compile(r"\{\{(\{?)\s*([#^/&!>]?)\s*(.*?)\s*\}?\}\}", re.S)
MUSTACHE_VAR = re.compile(r"vars\.((?:[A-Za-z_]\w*:)?[A-Za-z_]\w*)\.([A-Za-z_]\w*)(\..+)?")
MUSTACHE_CLASS = re.compile(r"classes\.((?:[A-Za-z_]\w*:)?[A-Za-z_]\w*)")
LINE_LENGTH = 80
# Where templates go: one directory module, so they ship whatever kind of module uses them.
TEMPLATES_DIR = "./templates/"


class CompileError(Exception):
    """The canvas can't be compiled (as opposed to one block being skipped)."""


class Skip(Exception):
    """One block (or entry) can't be compiled as filled in: it's skipped with this note."""


def blocks_dir() -> Path:
    # PyInstaller unpacks data files under sys._MEIPASS; in development it's the repo's blocks/.
    bundled = getattr(sys, "_MEIPASS", None)
    return Path(bundled, "blocks") if bundled else Path(__file__).resolve().parent.parent / "blocks"


@dataclass
class Library:
    descriptors: dict[str, dict]
    decorators: dict[str, dict]
    bodies: dict[str, dict]

    @classmethod
    def load(cls, directory: Path | None = None) -> Library:
        directory = directory or blocks_dir()
        descriptors = {}
        for path in sorted(directory.glob("*.json")):
            descriptor = json.loads(path.read_text(encoding="utf-8"))
            descriptors[descriptor["id"]] = descriptor
        decorators = json.loads((directory / "lib/decorators.json").read_text(encoding="utf-8"))["decorators"]
        bodies = json.loads((directory / "lib/bodies.json").read_text(encoding="utf-8"))["bodies"]
        return cls(descriptors, {d["id"]: d for d in decorators}, {b["name"]: b for b in bodies})


# --- values ---------------------------------------------------------------


def quote(text: str) -> str:
    """A CFEngine string. Only \\\\, \\" and \\' are escapes, so a backslash needs
    doubling only before a backslash, either quote, or the closing quote."""
    return '"' + re.sub(r"\\(?=[\\\"']|$)", r"\\\\", text).replace('"', '\\"') + '"'


# `key value` or `key=value` (or a bare key); keys hold no spaces, `=` or brackets.
KEY_VALUE = re.compile(r"^([^\s=\[\]]+)(?:\s*[=\s]\s*(.*?))?\s*$")
# The same for CFEngine's data_regextract(), on one unstripped line; a `#` line isn't one.
ARRAY_LINE = r"^\s*(?<key>[^\s=\[\]#][^\s=\[\]]*)\s*[=\s]?\s*(?<value>.*?)\s*$"


def lines_of(value: str) -> list[str]:
    return [line.strip() for line in value.splitlines() if line.strip()]


def cases_of(value: str) -> list[dict]:
    """A cases parameter's rows that have a condition (it's JSON; anything unreadable is no rows)."""
    try:
        rows = json.loads(value or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(rows, list):
        return []
    return [
        row
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("className"), str) and row["className"].strip()
    ]


def negated(expression: str) -> str:
    return f"!({expression})" if re.search(r"[|.&!()]", expression) else f"!{expression}"


def class_expression(condition: dict, local: set[str]) -> str:
    name = condition["className"].strip()
    # A file's condition is a `name::` guard: anything else in it would be policy.
    if not valid_class_expression(name):
        raise CompileError(f"{name!r} isn't a valid class expression")
    name = in_namespace(name, local)
    return negated(name) if condition.get("mode") == "unless" else name


def in_namespace(expression: str, local: set[str]) -> str:
    """A bare class the file doesn't define is the default namespace's (hard, augments or
    masterfiles classes), which a namespaced file only sees as `default:name`."""

    def qualified(match: re.Match) -> str:
        token = match.group()
        if not re.fullmatch(r"[A-Za-z_]\w*", token) or token in local or token == "any":
            return token
        return f"default:{token}"

    return CLASS_TOKEN.sub(qualified, expression)


def combined(expressions: list[str]) -> str:
    """Class expressions ANDed: "a.!b", parenthesised where they hold an OR."""
    parts = [f"({e})" if "|" in e and len(expressions) > 1 else e for e in expressions if e]
    return ".".join(parts)


VARIABLE_REF = r"[$@](?:\([\w.:\[\]]*\)|\{[\w.:\[\]]*\})"
CLASS_TOKEN = re.compile(rf"\|\||[|.&!()]|(?:[\w:]|{VARIABLE_REF})+")
CALL_TOKEN = re.compile(rf"""\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|{VARIABLE_REF}|[\w.:+-]+|[(),])""")


def valid_class_expression(text: str) -> bool:
    """Class names joined by . & | ||, negated with !, grouped in ( ); no spaces."""
    depth, operand = 0, False  # operand: the last token ends an operand
    for match in re.finditer(rf"{CLASS_TOKEN.pattern}|.", text, re.S):
        token = match.group()
        if token in ("!", "("):
            if operand:
                return False
            depth += token == "("
        elif token == ")":
            if not operand or not depth:
                return False
            depth -= 1
        elif token in ("|", "||", ".", "&"):
            if not operand:
                return False
            operand = False
            continue
        elif CLASS_TOKEN.fullmatch(token) and not operand:
            operand = True
            continue
        else:
            return False
        operand = token == ")"
    return operand and depth == 0


def valid_function_call(text: str) -> bool:
    """One call, `name(arg, …)`: arguments are calls, strings, variables or bare words."""
    tokens, at = [], 0
    while at < len(text.rstrip()):
        match = CALL_TOKEN.match(text, at)
        if not match:
            return False
        tokens.append(match.group(1))
        at = match.end()

    def call(i: int) -> int | None:
        if i + 1 >= len(tokens) or not re.fullmatch(r"[A-Za-z_]\w*", tokens[i]) or tokens[i + 1] != "(":
            return None
        i += 2
        if i < len(tokens) and tokens[i] == ")":
            return i + 1
        while i < len(tokens):
            i = call(i) or (i + 1 if tokens[i] not in ("(", ")", ",") else None)
            if i is None or i >= len(tokens) or tokens[i] not in (",", ")"):
                return None
            if tokens[i] == ")":
                return i + 1
            i += 1
        return None

    return call(0) == len(tokens)


@dataclass
class Context:
    """What an expression compiles against: one block's (or entry's) parameters."""

    # The file's `<ns>:vars`, which `vars.x` references mean.
    vars_bundle: str
    params: dict[str, str]
    bodies: set[str]
    class_refs: list[dict] = field(default_factory=list)
    previous: str | None = None
    # Chained values are function arguments: a list can't be a { } literal there.
    as_argument: bool = False
    # A block's own files in ./templates/ ({"template_file": …}), named after the block,
    # and the way from the policy file's folder there ("../" per folder it's nested in).
    block_name: str = ""
    files: dict[str, str] = field(default_factory=dict)
    to_root: str = ""
    # The block's locals: named `<prefix><name>` in bundle `owner`; expressions may add `vars:` lines.
    prefix: str = ""
    owner: str = ""
    locals: list[str] = field(default_factory=list)
    # Parameters computed from data -> their CFEngine type.
    computed: dict[str, str] = field(default_factory=dict)
    # Classes the file defines: everything else bare is `default:`.
    local_classes: set[str] = field(default_factory=set)

    def substitute(self, template: str) -> str:
        return PLACEHOLDER.sub(lambda match: self.params.get(match.group(1), ""), template)

    def qualified(self, name: str) -> str:
        return f"{self.vars_bundle}.{name[len('vars.'):]}" if name.startswith("vars.") else name


def compile_value(expr, ctx: Context) -> str:
    if isinstance(expr, str):
        return quote(ctx.substitute(expr))
    if "call" in expr:
        return f"{expr['call']}({', '.join(compile_value(arg, ctx) for arg in expr.get('args', []))})"
    if "body" in expr:
        name = expr["body"]
        if expr.get("lib") == "builder":
            ctx.bodies.add(name)
        else:
            name = f"default:{name}"
        args = expr.get("args")
        return f"{name}({', '.join(compile_value(arg, ctx) for arg in args)})" if args else name
    if "list" in expr:
        return list_value([compile_value(item, ctx) for item in expr["list"]], ctx)
    if "list_param" in expr:
        return list_value([quote(item) for item in lines_of(ctx.params.get(expr["list_param"], ""))], ctx)
    if "class_refs" in expr:
        refs = [
            ("!" if ref.get("negate") else "") + in_namespace(ref["name"], ctx.local_classes)
            for ref in ctx.class_refs
            if ref.get("name")
        ]
        return "{ " + ", ".join(quote(ref) for ref in refs) + " }"
    if "class_expression" in expr:
        text = ctx.substitute(expr["class_expression"]).strip()
        if FUNCTION_CALL.match(text):
            if valid_function_call(text):
                return text
        elif valid_class_expression(text):
            return quote(in_namespace(text, ctx.local_classes))
        raise Skip("not a valid class expression or function call")
    if "bundle" in expr:
        name = ctx.substitute(expr["bundle"])
        # The stdlib, or another module's: anything unqualified is in the default namespace.
        name = name if ":" in name else f"default:{name}"
        args = expr.get("args")
        return f"{name}({', '.join(compile_value(arg, ctx) for arg in args)})" if args else name
    if "variable" in expr:
        name = ctx.qualified(ctx.substitute(expr["variable"]))
        if not re.fullmatch(r"[\w.:\[\]]+", name, re.ASCII):
            raise Skip(f"{name!r} isn't a variable name")
        if expr["as"] == "scalar":
            return quote(f"$({name})")
        if expr["as"] == "list" and not ctx.as_argument:
            return f"{{ @({name}) }}"
        return quote(name)
    if "previous" in expr:
        if ctx.previous is None:
            raise CompileError("{previous} used outside a decorator")
        return ctx.previous
    if "if_set" in expr:
        return compile_value(expr["value"], ctx)
    if "choose" in expr:
        picked = ctx.params.get(expr["choose"], "")
        if picked not in expr["cases"]:
            raise CompileError(f"{expr['choose']}: {picked!r} isn't one of {', '.join(expr['cases'])}")
        return compile_value(expr["cases"][picked], ctx)
    if "cases_param" in expr:
        # ifelse(class, value, …, otherwise): the first row whose condition holds.
        args = []
        for row in cases_of(ctx.params.get(expr["cases_param"], "")):
            name = in_namespace(row["className"], ctx.local_classes)
            condition = negated(name) if row.get("mode") == "unless" else name
            args += [quote(condition), quote(row.get("value", ""))]
        otherwise = compile_value(expr["otherwise"], ctx)
        return f"ifelse({', '.join([*args, otherwise])})" if args else otherwise
    if "array_param" in expr:
        # One `key value` / `key=value` line per entry, as a local array; the qualified name is passed.
        local = f"{ctx.prefix}{expr['array_param']}"
        if expr["array_param"] in ctx.computed:
            return computed_array(expr["array_param"], ctx)
        for line in lines_of(ctx.params.get(expr["array_param"], "")):
            match = KEY_VALUE.match(line)
            if match and not line.startswith("#"):
                key, value = match.group(1), match.group(2) or ""
                ctx.locals.append(f"{quote(f'{local}[{key}]')} string => {quote(value)};")
        return quote(f"{ctx.owner}.{local}")
    if "template_file" in expr:
        # Relative to the policy file, so it resolves the same in the project and on hosts.
        name = f"{ctx.block_name}.mustache"
        ctx.files[name] = ctx.params.get(expr["template_file"], "")
        return quote(f"$(this.promise_dirname)/{ctx.to_root}{TEMPLATES_DIR[2:]}{name}")
    raise CompileError(f"Unknown expression: {json.dumps(expr)}")


def computed_array(param: str, ctx: Context) -> str:
    """array_param computed from data: its lines are only known at run time, so they're split
    into `<local>__array` there, as KEY_VALUE (and the # comment check) would."""
    local = f"{ctx.prefix}{param}"
    if ctx.computed[param] not in ("slist", "data"):
        rows = f'mergedata(string_split({quote(f"$({local})")}, "\\n", "100000"))'
    else:
        rows = f"mergedata({quote(f'{ctx.owner}.{local}')})"
    index, match = f"$({local}__i)", f"{local}__kv_$({local}__i)"
    ctx.locals += [
        f'"{local}__rows" data => {rows};',
        f'"{local}__i" slist => getindices("{local}__rows");',
        f'"{match}" data => data_regextract({quote(ARRAY_LINE)}, "$({local}__rows[{index}])");',
        f'"{local}__array[$({match}[key])]" string => "$({match}[value])";',
    ]
    return quote(f"{ctx.owner}.{local}__array")


def list_value(items: list[str], ctx: Context) -> str:
    if not ctx.as_argument:
        return "{ " + ", ".join(items) + " }"
    # A literal list as a function argument goes in as inline JSON, in a single-quoted string.
    text = json.dumps([unquote(item) if item.startswith('"') else item for item in items], ensure_ascii=False)
    return "'" + re.sub(r"\\(?=[\\\"']|$)", r"\\\\", text).replace("'", "\\'") + "'"


def unquote(string: str) -> str:
    """quote()'s inverse: the text of a CFEngine string."""
    return re.sub(r"\\([\\\"'])", r"\1", string[1:-1])


def attributes_of(step: dict, ctx: Context) -> list[str]:
    lines = []
    for key, value in step.get("attributes", {}).items():
        if isinstance(value, dict) and "if_set" in value and not ctx.params.get(value["if_set"], "").strip():
            continue
        lines.append(f"{key} => {compile_value(value, ctx)}")
    return lines


def promise(promiser: str, attributes: list[str], comment: str | None = None) -> list[str]:
    lines = [f"# {comment}"] if comment else []
    if not attributes:
        return [*lines, f"{promiser};"]
    return [*lines, promiser, *[f"  {line}," for line in attributes[:-1]], f"  {attributes[-1]};"]


# --- parameters -----------------------------------------------------------


def params_with_defaults(declared: list[dict], given: dict) -> dict[str, str]:
    params = {}
    for param in declared:
        value = given.get(param["name"])
        # Empty means "not set" — unless it's one of the options (Run Command's "Every agent run").
        empty_option = any(isinstance(o, dict) and o.get("value") == "" or o == "" for o in param.get("options", []))
        if value is None or (value == "" and not empty_option):
            value = param.get("default")
        # CFEngine booleans are "true"/"false"; Python's str() would give "True".
        params[param["name"]] = "" if value is None else str(value).lower() if isinstance(value, bool) else str(value)
    return params


def invalid_values(declared: list[dict], params: dict[str, str]) -> list[str]:
    """Parameters holding characters their allowed_chars rule out (names: bundles, variables, classes…)."""
    return [
        param.get("label", param["name"])
        for param in declared
        if param.get("allowed_chars") and not re.fullmatch(f"[{param['allowed_chars']}]*", params[param["name"]])
    ]


def entry_source(descriptor: dict, entry: dict) -> dict:
    sources = {s["id"]: s for s in descriptor.get("value_sources", [])}
    return sources.get(entry.get("valueSourceId")) or next(iter(sources.values()))


def missing_required(declared: list[dict], params: dict[str, str]) -> list[str]:
    return [
        param.get("label", param["name"])
        for param in declared
        if param.get("required") and not params[param["name"]].strip()
    ]


SUMMARY_VALUE_LENGTH = 60


def fill_summary(pattern: str, params: dict[str, str]) -> str:
    """A summary pattern with its parameters in, fit for a one-line comment."""

    def shown(match: re.Match) -> str:
        value = params.get(match.group(1), "").replace("\r", "").replace("\n", "\\n")
        return value if len(value) <= SUMMARY_VALUE_LENGTH else value[: SUMMARY_VALUE_LENGTH - 1] + "…"

    return PLACEHOLDER.sub(shown, pattern)


def one_line(text: str) -> str:
    """Text for a `# …` comment: a line break would end it, and the rest would be policy."""
    return " ".join(text.split())


def canonical(name: str) -> str:
    return re.sub(r"\W", "_", name)


def slug(label: str) -> str:
    name = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "block"
    return f"block_{name}" if name[0].isdigit() else name


# --- one file ---------------------------------------------------------------


@dataclass
class TemplateRefs:
    """What a Mustache template reads: variables (as (ns:bundle, name)) and classes."""

    variables: list[tuple[str, str]]
    classes: list[str]


def template_refs(template: str) -> TemplateRefs | None:
    """The template's datastate() references, or None when it uses anything else
    (then it keeps rendering against datastate())."""
    variables, classes, sections = [], [], []
    for _brace, kind, name in MUSTACHE_TAG.findall(template):
        if kind in ("!", ">"):
            continue
        in_list = any(section.startswith("vars.") for section in sections)
        if kind == "/":
            if sections and sections[-1] == name:
                sections.pop()
            continue
        variable, cls = MUSTACHE_VAR.fullmatch(name), MUSTACHE_CLASS.fullmatch(name)
        if variable:
            ref = (variable.group(1), variable.group(2))
            if ref not in variables:
                variables.append(ref)
        elif cls:
            if cls.group(1) not in classes:
                classes.append(cls.group(1))
        elif not in_list:
            return None
        if kind in ("#", "^"):
            sections.append(name)
    return TemplateRefs(variables, classes)


@dataclass
class FileCompiler:
    library: Library
    file: dict
    # "<ns>:vars.name" -> its CFEngine type, for every variable the project defines.
    types: dict[str, str] = field(default_factory=dict)
    # Names taken in the file's namespace; grows as blocks and groups are named.
    taken: set[str] = field(default_factory=lambda: {"main", "vars"})
    bodies: set[str] = field(default_factory=set)
    local_classes: set[str] = field(default_factory=set)
    # The file's templates, by name in ./templates/.
    companions: dict[str, str] = field(default_factory=dict)
    # (block or group id, its `# ...` comment) in output order, for source_map.
    chunks: list[tuple[str, str]] = field(default_factory=list)
    # Block or group id -> its [first, last] line ranges (1-based) in the compiled file.
    source_map: dict[str, list[list[int]]] = field(default_factory=dict)

    @property
    def ns(self) -> str:
        return self.file["namespace"]

    @property
    def vars_name(self) -> str:
        return f"{self.ns}:vars"

    def compile(self) -> str:
        blocks = self.file.get("blocks") or []
        self.local_classes = defined_classes(self.file, self.library)
        definitions = [b for b in blocks if self.descriptor(b).get("compile_target") == "file_vars"]
        sequenced = self.sequenced_blocks(blocks)
        names = self.block_names(sequenced)
        groups = self.groups_of(sequenced)
        names.update(self.group_names(groups))

        sections = [self.header()]
        # Promises run in the order written, not by promise type (CFEngine 3.27+): canvas order.
        sections.append(f'body file control\n{{\n  namespace => "{self.ns}";\n  evaluation_order => "top_down";\n}}')
        vars_bundle = self.vars_bundle(definitions)
        if vars_bundle:
            sections.append(vars_bundle)
        # Only variables and classes: nothing to call, so no entry bundle (and no `bundles` step).
        if sequenced:
            sections.append(self.entry_bundle(sequenced, names, groups))
            sections.extend(self.group_bundle(group, sequenced, names) for group in groups.values())
        sections.extend(self.builder_body(name) for name in sorted(self.bodies))
        policy = format_policy("\n\n".join(sections) + "\n")
        self.source_map = locate_chunks(policy, self.chunks)
        return policy

    def header(self) -> str:
        """The masterfiles-style banner: the file's description, then that it's generated."""
        rule = "#" * 79
        lines = [rule, "#"]
        description = (self.file.get("description") or "").strip()
        if description:
            for paragraph in description.split("\n"):
                wrapped = textwrap.wrap(paragraph, 77)
                lines += [f"# {line}" for line in wrapped] or ["#"]
            lines.append("#")
        name = self.file.get("name", self.ns)
        lines += [
            f'# Generated by CFEngine Policy Builder from "{name}".',
            "# Edits here are overwritten when the project is saved.",
            "#",
            rule,
        ]
        return "\n".join(lines)

    def descriptor(self, block: dict) -> dict:
        descriptor = self.library.descriptors.get(block.get("blockId"))
        if descriptor is None:
            raise CompileError(f"Unknown block type {block.get('blockId')!r} in {self.file.get('name')}")
        return descriptor

    def sequenced_blocks(self, blocks: list[dict]) -> list[dict]:
        own = {b["instanceId"]: b for b in blocks if self.descriptor(b).get("compile_target") == "own_bundle"}
        order = [own[i] for i in self.file.get("order") or [] if i in own]
        return order + [b for b in own.values() if b not in order]

    def block_names(self, blocks: list[dict]) -> dict[str, str]:
        """The label slugged, e.g. render_nginx_config, unique in the file (_2, _3…):
        what a block's results() classes, locals and template file are named after."""
        names = {}
        for block in blocks:
            base = slug(block.get("label") or self.descriptor(block)["name"])
            name, suffix = base, 2
            while name in self.taken:
                name, suffix = f"{base}_{suffix}", suffix + 1
            self.taken.add(name)
            names[block["instanceId"]] = name
        return names

    def groups_of(self, blocks: list[dict]) -> dict[str, dict]:
        """The groups holding at least one of `blocks`, in the order they first run."""
        known = {}
        layout = (self.file.get("layout") or {}).get("groups") or []
        for group in [*layout, *(self.file.get("groups") or [])]:
            if isinstance(group, dict) and isinstance(group.get("id"), str):
                known[group["id"]] = {**known.get(group["id"], {}), **group}
        groups = {}
        for block in blocks:
            group = known.get(block.get("groupId"))
            if group and group["id"] not in groups:
                groups[group["id"]] = group
        return groups

    def group_names(self, groups: dict[str, dict]) -> dict[str, str]:
        """The group's bundle, named after it, and what its call's results() classes are named after."""
        names = {}
        for group in groups.values():
            base = slug(group.get("name") or "group")
            name, suffix = base, 2
            while name in self.taken:
                name, suffix = f"{base}_{suffix}", suffix + 1
            self.taken.add(name)
            names[group["id"]] = name
        return names

    def file_guard(self) -> str | None:
        condition = self.file.get("condition")
        return (
            class_expression(condition, self.local_classes)
            if condition and condition.get("className", "").strip()
            else None
        )

    # bundle common vars: every Define Variable / Define Class entry.
    def vars_bundle(self, blocks: list[dict]) -> str | None:
        sections: dict[str, list[str]] = {"vars": [], "classes": []}
        chunks: dict[str, list[tuple[str, str]]] = {kind: [] for kind in sections}
        for block in blocks:
            descriptor = self.descriptor(block)
            first = {kind: True for kind in sections}
            for entry in block.get("entries") or []:
                kind, lines = self.entry_promises(block, descriptor, entry)
                if first[kind]:
                    label = one_line(block.get("label") or descriptor["name"])
                    lines = [f"# {label}", *lines]
                    chunks[kind].append((block["instanceId"], label))
                    first[kind] = False
                sections[kind].extend(lines)
        self.chunks += [*chunks["vars"], *chunks["classes"]]
        if not any(sections.values()):
            return None
        guard = self.file_guard()
        body = []
        for kind, lines in sections.items():
            if lines:
                body += [f"  {kind}:", *([f"    {guard}::"] if guard else []), *[f"      {line}" for line in lines]]
        return "bundle common vars\n{\n" + "\n".join(body) + "\n}"

    def entry_promises(self, block: dict, descriptor: dict, entry: dict) -> tuple[str, list[str]]:
        try:
            return self.entry_lines(block, descriptor, entry)
        except Skip as skip:
            name = (entry.get("params") or {}).get(descriptor["entries"]["name_param"], "")
            return entry_source(descriptor, entry)["steps"][0]["promise_type"], [f"# Skipped {one_line(name)}: {skip}."]

    def entry_lines(self, block: dict, descriptor: dict, entry: dict) -> tuple[str, list[str]]:
        source = entry_source(descriptor, entry)
        declared = [*descriptor.get("parameters", []), *source.get("parameters", [])]
        params = params_with_defaults(declared, entry.get("params") or {})
        step = source["steps"][0]
        kind = step["promise_type"]
        name = params[descriptor["entries"]["name_param"]]
        missing = missing_required(declared, params)
        if missing:
            return kind, [f"# Skipped: {', '.join(missing)} not set."]
        invalid = invalid_values(declared, params)
        if invalid:
            raise Skip(f"{', '.join(invalid)} not valid")

        conditions = [
            class_expression(c, self.local_classes)
            for c in (block.get("condition"), entry.get("condition"))
            if c and c.get("className", "").strip()
        ]
        # Every component (cf-promises, cf-serverd…) evaluates a common bundle: commands run in cf-agent only.
        if runs_command(step):
            conditions.insert(0, "agent")
        ctx = Context(
            self.vars_name,
            params,
            self.bodies,
            class_refs=entry.get("classRefs") or [],
            local_classes=self.local_classes,
        )
        extra = []
        if entry.get("inventory", {}).get("attributeName", "").strip():
            extra.append(
                f'meta => {{ "inventory", {quote("attribute_name=" + entry["inventory"]["attributeName"].strip())} }}'
            )

        if kind != "vars":
            return kind, promise(
                quote(ctx.substitute(step["promiser"])), [*attributes_of(step, ctx), *condition_attributes(conditions)]
            )

        [(value_type, value)] = step["attributes"].items()
        decorators = [d for d in entry.get("decorators") or [] if d.get("decoratorId") in self.library.decorators]
        if not decorators:
            return kind, promise(
                quote(name), [f"{value_type} => {compile_value(value, ctx)}", *extra, *condition_attributes(conditions)]
            )
        return kind, self.chain(name, self.vars_name, source, value, decorators, ctx, conditions, extra)

    def chain(
        self,
        name: str,
        owner: str,
        source: dict,
        value,
        decorators: list[dict],
        ctx: Context,
        conditions: list[str],
        extra: list[str],
    ):
        """A value source through its decorators, as `vars:` promises for `name` in
        bundle `owner`, explained step by step in a comment above them. A chain
        nests inline; a fallback (Default if empty) can't, so it splits into an
        intermediate variable and two promises."""
        explained = self.explain(source, ctx.params, decorators)
        return [*explained, *self.chain_promises(name, owner, source, value, decorators, ctx, conditions, extra)]

    def explain(self, source: dict, params: dict[str, str], decorators: list[dict]) -> list[str]:
        """`# The stdout of "/usr/bin/x"` / `# → sort (lex)`: each step's summary pattern, filled in."""
        steps = [fill_summary(source.get("summary") or source["label"], params)]
        for instance in decorators:
            decorator = self.library.decorators[instance["decoratorId"]]
            decorator_params = params_with_defaults(decorator.get("parameters", []), instance.get("params") or {})
            steps.append(f"→ {fill_summary(decorator.get('summary') or decorator['label'], decorator_params)}")
        return [f"# {step}" for step in steps]

    def chain_promises(
        self,
        name: str,
        owner: str,
        source: dict,
        value,
        decorators: list[dict],
        ctx: Context,
        conditions: list[str],
        extra: list[str],
    ) -> list[str]:
        value_type = source.get("value_type", "string")
        # Chained values are function arguments, where lists are written differently.
        expression = compile_value(
            value,
            Context(
                ctx.vars_bundle,
                ctx.params,
                ctx.bodies,
                ctx.class_refs,
                as_argument=bool(decorators),
                local_classes=ctx.local_classes,
            ),
        )
        lines = []
        for index, instance in enumerate(decorators):
            decorator = self.library.decorators[instance["decoratorId"]]
            params = params_with_defaults(decorator.get("parameters", []), instance.get("params") or {})
            step_ctx = Context(ctx.vars_bundle, params, ctx.bodies, previous=expression, as_argument=True)
            if "fallback" not in decorator:
                expression, value_type = compile_value(decorator["expression"], step_ctx), decorator["output_type"]
                continue
            if index != len(decorators) - 1:
                raise CompileError(f'"{decorator["label"]}" has to be the last step of {name}')
            intermediate = f"{owner}.{name}__in"
            trigger = step_ctx.substitute(decorator["fallback"]["trigger"])
            usable = (
                f'and(isvariable({quote(intermediate)}), not(strcmp({quote(f"$({intermediate})")}, {quote(trigger)})))'
            )
            fallback = quote(step_ctx.substitute(decorator["fallback"]["value"]))
            lines += promise(quote(f"{name}__in"), [f"{value_type} => {expression}", *condition_attributes(conditions)])
            lines += promise(
                quote(name),
                [
                    f'{decorator["output_type"]} => {quote(f"$({intermediate})")}',
                    *extra,
                    *if_all([*conditions, usable]),
                ],
            )
            unset = f'not(isvariable({quote(f"{owner}.{name}")}))'
            lines += promise(
                quote(name), [f'{decorator["output_type"]} => {fallback}', *extra, *if_all([*conditions, unset])]
            )
            return lines
        return promise(quote(name), [f"{value_type} => {expression}", *extra, *condition_attributes(conditions)])

    def gating(self, node: dict, names: dict[str, str], edges: list[dict]) -> list[str]:
        """What runs a block's (or group's) promise: its condition and the arrows it waits for (`if`),
        and the `results()` classes its own outgoing arrows read. `edges`: the arrows in its bundle."""
        gate = self.arrow_gate(node, edges, names)
        condition = node.get("condition")
        expressions = (
            [class_expression(condition, self.local_classes)]
            if condition and condition.get("className", "").strip()
            else []
        )
        expression = combined([*expressions, *([gate] if gate else [])])
        attributes = [f"if => {quote(expression)}"] if expression else []
        if any(edge["source"] == node["instanceId"] for edge in edges):
            attributes.append(f'classes => default:results("bundle", "{names[node["instanceId"]]}")')
        return attributes

    def scoped_edges(self, ids: set[str]) -> list[dict]:
        """The arrows between `ids`: a bundle's results() classes are only seen inside it."""
        return [edge for edge in self.file.get("edges") or [] if edge["source"] in ids and edge["target"] in ids]

    def block_lines(self, block: dict, names: dict[str, str], edges: list[dict], owner: str, guarded: list[str]):
        name = names[block["instanceId"]]
        label = one_line(block.get("label") or self.descriptor(block)["name"])
        # Locals are prefixed with the block's own name: blocks share a bundle.
        try:
            parts = self.block_parts(block, name, prefix=f"{name}_", owner=owner)
        except Skip as skip:
            parts = f'Skipped "{label}": {skip}.'
        if isinstance(parts, str):
            self.chunks.append((block["instanceId"], parts))
            return [f"  # {parts}", ""]
        variables, promise_type, promiser, attributes = parts
        self.chunks.append((block["instanceId"], label))
        body = [f"  # {label}"]
        if variables:
            body += ["  vars:", *guarded, *[f"      {line}" for line in variables]]
        lines = promise(promiser, [*attributes, *self.gating(block, names, edges)])
        return [*body, f"  {promise_type}:", *guarded, *[f"      {line}" for line in lines], ""]

    # bundle agent main: every ungrouped block's own promise and every group's call, in order (top_down).
    def entry_bundle(self, blocks: list[dict], names: dict[str, str], groups: dict[str, dict]) -> str:
        guard = self.file_guard()
        guarded = [f"    {guard}::"] if guard else []
        outer = [b for b in blocks if b.get("groupId") not in groups]
        edges = self.scoped_edges({b["instanceId"] for b in outer} | set(groups))
        body, called = [], set()
        for block in blocks:
            group = groups.get(block.get("groupId"))
            if group is None:
                body += self.block_lines(block, names, edges, f"{self.ns}:main", guarded)
            elif group["id"] not in called:
                called.add(group["id"])
                node = {**group, "instanceId": group["id"]}
                lines = promise(
                    quote(group.get("name") or "group"),
                    [f"usebundle => {names[group['id']]}", *self.gating(node, names, edges)],
                )
                self.chunks.append((group["id"], f"Group: {one_line(group.get('name') or 'group')}"))
                body += [f"  # Group: {one_line(group.get('name') or 'group')}", "  methods:", *guarded]
                body += [*[f"      {line}" for line in lines], ""]
        return "bundle agent main\n{\n" + "\n".join(body).rstrip() + "\n}"

    # bundle agent <group>: a group's blocks, called from the entry bundle as one step.
    def group_bundle(self, group: dict, blocks: list[dict], names: dict[str, str]) -> str:
        name = names[group["id"]]
        members = [b for b in blocks if b.get("groupId") == group["id"]]
        edges = self.scoped_edges({b["instanceId"] for b in members})
        comment = f'# Group "{one_line(group.get("name") or "group")}", run as one step of main.'
        self.chunks.append((group["id"], comment[2:]))
        body = [line for block in members for line in self.block_lines(block, names, edges, f"{self.ns}:{name}", [])]
        return f"{comment}\nbundle agent {name}\n{{\n" + "\n".join(body).rstrip() + "\n}"

    def arrow_gate(self, node: dict, edges: list[dict], names: dict[str, str]) -> str | None:
        incoming = [edge for edge in edges if edge["target"] == node["instanceId"] and edge["source"] in names]
        if not incoming:
            return None
        gates = []
        for edge in incoming:
            prefix = names[edge["source"]]
            outcomes = [o for o in OUTCOME_SUFFIX if o in edge.get("outcomes", [])] or ["kept", "repaired"]
            if len(outcomes) == len(OUTCOME_SUFFIX):
                gates.append(f"{prefix}_reached")
            else:
                classes = "|".join(f"{prefix}_{OUTCOME_SUFFIX[o]}" for o in outcomes)
                gates.append(f"({classes})" if len(outcomes) > 1 and len(incoming) > 1 else classes)
        return ("|" if node.get("incomingMode") == "any" else ".").join(gates)

    def block_parts(
        self, block: dict, name: str, prefix: str, owner: str
    ) -> tuple[list[str], str, str, list[str]] | str:
        """A block's local variables, promise type, promiser and attributes — or why it's skipped.
        Locals are named `<prefix><param>` in bundle `owner` (namespace-qualified)."""
        descriptor = self.descriptor(block)
        declared = descriptor.get("parameters", [])
        params = params_with_defaults(declared, block.get("params") or {})
        label = one_line(block.get("label") or descriptor["name"])
        bound = set(block.get("paramBindings") or {})
        computed, missing_data = self.computed_parameters(block, owner, prefix)
        missing = [*missing_required([p for p in declared if p["name"] not in bound], params), *missing_data]
        if missing:
            return f"Skipped \"{label}\": {', '.join(missing)} not set."
        invalid = invalid_values([p for p in declared if p["name"] not in bound], params)
        if invalid:
            return f"Skipped \"{label}\": {', '.join(invalid)} not valid."
        # A parameter computed from data reads the local variable holding it (a list iterates).
        params.update({param: f"$({prefix}{param})" for param in computed})
        steps = descriptor.get("steps", [])
        if len(steps) != 1:
            raise CompileError(f"{descriptor['name']}: only one-step blocks compile so far")
        step = inline_computed_template(steps[0], computed)
        to_root = "../" * self.file["path"][2:].count("/")
        ctx = Context(
            self.vars_name,
            params,
            self.bodies,
            # Templates share ./templates/: their names carry the namespace.
            block_name=f"{self.ns}_{name}",
            files=self.companions,
            to_root=to_root,
            prefix=prefix,
            owner=owner,
            computed={param: kind for param, (_lines, kind) in computed.items()},
            local_classes=self.local_classes,
        )
        # A one-value-per-line parameter in the promiser iterates over a list, unless it holds one value.
        variables, promiser_params = [line for lines, _kind in computed.values() for line in lines], dict(params)
        for param in declared:
            values = (
                lines_of(params[param["name"]]) if param.get("allow_list") and param["name"] not in computed else []
            )
            if f"{{{{{param['name']}}}}}" not in step["promiser"] or not values:
                continue
            if len(values) == 1:
                promiser_params[param["name"]] = values[0]
                continue
            local = f"{prefix}{param['name']}"
            variables.append(f'"{local}" slist => {{ {", ".join(quote(v) for v in values)} }};')
            promiser_params[param["name"]] = f"$({local})"
        promiser = Context(self.vars_name, promiser_params, self.bodies).substitute(step["promiser"])
        # The promise iterates as a whole: its attributes see the same list variable.
        ctx.params = promiser_params
        attributes = attributes_of(step, ctx)
        variables += ctx.locals
        # A computed template is only known at run time: it renders against datastate().
        template_bound = any(p.get("mustache") and p["name"] in computed for p in declared)
        template_data = None if template_bound else self.template_data(step, declared, params, prefix)
        if template_data:
            variables += template_data
            attributes.append(f"template_data => @({prefix}template_data)")
        return variables, step["promise_type"], quote(promiser), attributes

    def computed_parameters(
        self, block: dict, bundle: str, prefix: str = ""
    ) -> tuple[dict[str, tuple[list[str], str]], list[str]]:
        """Parameters computed from data ("Compute from data…"): a Define Variable value
        source and its decorators, as `vars:` promises named after the parameter in the
        block's own bundle. Returns them with their type, and the labels of any that aren't filled in."""
        definitions = self.library.descriptors.get("define-variable", {})
        sources = {source["id"]: source for source in definitions.get("value_sources", [])}
        labels = {p["name"]: p.get("label", p["name"]) for p in self.descriptor(block).get("parameters", [])}
        computed, missing = {}, []
        for param, binding in (block.get("paramBindings") or {}).items():
            source = sources.get(binding.get("valueSourceId"))
            if source is None or param not in labels:
                raise CompileError(
                    f"{block.get('label')}: can't compute {param!r} from {binding.get('valueSourceId')!r}"
                )
            params = params_with_defaults(source.get("parameters", []), binding.get("params") or {})
            unset = missing_required(source.get("parameters", []), params)
            if unset:
                missing.append(f"{labels[param]} ({', '.join(unset)})")
                continue
            [(_kind, value)] = source["steps"][0]["attributes"].items()
            decorators = [d for d in binding.get("decorators") or [] if d.get("decoratorId") in self.library.decorators]
            ctx = Context(self.vars_name, params, self.bodies, local_classes=self.local_classes)
            lines = self.chain(f"{prefix}{param}", bundle, source, value, decorators, ctx, [], [])
            computed[param] = lines, chain_type(source, decorators, self.library)
        return computed, missing

    def template_data(
        self, step: dict, declared: list[dict], params: dict[str, str], prefix: str = ""
    ) -> list[str] | None:
        """Just what an inline Mustache template reads, instead of all of datastate():
        local copies of its variables wrapped by mergedata() (safe for any value), and
        its classes as true/false. Same shape as datastate(), so the template is unchanged."""
        if step.get("attributes", {}).get("template_method") not in ("mustache", "inline_mustache"):
            return None
        template = next((params[p["name"]] for p in declared if p.get("mustache")), None)
        refs = template_refs(template) if template is not None else None
        # Only the project's own variables, whose types are known; anything else reads datastate().
        if refs is None or any(f"{bundle}.{name}" not in self.types for bundle, name in refs.variables):
            return None
        names = [name for _bundle, name in refs.variables]
        # `tpl_`: apart from the block's other locals, which are named after its parameters.
        local = {
            ref: f"{prefix}tpl_" + (ref[1] if names.count(ref[1]) == 1 else canonical(f"{ref[0]}_{ref[1]}"))
            for ref in refs.variables
        }
        lines, bundles = [], {}
        for (bundle, name), copy in local.items():
            qualified = f"{bundle}.{name}"
            kind = self.types[qualified]
            # Unset (its condition is false): no copy, so it's left out, as in datastate().
            defined = f"if => isvariable({quote(qualified)})"
            if kind == "slist":
                lines += promise(quote(copy), [f"slist => {{ @({qualified}) }}", defined])
            elif kind == "data":
                lines += promise(quote(copy), [f"data => mergedata({quote(qualified)})", defined])
            else:
                lines += promise(quote(copy), [f"string => {quote(f'$({qualified})')}", defined])
            bundles.setdefault(bundle, []).append(f'"{name}": {copy}')
        parts = []
        if bundles:
            inner = ", ".join(f'"{bundle}": {{ {", ".join(items)} }}' for bundle, items in bundles.items())
            parts.append(f"'{{ \"vars\": {{ {inner} }} }}'")
        if refs.classes:
            json_classes = ", ".join(f'"{cls}": %s' for cls in refs.classes)
            flags = ", ".join(
                f'ifelse({quote(in_namespace(cls, self.local_classes))}, "true", "false")' for cls in refs.classes
            )
            parts.append(f"parsejson(format('{{ \"classes\": {{ {json_classes} }} }}', {flags}))")
        if not parts:
            data = "mergedata('{}')"
        elif bundles:
            data = f"mergedata({', '.join(parts)})"
        else:
            data = parts[0]
        name = f'"{prefix}template_data"'
        if not refs.variables:
            return [*lines, *promise(name, [f"data => {data}"])]
        # With any of them unset, datastate() (inline JSON naming an unset variable is no data at all).
        isset = [f"isvariable({quote(f'{bundle}.{variable}')})" for bundle, variable in refs.variables]
        fallback = f"unless => isvariable({quote(f'{prefix}template_data')})"
        return [
            *lines,
            *promise(name, [f"data => {data}", *if_all(isset)]),
            *promise(name, ["data => datastate()", fallback]),
        ]

    def builder_body(self, name: str) -> str:
        body = self.library.bodies[name]
        ctx = Context(self.vars_name, {}, set())
        attributes = "\n".join(f"  {key} => {compile_value(value, ctx)};" for key, value in body["attributes"].items())
        return f"body {body['type']} {name}({', '.join(body['parameters'])})\n{{\n{attributes}\n}}"


COMMAND_FUNCTIONS = {"execresult", "execresult_as_data", "returnszero"}


def runs_command(expr) -> bool:
    if isinstance(expr, dict):
        return expr.get("call") in COMMAND_FUNCTIONS or any(runs_command(value) for value in expr.values())
    return isinstance(expr, list) and any(runs_command(item) for item in expr)


def inline_computed_template(step: dict, computed: dict) -> dict:
    """A template file whose text is computed from data can't be written out: the step renders
    the variable instead, as an inline_mustache edit_template_string."""
    attributes = {}
    for key, value in step.get("attributes", {}).items():
        if isinstance(value, dict) and value.get("template_file") in computed:
            attributes["edit_template_string"] = f"{{{{{value['template_file']}}}}}"
            attributes["template_method"] = "inline_mustache"
        elif key != "template_method" or "template_method" not in attributes:
            attributes[key] = value
    return {**step, "attributes": attributes}


def condition_attributes(conditions: list[str]) -> list[str]:
    expression = combined(conditions)
    return [f"if => {quote(expression)}"] if expression else []


def if_all(expressions: list[str]) -> list[str]:
    """`if => and(...)` over class expressions and function calls."""
    parts = [e if FUNCTION_CALL.match(e) else quote(e) for e in expressions]
    return [f"if => {parts[0] if len(parts) == 1 else 'and(' + ', '.join(parts) + ')'}"]


def format_policy(text: str) -> str:
    out = io.StringIO()
    format_policy_fin_fout(io.StringIO(text), out, LINE_LENGTH, False)
    return out.getvalue()


def locate_chunks(policy: str, chunks: list[tuple[str, str]]) -> dict[str, list[list[int]]]:
    """Where each chunk landed after formatting: from its comment to the next chunk's (or its
    bundle's end), without trailing blank lines or bare section headers. 1-based, inclusive."""
    lines = policy.splitlines()
    starts, at = [], 0
    for owner, text in chunks:
        found = next((i for i in range(at, len(lines)) if lines[i].strip() == f"# {text}"), None)
        if found is not None:
            starts.append((owner, found))
            at = found + 1
    ranges: dict[str, list[list[int]]] = {}
    for index, (owner, start) in enumerate(starts):
        close = next((i for i in range(start + 1, len(lines)) if lines[i] == "}"), len(lines) - 1)
        # A comment above a bundle covers the whole bundle, blocks and all.
        top_level = not lines[start].startswith(" ")
        end = close if top_level else close - 1
        if index + 1 < len(starts) and not top_level:
            end = min(end, starts[index + 1][1] - 1)
        while end > start and (not lines[end].strip() or re.fullmatch(r"\s+[a-z_]+:", lines[end])):
            end -= 1
        ranges.setdefault(owner, []).append([start + 1, end + 1])
    return ranges


def compile_project(meta: dict, library: Library | None = None, source_map: dict | None = None) -> dict[str, str]:
    """.policy-builder/project.json -> {path: contents}, every .cf and its templates.
    `source_map`, if given, gets {policy path: {block or group id: [[first, last], ...]}}."""
    files = compile_files(meta, library, source_map)
    return {path: text for files in files.values() for path, text in files.items()}


def compile_files(
    meta: dict, library: Library | None = None, source_map: dict | None = None
) -> dict[str, dict[str, str]]:
    """.policy-builder/project.json -> {policy path: {path: contents}}: each .cf first, then its templates."""
    library = library or Library.load()
    files = meta.get("files")
    if not isinstance(files, list):
        raise CompileError('"files" must be a list')
    # Projects saved before files had namespaces again name it `bundle`.
    files = [{**f, "namespace": f.get("namespace", f.get("bundle"))} if isinstance(f, dict) else f for f in files]
    for file in files:
        if (
            not isinstance(file, dict)
            or not isinstance(file.get("path"), str)
            or not isinstance(file.get("namespace"), str)
        ):
            raise CompileError("Every file needs a path and a namespace")
        if not re.fullmatch(r"[A-Za-z_]\w*", file["namespace"], re.ASCII) or file["namespace"] == "default":
            raise CompileError(f"{file['namespace']!r} isn't a valid namespace")
    namespaces = [file["namespace"] for file in files]
    duplicate = next((ns for ns in namespaces if namespaces.count(ns) > 1), None)
    if duplicate:
        raise CompileError(f"Two files share the namespace {duplicate!r}")
    types = variable_types(files, library)
    result = {}
    for file in files:
        compiler = FileCompiler(library, file, types)
        policy = compiler.compile()
        templates = {f"{TEMPLATES_DIR}{name}": text for name, text in compiler.companions.items()}
        result[file["path"]] = {file["path"]: policy, **templates}
        if source_map is not None:
            source_map[file["path"]] = compiler.source_map
    return result


def templates_module(files: dict[str, str]) -> dict | None:
    """The ./templates/ directory module (what `cfbs add ./templates/` writes), when there are templates;
    an empty directory module would fail the build."""
    if not any(path.startswith(TEMPLATES_DIR) for path in files):
        return None
    return {
        "name": TEMPLATES_DIR,
        "description": "Local subdirectory added using cfbs command line",
        "tags": ["local"],
        "added_by": "cfbs add",
        "steps": [f"directory ./ services/cfbs/{TEMPLATES_DIR[2:]}"],
    }


def variable_types(files: list[dict], library: Library) -> dict[str, str]:
    """ "<ns>:vars.name" -> CFEngine type of every Define Variable entry in the project."""
    types = {}
    for file in files:
        for block in file.get("blocks") or []:
            descriptor = library.descriptors.get(block.get("blockId"), {})
            if descriptor.get("compile_target") != "file_vars" or "entries" not in descriptor:
                continue
            sources = {source["id"]: source for source in descriptor.get("value_sources", [])}
            for entry in block.get("entries") or []:
                source = sources.get(entry.get("valueSourceId"))
                name = (entry.get("params") or {}).get(descriptor["entries"]["name_param"], "")
                if not source or not name or source["steps"][0]["promise_type"] != "vars":
                    continue
                types[f"{file['namespace']}:vars.{name}"] = chain_type(source, entry.get("decorators") or [], library)
    return types


def defined_classes(file: dict, library: Library) -> set[str]:
    """The classes a file's Define Class entries define, in its namespace."""
    names = set()
    for block in file.get("blocks") or []:
        descriptor = library.descriptors.get(block.get("blockId"), {})
        if descriptor.get("compile_target") != "file_vars" or "entries" not in descriptor:
            continue
        sources = {source["id"]: source for source in descriptor.get("value_sources", [])}
        for entry in block.get("entries") or []:
            source = sources.get(entry.get("valueSourceId")) or next(iter(sources.values()), None)
            name = (entry.get("params") or {}).get(descriptor["entries"]["name_param"], "")
            if source and name and source["steps"][0]["promise_type"] == "classes":
                names.add(name)
    return names


def chain_type(source: dict, decorators: list[dict], library: Library) -> str:
    """The CFEngine type a value source produces through its decorators."""
    kind = source.get("value_type", "string")
    for instance in decorators:
        kind = library.decorators.get(instance.get("decoratorId"), {}).get("output_type", kind)
    return kind
