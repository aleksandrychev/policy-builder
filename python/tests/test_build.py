"""Deployment's Build step (cfpb_build): cfbs build, the linter and cf-promises, and the `build` subcommand."""

from __future__ import annotations

import io
import json
import os
import stat
from pathlib import Path

import pytest

import cfpb_build
import cfpb_testenv
from cfpb_backend import main

BAD_CALL = 'bundle agent main\n{\n  vars:\n    "x" string => nosuchfn("a");\n}\n'
GOOD = 'bundle agent main\n{\n  reports:\n    "hello";\n}\n'

needs_cf_promises = pytest.mark.skipif(cfpb_build._local_cf_promises() is None, reason="needs CFEngine's cf-promises")


def _run(argv: list[str], stdin: str, monkeypatch: pytest.MonkeyPatch) -> tuple[int, str, str]:
    stdout, stderr = io.StringIO(), io.StringIO()
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin))
    monkeypatch.setattr("sys.stdout", stdout)
    monkeypatch.setattr("sys.stderr", stderr)
    return main(argv), stdout.getvalue(), stderr.getvalue()


def _built_tree(root: Path, own: dict[str, str], masterfiles: dict[str, str] | None = None) -> Path:
    """A fake `cfbs build` output: the project's files under services/cfbs/, plus masterfiles' own."""
    built = root / "out" / "masterfiles"
    for name, text in own.items():
        (built / "services" / "cfbs" / name).parent.mkdir(parents=True, exist_ok=True)
        (built / "services" / "cfbs" / name).write_text(text)
    for name, text in (masterfiles or {}).items():
        (built / name).parent.mkdir(parents=True, exist_ok=True)
        (built / name).write_text(text)
    return built


def _cfbs_project(root: Path, files: dict[str, str]) -> None:
    """A policy-set project with local policy files only, so `cfbs build` runs offline."""
    build = [
        {
            "name": f"./{name}",
            "description": "Local policy file added using cfbs command line",
            "tags": ["local"],
            "added_by": "cfbs add",
            "steps": [f"copy ./{name} services/cfbs/{name}", f"policy_files services/cfbs/{name}", "bundles main"],
        }
        for name in files
    ]
    config = {"name": "Project", "type": "policy-set", "description": "", "build": build}
    (root / "cfbs.json").write_text(json.dumps(config, indent=2))
    for name, text in files.items():
        (root / name).write_text(text)


# --- _parse_promises ---


def test_parse_promises_maps_built_files_back_to_the_project(tmp_path: Path):
    built = tmp_path / "out" / "masterfiles"
    output = (
        f"{built}/services/cfbs/security.cf:4:20: error: syntax error\n"
        '    "x" string => ;\n'
        "                   ^\n"
        f"{built}/services/cfbs/web/nginx.cf:12:3: error: Invalid r-value type ';'\n"
        f"{built}/services/cfbs/security.cf:9:1: warning: Not an error\n"
        "   error: There are syntax errors in policy files\n"
    )

    assert cfpb_build._parse_promises(output, str(tmp_path), "") == [
        {"message": "syntax error", "file": "./security.cf", "line": 4},
        {"message": "Invalid r-value type ';'", "file": "./web/nginx.cf", "line": 12},
    ]


def test_parse_promises_keeps_only_the_first_line_of_a_multi_line_message(tmp_path: Path):
    built = tmp_path / "out" / "masterfiles"
    output = f"{built}/services/cfbs/a.cf:5:2: error: Check previous line, Expected ';', got '}}'\n}}\n ^\n"

    assert cfpb_build._parse_promises(output, str(tmp_path), "") == [
        {"message": "Check previous line, Expected ';', got '}'", "file": "./a.cf", "line": 5}
    ]


def test_parse_promises_maps_paths_inside_the_container_through_the_prefix(tmp_path: Path):
    output = (
        "/tmp/masterfiles/services/cfbs/security.cf:3:7: error: Unknown function\n"
        "/tmp/masterfiles/lib/files.cf:40:1: error: Unknown body\n"
    )

    problems = cfpb_build._parse_promises(output, str(tmp_path), "/tmp/masterfiles/")

    assert problems[0] == {"message": "Unknown function", "file": "./security.cf", "line": 3}
    # Masterfiles' own files aren't dropped: they come back relative to the project folder.
    assert problems[1] == {"message": "Unknown body", "file": "./out/masterfiles/lib/files.cf", "line": 40}


def test_parse_promises_keeps_a_path_outside_the_project_as_is(tmp_path: Path):
    output = "/elsewhere/x.cf:1:1: error: nope\n"

    assert cfpb_build._parse_promises(output, str(tmp_path), "") == [
        {"message": "nope", "file": "/elsewhere/x.cf", "line": 1}
    ]


def test_parse_promises_finds_nothing_in_clean_output(tmp_path: Path):
    assert cfpb_build._parse_promises("", str(tmp_path), "") == []
    assert cfpb_build._parse_promises("R: hello\n", str(tmp_path), "") == []


# --- lint ---


