"""What each block compiles to, exactly: one reviewed snapshot per block in tests/snapshots/ —
a realistic example plus each option, every Define Variable / Define Class source and every
decorator. After an intended change, regenerate with CFPB_UPDATE_SNAPSHOTS=1 and review the diff."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from test_compiler_all_blocks import FROM_VARIABLE, LIBRARY, _entry, _params

from cfpb_compiler import compile_project

SNAPSHOTS = Path(__file__).parent / "snapshots"
UPDATE = os.environ.get("CFPB_UPDATE_SNAPSHOTS") == "1"
ACTIONS = sorted(block_id for block_id, d in LIBRARY.descriptors.items() if d.get("compile_target") == "own_bundle")
# Realistic inputs, so a snapshot reads like real policy; the rest are defaults. Lists show iteration.
EXAMPLES: dict[str, dict[str, str]] = {
    "call-method": {"label": "Run site checks", "bundle_name": "site_checks"},
    "clean-up-old-files": {"directory": "/var/tmp", "days": "14"},
    "comment-lines": {"path": "/etc/nginx/nginx.conf", "pattern": "listen 8080.*"},
    "copy-directory": {"destination": "/opt/app/static", "source": "/srv/build/static"},
    "copy-file": {"destination": "/etc/motd", "source": "/srv/files/motd"},
    "create-directory": {"path": "/var/www/html\n/var/www/uploads", "owner": "www-data", "group": "www-data"},
    "create-edit-file": {"path": "/etc/app.conf", "content": 'name = "app"\nport = 8080\n'},
    "create-symlink": {"link": "/etc/nginx/sites-enabled/app", "target": "/etc/nginx/sites-available/app"},
    "cron-job": {"command": "/usr/local/bin/backup.sh", "hours": "3", "minutes": "30"},
    "ensure-lines": {"path": "/etc/hosts", "lines": "127.0.0.1 app.local\n10.0.0.5 db.local"},
    "install-package": {"package_name": "nginx"},
    "manage-service": {"service_name": "nginx"},
    "manage-users": {"username": "deploy"},
    "mount-storage": {"mount_point": "/mnt/share", "server": "nas.local", "remote_path": "/exports/share"},
    "remove-directory": {"path": "/tmp/build\n/tmp/cache"},
    "remove-file": {"path": "/etc/nginx/sites-enabled/default"},
    "remove-lines": {"path": "/etc/sudoers", "pattern": ".*NOPASSWD.*"},
    "remove-package": {"package_name": "telnet"},
    "render-template": {"destination": "/etc/app.conf", "template_content": "host = {{{vars.sys.fqhost}}}\n"},
    "replace-text": {"path": "/etc/nginx/nginx.conf", "find": "example\\.com", "replace": "demo.local"},
    "report-message": {"message": "Provisioned $(sys.fqhost)", "report_to_file": ""},
    "rotate-log": {"path": "/var/log/app.log\n/var/log/worker.log", "max_size": "50M"},
    "run-command": {"command": "/usr/sbin/update-ca-certificates"},
    "set-config-values": {"path": "/etc/ssh/sshd_config", "settings": "PermitRootLogin no\nMaxAuthTries 3"},
    "set-permissions": {"path": "/etc/shadow", "mode": "640", "group": "shadow"},
    "signal-process": {"process_pattern": "nginx: master.*"},
    "watch-file": {"path": "/etc/passwd\n/etc/group"},
}


def _action_cases(block_id: str) -> list[tuple[str, dict]]:
    """The sample, then each option of each options parameter that differs from it."""
    declared = LIBRARY.descriptors[block_id]["parameters"]
    base = {**_params(declared), **EXAMPLES[block_id]}
    cases = [("example", base)]
    for param in declared:
        for option in param.get("options", []):
            value = option if isinstance(option, str) else option["value"]
            if value != base[param["name"]]:
                cases.append((f"{param['name']} = {value!r}", {**base, param["name"]: value}))
    return [
        (name, {"instanceId": f"case{i}", "blockId": block_id, "label": f"Case {i}", "params": params})
        for i, (name, params) in enumerate(cases)
    ]


def _definition_cases(block_id: str) -> list[tuple[str, dict]]:
    """One block per value source, holding a single entry."""
    descriptor = LIBRARY.descriptors[block_id]
    name_param = descriptor["entries"]["name_param"]
    cases = []
    for i, source in enumerate(descriptor["value_sources"]):
        name = source["id"].replace("-", "_")
        overrides = {"from_variable": FROM_VARIABLE[source["id"]]} if source["id"] in FROM_VARIABLE else {}
        if source["id"] == "per-condition":
            rows = [
                {"className": "debian", "mode": "if", "value": "www-data"},
                {"className": "redhat", "mode": "if", "value": "nginx"},
            ]
            overrides = {"cases": json.dumps(rows), "otherwise": "nobody"}
        extra = {}
        if source["id"].startswith("combine"):
            extra["classRefs"] = [
                {"id": "r1", "name": "linux", "negate": False},
                {"id": "r2", "name": "debian", "negate": True},
            ]
        entry = _entry(name, name_param, name, source["id"], _params(source["parameters"], **overrides), **extra)
        block = {"instanceId": f"case{i}", "blockId": block_id, "label": f"Case {i}", "params": {}, "entries": [entry]}
        cases.append((f"source {source['id']}", block))
    return cases


def _decorator_cases() -> list[tuple[str, dict]]:
    """Every decorator on a value of its input type."""
    sources = {s["id"]: s for s in LIBRARY.descriptors["define-variable"]["value_sources"]}
    cases = []
    for i, (decorator_id, decorator) in enumerate(sorted(LIBRARY.decorators.items())):
        source_id = "file-lines" if decorator["input_type"] == "slist" else "command-output"
        step = {"id": "d", "decoratorId": decorator_id, "params": _params(decorator.get("parameters", []))}
        entry = _entry(
            "v", "variable_name", f"via_{i}", source_id, _params(sources[source_id]["parameters"]), decorators=[step]
        )
        block = {
            "instanceId": f"case{i}",
            "blockId": "define-variable",
            "label": f"Case {i}",
            "params": {},
            "entries": [entry],
        }
        cases.append((f"decorator {decorator_id}", block))
    return cases


def _cases(name: str) -> list[tuple[str, dict]]:
    if name == "decorators":
        return _decorator_cases()
    if LIBRARY.descriptors[name].get("compile_target") == "own_bundle":
        return _action_cases(name)
    return _definition_cases(name)


def _render(name: str) -> str:
    """Each case's compiled lines, under a `### <case>` heading."""
    cases = _cases(name)
    blocks = [block for _case, block in cases]
    file = {"id": "f", "name": "Snapshot", "namespace": "snap", "path": "./snap.cf", "blocks": blocks}
    meta = {"files": [{**file, "order": [b["instanceId"] for b in blocks]}]}
    source_map: dict = {}
    files = compile_project(meta, source_map=source_map)
    lines = files["./snap.cf"].splitlines()
    out = []
    for case, block in cases:
        out.append(f"### {case}")
        for first, last in source_map["./snap.cf"].get(block["instanceId"], []):
            out += lines[first - 1 : last]
        out.append("")
    # Templates and builder bodies the cases need, as written next to the policy.
    for path, text in files.items():
        if path != "./snap.cf":
            out += [f"### file {path}", text.rstrip(), ""]
    bodies = [body.split("\n")[0] for body in files["./snap.cf"].split("\nbody ")[1:]]
    out += [f"### body {body}" for body in bodies if body != "file control"]
    return "\n".join(out).rstrip() + "\n"


def test_every_action_block_has_an_example():
    assert sorted(EXAMPLES) == ACTIONS


@pytest.mark.parametrize("name", [*ACTIONS, "define-variable", "define-class", "decorators"])
def test_compiled_output_matches_its_snapshot(name: str):
    snapshot = SNAPSHOTS / f"{name}.cf"
    actual = _render(name)
    if UPDATE or not snapshot.exists():
        SNAPSHOTS.mkdir(exist_ok=True)
        snapshot.write_text(actual)
        if not UPDATE:
            pytest.fail(f"{snapshot.name} was missing and has been written: review it and commit")
    assert actual == snapshot.read_text(), f"{snapshot.name} changed: review, then CFPB_UPDATE_SNAPSHOTS=1"
