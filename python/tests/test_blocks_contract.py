"""The block/decorator descriptors are the compiler's input: check them against
the v1 schemas, plus the cross-references JSON Schema can't express."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

BLOCKS = Path(__file__).resolve().parents[2] / "blocks"
SCHEMAS = BLOCKS / "schemas"
PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")

# Stdlib bodies the compiled policy may reference (as default:<name>). The
# compiler has to ship masterfiles' lib/ for these; add to the list knowingly.
STDLIB_BODIES = {"mog", "local_cp", "recurse", "tidy", "in_shell", "if_elapsed"}


def _schema(name: str) -> dict:
    return json.loads((SCHEMAS / name).read_text())


def _registry() -> Registry:
    resources = []
    for path in SCHEMAS.glob("*.json"):
        resource = Resource.from_contents(json.loads(path.read_text()))
        # Reachable by $id and by the relative name the other schemas use.
        resources += [(resource.id(), resource), (path.name, resource)]
    return Registry().with_resources(resources)


def _validator(name: str) -> Draft202012Validator:
    schema = _schema(name)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, registry=_registry())


def _descriptors() -> list[Path]:
    return sorted(BLOCKS.glob("*.json"))


def _builder_bodies() -> dict[str, dict]:
    bodies = json.loads((BLOCKS / "lib" / "bodies.json").read_text())["bodies"]
    return {body["name"]: body for body in bodies}


def _walk(expr, *, top_level: bool, in_decorator: bool, problems: list[str], where: str):
    """Yield every placeholder in an expression; record misplaced forms."""
    if isinstance(expr, str):
        yield from PLACEHOLDER.findall(expr)
        return
    if "if_set" in expr:
        if not top_level:
            problems.append(f"{where}: if_set is only allowed as a whole attribute value")
        yield expr["if_set"]
        yield from _walk(expr["value"], top_level=False, in_decorator=in_decorator, problems=problems, where=where)
        return
    if "previous" in expr and not in_decorator:
        problems.append(f"{where}: previous is only allowed in decorators")
    if "body" in expr:
        lib = expr.get("lib", "stdlib")
        known = STDLIB_BODIES if lib == "stdlib" else _builder_bodies()
        if expr["body"] not in known:
            problems.append(f"{where}: unknown {lib} body {expr['body']}")
        elif lib == "builder" and len(expr.get("args", [])) != len(known[expr["body"]]["parameters"]):
            problems.append(f"{where}: {expr['body']} takes {len(known[expr['body']]['parameters'])} arguments")
    if "list_param" in expr:
        yield expr["list_param"]
    for key in ("variable", "bundle", "class_expression"):
        if key in expr:
            yield from PLACEHOLDER.findall(expr[key])
    for item in expr.get("args", []) + expr.get("list", []):
        yield from _walk(item, top_level=False, in_decorator=in_decorator, problems=problems, where=where)


def _check_parameters(params: list[dict], where: str, problems: list[str]):
    names = [param["name"] for param in params]
    if len(names) != len(set(names)):
        problems.append(f"{where}: duplicate parameter names {names}")
    for param in params:
        at = f"{where}/{param['name']}"
        kind, default = param["type"], param.get("default")
        values = [option if isinstance(option, str) else option["value"] for option in param.get("options", [])]
        if default is not None:
            expected = {"boolean": bool, "number": (int, float)}.get(kind, str)
            if not isinstance(default, expected) or (kind == "number" and isinstance(default, bool)):
                problems.append(f"{at}: default {default!r} doesn't match type {kind}")
            if values and str(default) not in values:
                problems.append(f"{at}: default {default!r} isn't one of the options")
            if param["required"] and default == "":
                problems.append(f"{at}: required, but defaults to empty")
        for flag, allowed in (
            ("mustache", "text"),
            ("allow_list", "text"),
            ("integer", "number"),
            ("minimum", "number"),
        ):
            if flag in param and kind != allowed:
                problems.append(f"{at}: {flag} only applies to {allowed} parameters")


def _check_steps(steps: list[dict], params: list[dict], where: str, problems: list[str]) -> set[str]:
    by_name = {param["name"]: param for param in params}
    used = set()
    for index, step in enumerate(steps):
        at = f"{where}/steps/{index}"
        used.update(PLACEHOLDER.findall(step["promiser"]))
        for attribute, value in step.get("attributes", {}).items():
            used.update(_walk(value, top_level=True, in_decorator=False, problems=problems, where=f"{at}/{attribute}"))
            if (
                isinstance(value, dict)
                and "list_param" in value
                and not by_name.get(value["list_param"], {}).get("allow_list")
            ):
                problems.append(f"{at}/{attribute}: list_param needs an allow_list parameter")
    for name in used - by_name.keys():
        problems.append(f"{where}: {{{{{name}}}}} isn't a parameter")
    return used


def _check_descriptor(path: Path, problems: list[str]):
    block = json.loads(path.read_text())
    where = path.name
    if block["id"] != path.stem:
        problems.append(f"{where}: id {block['id']} doesn't match the file name")
    shared = block.get("parameters", [])
    if "steps" in block:
        _check_parameters(shared, where, problems)
        used = _check_steps(block["steps"], shared, where, problems)
        for name in {param["name"] for param in shared} - used:
            problems.append(f"{where}: parameter {name} is never used")
        if block.get("outcome_step", 0) >= len(block["steps"]):
            problems.append(f"{where}: outcome_step is past the last step")
    if block["compile_target"] == "file_vars" and "entries" not in block:
        problems.append(f"{where}: file_vars blocks hold entries")
    if "entries" in block and block["entries"]["name_param"] not in {param["name"] for param in shared}:
        problems.append(f"{where}: entries.name_param isn't a shared parameter")
    for source in block.get("value_sources", []):
        at = f"{where}/{source['id']}"
        params = shared + source["parameters"]
        _check_parameters(params, at, problems)
        used = _check_steps(source["steps"], params, at, problems)
        for name in {param["name"] for param in source["parameters"]} - used:
            problems.append(f"{at}: parameter {name} is never used")
        step = source["steps"][0]
        if step["promise_type"] == "vars":
            if list(step.get("attributes", {})) != [source.get("value_type")]:
                problems.append(f"{at}: a vars source has one attribute, named after its value_type")
        elif "value_type" in source:
            problems.append(f"{at}: value_type only applies to vars sources")


def test_block_descriptors_match_schema():
    validator = _validator("block-descriptor.v1.json")
    errors = [
        f"{path.name}: {error.json_path}: {error.message}"
        for path in _descriptors()
        for error in validator.iter_errors(json.loads(path.read_text()))
    ]
    assert errors == []


def test_decorators_match_schema():
    errors = [
        f"{error.json_path}: {error.message}"
        for error in _validator("decorator.v1.json").iter_errors(
            json.loads((BLOCKS / "lib" / "decorators.json").read_text())
        )
    ]
    assert errors == []


def test_block_descriptors_are_consistent():
    problems: list[str] = []
    for path in _descriptors():
        _check_descriptor(path, problems)
    assert problems == []


def test_decorators_are_consistent():
    problems: list[str] = []
    decorators = json.loads((BLOCKS / "lib" / "decorators.json").read_text())["decorators"]
    ids = [decorator["id"] for decorator in decorators]
    assert len(ids) == len(set(ids)), "duplicate decorator ids"
    for decorator in decorators:
        where = f"decorators/{decorator['id']}"
        params = decorator["parameters"]
        _check_parameters(params, where, problems)
        if any(param["name"] == "value" for param in params):
            problems.append(f'{where}: "value" is reserved for the incoming value')
        if "expression" in decorator:
            used = set(
                _walk(decorator["expression"], top_level=False, in_decorator=True, problems=problems, where=where)
            )
            if '"previous"' not in json.dumps(decorator["expression"]):
                problems.append(f"{where}: the expression never uses the incoming value")
        else:
            used = {name for template in decorator["fallback"].values() for name in PLACEHOLDER.findall(template)}
        names = {param["name"] for param in params}
        problems += [f"{where}: {{{{{name}}}}} isn't a parameter" for name in used - names]
        problems += [f"{where}: parameter {name} is never used" for name in names - used]
    assert problems == []


def test_builder_bodies_match_schema():
    document = json.loads((BLOCKS / "lib" / "bodies.json").read_text())
    assert [f"{error.json_path}: {error.message}" for error in _validator("bodies.v1.json").iter_errors(document)] == []


def test_builder_bodies_are_consistent():
    problems: list[str] = []
    for name, body in _builder_bodies().items():
        used = set(re.findall(r"\$\((\w+)\)", json.dumps(body["attributes"])))
        problems += [f"{name}: $({param}) isn't a parameter" for param in used - set(body["parameters"])]
        problems += [f"{name}: parameter {param} is never used" for param in set(body["parameters"]) - used]
    assert problems == []


def _cfengine_value(expr) -> str:
    """Just enough of the compiler for builder bodies: strings and lists."""
    if isinstance(expr, str):
        return '"' + expr.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return "{ " + ", ".join(_cfengine_value(item) for item in expr["list"]) + " }"


@pytest.mark.skipif(shutil.which("cf-promises") is None, reason="needs a local CFEngine")
def test_builder_bodies_compile(tmp_path: Path):
    lines = ['body file control { namespace => "project"; }']
    for body in _builder_bodies().values():
        attributes = "".join(f"  {key} => {_cfengine_value(value)};\n" for key, value in body["attributes"].items())
        lines.append(f"body {body['type']} {body['name']}({', '.join(body['parameters'])})\n{{\n{attributes}}}")
    (tmp_path / "bodies.cf").write_text("\n".join(lines) + "\n")
    entry = tmp_path / "entry.cf"
    entry.write_text(
        'body common control { inputs => { "bodies.cf" }; bundlesequence => { "main" }; }\n'
        'bundle agent main\n{\n  files:\n    "/tmp/cfpb-test/."\n      perms => project:mog_dirs("644", "root", "root");\n'
        '  storage:\n    "/mnt/cfpb-test"\n      mount => project:remote_mount("nfs", "server", "/export");\n}\n'
    )
    result = subprocess.run(["cf-promises", "-f", str(entry)], capture_output=True, text=True, cwd=tmp_path)
    assert result.returncode == 0, result.stderr
