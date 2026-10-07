"""Every action block compiles, for inputs beyond its one sample: each option, each optional
parameter empty and set, one value and several for lists, and text CFEngine could misread."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from test_compiler_all_blocks import FIXTURES, LIBRARY, _params

from cfpb_compiler import compile_project

ACTIONS = sorted(block_id for block_id, d in LIBRARY.descriptors.items() if d.get("compile_target") == "own_bundle")
# Quotes, backslashes (one at the end too), a variable reference and regex syntax.
TRICKY = ['say "hi"', "C:\\temp\\", "a\\b and $(sys.fqhost)", "^\\s*(a|b)[0-9]+.*$"]
TRICKY_PATHS = ['/tmp/with space/say "hi"', "/tmp/$(sys.fqhost)/x\\y"]
LISTS = ["/tmp/a\n/tmp/b", "one\ntwo\n\nthree"]


def _values(param: dict) -> list[str]:
    """The values to try for one parameter, besides its sample."""
    options = [o if isinstance(o, str) else o["value"] for o in param.get("options", [])]
    if options:
        return options
    values = [] if param["required"] else [""]
    if param["type"] == "number":
        return [*values, "1", "1000"]
    if param.get("allowed_chars"):
        return values
    if param.get("allow_list"):
        values.append(LISTS[0] if param.get("path") else LISTS[1])
    if param.get("path"):
        return [*values, *TRICKY_PATHS]
    values += TRICKY
    if param["type"] == "text":
        values.append('first line\nsecond "line"\\')
    return values


def variants(block_id: str) -> list[tuple[str, dict[str, str]]]:
    """(name, params): the sample, then one parameter changed at a time."""
    declared = LIBRARY.descriptors[block_id]["parameters"]
    base = _params(declared)
    found = [("sample", base)]
    for param in declared:
        for value in _values(param):
            if value != base[param["name"]]:
                found.append((f"{param['name']}={value!r}", {**base, param["name"]: value}))
    return found


def _project(block_id: str) -> dict:
    blocks = [
        {"instanceId": f"{block_id}-{i}", "blockId": block_id, "label": f"Variant {i}", "params": params}
        for i, (_name, params) in enumerate(variants(block_id))
    ]
    file = {"id": "f", "name": "Variants", "namespace": "variants", "path": "./variants.cf", "blocks": blocks}
    return {"files": [{**file, "order": [b["instanceId"] for b in blocks]}]}


@pytest.mark.parametrize("block_id", ACTIONS)
def test_every_variant_compiles_without_a_skip(block_id: str):
    policy = compile_project(_project(block_id))["./variants.cf"]

    assert "# Skipped" not in policy
    for i in range(len(variants(block_id))):
        assert f"\n  # Variant {i}\n" in policy, variants(block_id)[i][0]


@pytest.mark.skipif(shutil.which("cf-promises") is None, reason="needs a local CFEngine 3.27+")
@pytest.mark.parametrize("block_id", ACTIONS)
def test_every_variant_passes_cf_promises(block_id: str, tmp_path: Path):
    for path, text in compile_project(_project(block_id)).items():
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_text(text)
    shutil.copy(FIXTURES / "stdlib-stub.cf", tmp_path / "stdlib.cf")
    (tmp_path / "promises.cf").write_text(
        'body common control { inputs => { "stdlib.cf", "variants.cf" }; bundlesequence => { "variants:main" }; }\n'
        "bundle agent some_bundle { }\n"
    )

    result = subprocess.run(["cf-promises", "-f", str(tmp_path / "promises.cf")], capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