def test_lint_keeps_only_the_projects_own_files(tmp_path: Path):
    _built_tree(
        tmp_path,
        {"mine.cf": BAD_CALL.replace("main", "mine")},
        {"lib/lib.cf": BAD_CALL.replace("main", "lib").replace("nosuchfn", "otherbad")},
    )

    assert cfpb_build.lint(str(tmp_path)) == {
        "ok": False,
        "problems": [
            {"message": "Call to unknown function / bundle / body 'nosuchfn'", "file": "./mine.cf", "line": 4}
        ],
    }


def test_lint_passes_when_only_masterfiles_has_findings(tmp_path: Path):
    _built_tree(tmp_path, {"mine.cf": GOOD}, {"lib/lib.cf": BAD_CALL.replace("main", "lib")})

    assert cfpb_build.lint(str(tmp_path)) == {"ok": True, "problems": []}


# --- validate ---


def _fake_cf_promises(tmp_path: Path, output: str, code: int) -> str:
    (tmp_path / "output.txt").write_text(output)
    script = tmp_path / "cf-promises"
    script.write_text(f'#!/bin/sh\necho "$@" > "{tmp_path}/args.txt"\ncat "{tmp_path}/output.txt" >&2\nexit {code}\n')
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return str(script)


def test_validate_runs_the_local_cf_promises_on_the_built_policy_set(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    project = tmp_path / "project"
    built = _built_tree(project, {"mine.cf": GOOD})
    output = f"{built}/services/cfbs/mine.cf:4:20: error: syntax error\n"
    monkeypatch.setattr(cfpb_build, "_local_cf_promises", lambda: _fake_cf_promises(tmp_path, output, 1))

    result = cfpb_build.validate(str(project))

    assert result == {
        "ok": False,
        "how": "local",
        "problems": [{"message": "syntax error", "file": "./mine.cf", "line": 4}],
    }
    assert (tmp_path / "args.txt").read_text().split() == ["-f", str(built / "promises.cf")]


def test_validate_passes_on_a_clean_exit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(cfpb_build, "_local_cf_promises", lambda: _fake_cf_promises(tmp_path, "", 0))

    assert cfpb_build.validate(str(tmp_path)) == {"ok": True, "how": "local", "problems": []}


def test_validate_fails_on_a_non_zero_exit_without_parsable_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(cfpb_build, "_local_cf_promises", lambda: _fake_cf_promises(tmp_path, "garbled\n", 1))

    assert cfpb_build.validate(str(tmp_path)) == {"ok": False, "how": "local", "problems": []}


@needs_cf_promises
def test_validate_with_the_real_cf_promises(tmp_path: Path):
    promises = 'body common control\n{\n  bundlesequence => { "main" };\n  inputs => { "services/cfbs/mine.cf" };\n}\n'
    _built_tree(
        tmp_path, {"mine.cf": 'bundle agent main\n{\n  vars:\n    "x" string => ;\n}\n'}, {"promises.cf": promises}
    )

    result = cfpb_build.validate(str(tmp_path))

    assert (result["ok"], result["how"]) == (False, "local")
    assert {"message": "syntax error", "file": "./mine.cf", "line": 4} in result["problems"]


def test_validate_is_skipped_without_cfengine_or_docker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    def no_docker():
        raise ConnectionError("Docker isn't running")

    monkeypatch.setattr(cfpb_build, "_local_cf_promises", lambda: None)
    monkeypatch.setattr(cfpb_testenv, "client", no_docker)

    assert cfpb_build.validate(str(tmp_path)) == {
        "ok": None,
        "how": "skipped",
        "problems": [],
        "message": "Install CFEngine or start Docker to check with cf-promises.",
    }


class _FakeEngine:
    """Just enough of the Docker SDK for _validate_in_docker."""

    def __init__(self, tags: list[str], exit_code: int = 0, output: bytes = b""):
        self.tags, self.exit_code, self.output = tags, exit_code, output
        self.images = self
        self.containers = self
        self.started, self.archives, self.removed = [], [], False

    def list(self):
        return [type("Image", (), {"tags": self.tags})()]

    def run(self, image, command, detach):
        self.started.append(image)
        return self

    def put_archive(self, path, data):
        self.archives.append(path)

    def exec_run(self, argv):
        return self.exit_code, self.output

    def remove(self, force):
        self.removed = force


def test_validate_is_skipped_without_a_cached_test_host_image(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(cfpb_build, "_local_cf_promises", lambda: None)
    monkeypatch.setattr(cfpb_testenv, "client", lambda: _FakeEngine(["ubuntu:24.04"]))

    result = cfpb_build.validate(str(tmp_path))

    assert (result["ok"], result["how"]) == (None, "skipped")
    assert result["message"] == "Start a test host once (Test Results & Logs) to check with cf-promises."


def test_validate_in_docker_maps_container_paths_and_removes_the_container(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _built_tree(tmp_path, {"mine.cf": GOOD})
    engine = _FakeEngine(
        ["cfpb-cache/ubuntu-24:3.27.1"], 1, b"/tmp/masterfiles/services/cfbs/mine.cf:2:1: error: bad\n"
    )
    monkeypatch.setattr(cfpb_build, "_local_cf_promises", lambda: None)
    monkeypatch.setattr(cfpb_testenv, "client", lambda: engine)

    result = cfpb_build.validate(str(tmp_path))

    assert result == {"ok": False, "how": "docker", "problems": [{"message": "bad", "file": "./mine.cf", "line": 2}]}
    assert engine.started == ["cfpb-cache/ubuntu-24:3.27.1"]
    assert engine.archives == ["/tmp"]
    assert engine.removed is True


# --- ensure_gitignore ---


def test_ensure_gitignore_creates_it(tmp_path: Path):
    cfpb_build.ensure_gitignore(str(tmp_path))

    assert (tmp_path / ".gitignore").read_text() == "out/\n"


def test_ensure_gitignore_appends_once(tmp_path: Path):
    (tmp_path / ".gitignore").write_text("*.swp")

    cfpb_build.ensure_gitignore(str(tmp_path))
    cfpb_build.ensure_gitignore(str(tmp_path))

    assert (tmp_path / ".gitignore").read_text() == "*.swp\nout/\n"


@pytest.mark.parametrize("existing", ["out\n", "/out/\n", "/out\n", "  out/  \n"])
def test_ensure_gitignore_recognises_an_existing_entry(tmp_path: Path, existing: str):
    (tmp_path / ".gitignore").write_text(existing)

    cfpb_build.ensure_gitignore(str(tmp_path))

    assert (tmp_path / ".gitignore").read_text() == existing


# --- build ---


def test_build_needs_a_cfbs_json(tmp_path: Path):
    with pytest.raises(cfpb_build.BuildFailed, match="No cfbs.json in"):
        cfpb_build.build(str(tmp_path))
    assert not (tmp_path / ".gitignore").exists()


def test_build_surfaces_the_last_line_of_a_cfbs_failure(tmp_path: Path):
    _cfbs_project(tmp_path, {"mine.cf": GOOD})
    (tmp_path / "mine.cf").unlink()
    cwd = os.getcwd()

    with pytest.raises(cfpb_build.BuildFailed) as failure:
        cfpb_build.build(str(tmp_path))

    assert str(failure.value) == "Error: module ./mine.cf does not exist"
    assert os.getcwd() == cwd
    assert (tmp_path / ".gitignore").read_text() == "out/\n"


def test_build_builds_lints_and_validates(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys):
    _cfbs_project(tmp_path, {"mine.cf": BAD_CALL})
    validated = {"ok": True, "how": "local", "problems": []}
    monkeypatch.setattr(cfpb_build, "validate", lambda directory: validated)

    result = cfpb_build.build(str(tmp_path))

    assert result["tarball"] == str(tmp_path / "out" / "masterfiles.tgz")
    assert os.path.isfile(result["tarball"])
    assert result["masterfiles"] == str(tmp_path / "out" / "masterfiles")
    assert any("Build complete" in line for line in result["log"])
    assert result["lint"] == {
        "ok": False,
        "problems": [
            {"message": "Call to unknown function / bundle / body 'nosuchfn'", "file": "./mine.cf", "line": 4}
        ],
    }
    assert result["promises"] is validated
    stages = [line for line in capsys.readouterr().err.splitlines() if line.startswith("::stage")]
    assert stages == ["::stage build", "::stage lint", "::stage promises"]


# --- the `build` subcommand ---


@pytest.mark.parametrize("stdin", ["not json", "[]", "{}", '{"path": "relative/project"}', '{"path": 42}'])
def test_build_command_rejects_bad_input_in_one_line(stdin: str, monkeypatch: pytest.MonkeyPatch):
    code, stdout, stderr = _run(["build"], stdin, monkeypatch)

    assert code == 1
    assert stdout == ""
    assert len(stderr.strip().splitlines()) == 1
    assert stderr.startswith("Build failed: ")


def test_build_command_reports_a_missing_cfbs_json(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    code, stdout, stderr = _run(["build"], json.dumps({"path": str(tmp_path)}), monkeypatch)

    assert (code, stdout) == (1, "")
    assert stderr == f"Build failed: No cfbs.json in {tmp_path}\n"


def test_build_command_reports_an_unexpected_error_as_exit_2(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    def explode(_path):
        raise RuntimeError("boom")

    monkeypatch.setattr(cfpb_build, "build", explode)
    code, stdout, stderr = _run(["build"], json.dumps({"path": str(tmp_path)}), monkeypatch)

    assert (code, stdout, stderr) == (2, "", "Build failed: RuntimeError: boom\n")


def test_build_command_prints_only_the_result_on_stdout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _cfbs_project(tmp_path, {"mine.cf": GOOD})
    monkeypatch.setattr(cfpb_build, "validate", lambda directory: {"ok": True, "how": "local", "problems": []})

    code, stdout, stderr = _run(["build"], json.dumps({"path": str(tmp_path)}), monkeypatch)

    assert code == 0
    result = json.loads(stdout)
    assert result["lint"] == {"ok": True, "problems": []}
    assert result["tarball"] == str(tmp_path / "out" / "masterfiles.tgz")
    assert "Build complete" in stderr
