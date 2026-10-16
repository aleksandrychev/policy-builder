"""Custom CFEngine blocks: their hand-written text checked with cfengine_cli's linter, offline.

A block holds promises (the body of a bundle of its own) and the bodies and bundles they use.
They're checked as the compiler places them: in the file's namespace, the promises in a bundle,
the definitions after it. Names from other namespaces (default:, the standard library; other
files) can't be checked here; an unqualified name the block doesn't define is most likely the
standard library's, which a namespaced file only reaches as default:<name>.
"""

from __future__ import annotations

import contextlib
import functools
import io
import json
import os
import re
import tempfile

PROBLEM = re.compile(r"^Error: (?P<message>.*) at .*?:(?P<line>\d+):(?P<column>\d+)$")
UNKNOWN = re.compile(r"Call to unknown function / bundle / body '(?P<name>[^']+)'")
BUNDLE = "custom_check"


def wrapped(promises: str, definitions: str, namespace: str) -> tuple[str, int, int]:
    """The text as it's compiled, and the lines where the promises and the definitions start."""
    head = [f'body file control {{ namespace => "{namespace}"; }}', f"bundle agent {BUNDLE}", "{"]
    promise_lines = promises.splitlines() or [""]
    text = "\n".join([*head, *promise_lines, "}", definitions, ""])
    return text, len(head) + 1, len(head) + len(promise_lines) + 2


def _lint(text: str) -> list[str]:
    from cfengine_cli.lint import lint_args

    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "custom.cf")
        with open(path, "w") as file:
            file.write(text)
        out = io.StringIO()
        # The linter prints its findings, and may look for a cfbs.json around the working directory.
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()), contextlib.chdir(directory):
            lint_args([path])
        return out.getvalue().splitlines()


def check(promises: str, definitions: str, namespace: str) -> list[dict]:
    """The text's problems: {field: promises | definitions, line, column, message}."""
    text, promises_at, definitions_at = wrapped(promises, definitions, namespace)
    problems = []
    for output in _lint(text):
        found = PROBLEM.match(output.strip())
        if not found:
            continue
        message, line = found["message"], int(found["line"])
        unknown = UNKNOWN.search(message)
        if unknown:
            name = unknown["name"]
            if ":" in name:
                continue
            message = f"{name} isn't defined in this block: from the standard library, write default:{name}"
        problems.append(_placed(line, int(found["column"]), message, promises_at, definitions_at))
    lists = [
        _placed(line, column, message, promises_at, definitions_at)
        for line, column, message in _scalars_for_lists(text)
    ]
    return problems + lists + _perms_without_rxdirs(definitions)


def _placed(line: int, column: int, message: str, promises_at: int, definitions_at: int) -> dict:
    """A problem at a line of the wrapped text, as a line of the field it's in."""
    field, first = ("definitions", definitions_at) if line >= definitions_at else ("promises", promises_at)
    if line < promises_at:
        field, first = "promises", line
    return {"field": field, "line": line - first + 1, "column": column, "message": message}


LIST_TYPES = {"slist", "ilist", "rlist", "clist", "olist"}


@functools.cache
def _attribute_types() -> tuple[dict, dict]:
    """Attribute name -> type, per body type and per promise type, from the linter's syntax data."""
    import cfengine_cli

    path = os.path.join(os.path.dirname(cfengine_cli.__file__), "syntax-description.json")
    with open(path) as file:
        syntax = json.load(file)

    def types(group: str) -> dict:
        return {
            name: {key: spec.get("type") for key, spec in kind["attributes"].items()}
            for name, kind in syntax[group].items()
        }

    return types("bodyTypes"), types("promiseTypes")


def _scalars_for_lists(text: str) -> list[tuple[int, int, str]]:
    """A string given to a list attribute (owners => "root"): the linter lets it through, cf-promises refuses it."""
    import tree_sitter_cfengine
    from tree_sitter import Language, Parser

    body_types, promise_types = _attribute_types()
    tree = Parser(Language(tree_sitter_cfengine.language())).parse(text.encode())
    found = []

    def walk(node, attributes: dict):
        if node.type == "body_block":
            kind = next((child for child in node.children if child.type == "body_block_type"), None)
            attributes = body_types.get(kind.text.decode(), {}) if kind else {}
        elif node.type == "promise_guard":
            return node.text.decode().rstrip(":")
        elif node.type == "attribute" and len(node.children) >= 3:
            name, value = node.children[0].text.decode(), node.children[2]
            if attributes.get(name) in LIST_TYPES and value.type in ("quoted_string", "qualified_identifier"):
                row, column = value.start_point
                found.append((row + 1, column + 1, f"{name} takes a list: write {{ {value.text.decode()} }}"))
            return None
        promise_type = None
        for child in node.children:
            in_section = promise_types.get(promise_type, {}) if node.type == "bundle_section" else attributes
            promise_type = walk(child, in_section) or promise_type

    walk(tree.root_node, {})
    return found


PERMS_BODY = re.compile(r"^\s*body\s+perms\s+(\w+)", re.M)


def _body_of(text: str, start: int) -> str:
    """A body's text from `start`: to the brace closing its opening one (lists like
    owners => { "root" } have braces too), quoted strings skipped."""
    depth, quote, opened = 0, None, False
    for index in range(start, len(text)):
        char = text[index]
        if quote:
            quote = None if char == quote and text[index - 1] != "\\" else quote
        elif char in "\"'":
            quote = char
        elif char == "{":
            depth, opened = depth + 1, True
        elif char == "}":
            depth -= 1
            if opened and depth == 0:
                return text[start : index + 1]
    return text[start:]


def _perms_without_rxdirs(definitions: str) -> list[dict]:
    """CFEngine 3.28 warns on every run about a body perms that doesn't set rxdirs."""
    found = []
    for match in PERMS_BODY.finditer(definitions):
        if "rxdirs" not in _body_of(definitions, match.end()):
            line = definitions[: match.start()].count("\n") + 1
            message = f'body perms {match[1]} doesn\'t set rxdirs: CFEngine warns about it on every run (add rxdirs => "false", or "true" for directories)'
            found.append({"field": "definitions", "line": line, "column": 1, "message": message})
    return found


def syntax_error(promises: str, definitions: str, namespace: str) -> str | None:
    """The first syntax error, if any, as the compiler reports a skipped block."""
    for problem in check(promises, definitions, namespace):
        if problem["message"].startswith("Syntax error"):
            where = "promises" if problem["field"] == "promises" else "bodies and bundles"
            return f"a syntax error in its {where}, line {problem['line']}"
    return None
