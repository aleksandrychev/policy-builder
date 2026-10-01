"""Every block type, value source and decorator in blocks/ compiles to policy cf-promises accepts."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from cfpb_compiler import Library, compile_project, slug

FIXTURES = Path(__file__).parent / "fixtures"
LIBRARY = Library.load()

# Sample values by parameter name; anything else gets its default, first option, or a placeholder.
SAMPLES = {
    "path": "/etc/hosts",
    "destination": "/tmp/cfpb-test/out",
    "source": "/tmp/cfpb-test/in",
    "command": "/bin/echo hello",
    "items": "a\nb",
    "json": '{"a": 1}',
    "value": "hello",
    "value_a": "a",
    "value_b": "b",
    "threshold": "1",
    "pattern": "h.*",
    "replacement": "x",
    "find": "l",
    "fallback": "none",
    "env_var_name": "HOME",
    "condition": "linux",
    "variable_name": "vars.literal",
    "bundle_name": "some_bundle",
    "message": "hello from $(sys.fqhost)",
    "template_content": "{{{vars.all_vars.literal}}} {{#classes.always_true}}yes{{/classes.always_true}}",
}
# Value-source references point at entries defined below.
FROM_VARIABLE = {"variable": "vars.literal", "list-variable": "vars.list"}


def _sample(param: dict, override: str | None = None) -> str:
    if override is not None:
        return override
    if param["name"] in SAMPLES:
        return SAMPLES[param["name"]]
    if isinstance(param.get("default"), bool):
        return str(param["default"]).lower()  # as the editor stores it
    if param.get("default") not in (None, ""):
        return str(param["default"])
    options = param.get("options")
    if options:
        return options[0]["value"] if isinstance(options[0], dict) else options[0]
    return "/tmp/cfpb-test/x" if param.get("path") else "x"


def _params(declared: list[dict], **overrides: str) -> dict[str, str]:
    return {p["name"]: _sample(p, overrides.get(p["name"])) for p in declared}


def _entry(entry_id: str, name_param: str, name: str, source: str, params: dict, **extra) -> dict:
    return {"id": entry_id, "valueSourceId": source, "params": {name_param: name, **params}, **extra}


def _variables() -> dict:
    sources = {s["id"]: s for s in LIBRARY.descriptors["define-variable"]["value_sources"]}
    entries = []
    for source_id, source in sources.items():
        name = source_id.replace("-", "_")
        overrides = {"from_variable": FROM_VARIABLE[source_id]} if source_id in FROM_VARIABLE else {}
        entries.append(_entry(name, "variable_name", name, source_id, _params(source["parameters"], **overrides)))
    # Every decorator, fed a value of its input type.
    for decorator_id, decorator in LIBRARY.decorators.items():
        source_id = "file-lines" if decorator["input_type"] == "slist" else "command-output"
        name = f"via_{decorator_id.replace('-', '_')}"
        step = {"id": name, "decoratorId": decorator_id, "params": _params(decorator.get("parameters", []))}
        params = _params(sources[source_id]["parameters"])
        entries.append(_entry(name, "variable_name", name, source_id, params, decorators=[step]))
    return {
        "instanceId": "variables",
        "blockId": "define-variable",
        "label": "All variables",
        "params": {},
        "entries": entries,
    }


def _classes() -> dict:
    refs = [{"id": "r1", "name": "always_true", "negate": False}, {"id": "r2", "name": "linux", "negate": True}]
    entries = []
    for source in LIBRARY.descriptors["define-class"]["value_sources"]:
        name = source["id"].replace("-", "_")
        extra = {"classRefs": refs} if source["id"].startswith("combine") else {}
        entries.append(_entry(name, "class_name", name, source["id"], _params(source["parameters"]), **extra))
    return {
        "instanceId": "classes",
        "blockId": "define-class",
        "label": "All classes",
        "params": {},
        "entries": entries,
    }


def _actions() -> list[dict]:
    blocks = []
    for block_id, descriptor in LIBRARY.descriptors.items():
        if descriptor.get("compile_target") != "own_bundle":
            continue
        blocks.append(
            {
                "instanceId": block_id,
                "blockId": block_id,
                "label": descriptor["name"],
                "params": _params(descriptor["parameters"]),
            }
        )
    # Parameters computed from data: a list (iterates) and a string.
    sources = {s["id"]: s for s in LIBRARY.descriptors["define-variable"]["value_sources"]}
    split = {"id": "s", "decoratorId": "split-list", "params": {"delimiter": " ", "max_pieces": "10"}}
    by_id = {block["blockId"]: block for block in blocks}
    by_id["install-package"]["paramBindings"] = {
        "package_name": {
            "valueSourceId": "command-output",
            "params": _params(sources["command-output"]["parameters"]),
            "decorators": [split],
        }
    }
    by_id["report-message"]["paramBindings"] = {
        "message": {"valueSourceId": "file-content", "params": _params(sources["file-content"]["parameters"])}
    }
    return blocks


def _project() -> dict:
    blocks = [_variables(), _classes(), *_actions()]
    order = [
        block["instanceId"]
        for block in blocks
        if LIBRARY.descriptors[block["blockId"]]["compile_target"] == "own_bundle"
    ]
    return {
        "files": [{"id": "f", "name": "All", "bundle": "all", "path": "./all.cf", "blocks": blocks, "order": order}]
    }


def test_every_block_source_and_decorator_compiles_without_a_skip():
    policy = compile_project(_project())["./all.cf"]

    assert "# Skipped" not in policy
    for block_id, descriptor in LIBRARY.descriptors.items():
        if descriptor.get("compile_target") == "own_bundle":
            assert f"bundle agent all_{slug(descriptor['name'])}\n" in policy, block_id
    assert '"package_name"\n      slist => string_split(' in policy
    assert '"message" string => readfile(' in policy


@pytest.mark.skipif(shutil.which("cf-promises") is None, reason="needs a local CFEngine")
def test_every_block_source_and_decorator_passes_cf_promises_and_lint(tmp_path: Path):
    (tmp_path / "all.cf").write_text(compile_project(_project())["./all.cf"])
    shutil.copy(FIXTURES / "stdlib-stub.cf", tmp_path / "stdlib.cf")
    (tmp_path / "promises.cf").write_text(
        'body common control { inputs => { "stdlib.cf", "all.cf" }; bundlesequence => { "all" }; }\n'
        "bundle agent some_bundle { }\n"
    )

    result = subprocess.run(["cf-promises", "-f", str(tmp_path / "promises.cf")], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr

    lint = shutil.which("cfengine")
    if lint:
        result = subprocess.run(
            [lint, "lint", "stdlib.cf", "promises.cf", "all.cf"], capture_output=True, text=True, cwd=tmp_path
        )
        assert result.returncode == 0, result.stdout + result.stderr
