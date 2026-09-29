"""Tests for the sidecar's stdin/stdout contract: `format` and `init`."""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import cfpb_backend
from cfpb_backend import main

UNFORMATTED = 'bundle agent main\n{\n  reports:\n  "hello"    ;\n}\n'
FORMATTED = 'bundle agent main\n{\n  reports:\n    "hello";\n}\n'

needs_git = pytest.mark.skipif(shutil.which("git") is None, reason="needs git")
# Downloads masterfiles; opt in with CFPB_NETWORK_TESTS=1.
network = pytest.mark.skipif(os.environ.get("CFPB_NETWORK_TESTS") != "1", reason="set CFPB_NETWORK_TESTS=1")


def _run(argv: list[str], stdin: str, monkeypatch: pytest.MonkeyPatch) -> tuple[int, str, str]:
    """Run the sidecar in-process, returning (exit code, stdout, stderr)."""
    stdout, stderr = io.StringIO(), io.StringIO()
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin))
    monkeypatch.setattr("sys.stdout", stdout)
    monkeypatch.setattr("sys.stderr", stderr)

    return main(argv), stdout.getvalue(), stderr.getvalue()


# --- format ---


def test_formats_policy(monkeypatch: pytest.MonkeyPatch):
    code, stdout, stderr = _run(["format"], UNFORMATTED, monkeypatch)

    assert code == 0
    assert stdout == FORMATTED
    assert stderr == ""


def test_no_subcommand_means_format(monkeypatch: pytest.MonkeyPatch):
    code, stdout, _ = _run([], UNFORMATTED, monkeypatch)

    assert code == 0
    assert stdout == FORMATTED


def test_cli_without_subcommand_still_formats():
    result = subprocess.run(
        [sys.executable, "-m", "cfpb_backend"],
        input=UNFORMATTED,
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parents[1],
    )

    assert (result.returncode, result.stdout) == (0, FORMATTED)


def test_leaves_formatted_policy_alone(monkeypatch: pytest.MonkeyPatch):
    code, stdout, _ = _run(["format"], FORMATTED, monkeypatch)

    assert code == 0
    assert stdout == FORMATTED


def test_reports_a_syntax_error_on_stderr(monkeypatch: pytest.MonkeyPatch):
    code, stdout, stderr = _run(["format"], "bundle agent {{{ broken\n", monkeypatch)

    assert code == 1
    # Nothing on stdout, so a failure can never be mistaken for formatted policy.
    assert stdout == ""
    assert "Syntax error at line 1, column 1" in stderr


def test_accepts_empty_input(monkeypatch: pytest.MonkeyPatch):
    code, _, stderr = _run(["format"], "", monkeypatch)

    assert code == 0
    assert stderr == ""


def test_unexpected_errors_become_one_line_on_stderr(monkeypatch: pytest.MonkeyPatch):
    """A sidecar fault must not leak a traceback: stderr is shown verbatim in the UI."""

    def explode(*_args):
        raise RuntimeError("tree-sitter went sideways")

    monkeypatch.setattr("cfpb_backend.format_policy_fin_fout", explode)
    code, stdout, stderr = _run(["format"], FORMATTED, monkeypatch)

    assert code == 2
    assert stdout == ""
    assert stderr == "Formatting backend failed: RuntimeError: tree-sitter went sideways\n"


# --- init ---


def _options(directory: Path, **overrides) -> dict:
    return {
        "directory": str(directory),
        "name": "Web servers",
        "description": "Policy for the web tier",
        "masterfiles": "no",
        "git": False,
        **overrides,
    }


def _init(options, monkeypatch: pytest.MonkeyPatch) -> tuple[int, str, str]:
    return _run(["init"], options if isinstance(options, str) else json.dumps(options), monkeypatch)


def _cfbs_json(directory: Path) -> dict:
    return json.loads((directory / "cfbs.json").read_text())


def test_init_without_masterfiles_or_git(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    project = tmp_path / "project"
    code, stdout, stderr = _init(_options(project), monkeypatch)

    assert code == 0, stderr
    assert json.loads(stdout) == {"path": str(project), "masterfiles": None}
    assert _cfbs_json(project) == {
        "name": "Web servers",
        "description": "Policy for the web tier",
        "type": "policy-set",
        "git": False,
        "build": [],
    }
    assert sorted(os.listdir(project)) == ["cfbs.json"]
    # cfbs's chatter went to stderr, not into the JSON result.
    assert "Initialized an empty project" in stderr


def test_init_into_an_existing_empty_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    code, stdout, stderr = _init(_options(tmp_path), monkeypatch)

    assert code == 0, stderr
    assert json.loads(stdout)["path"] == str(tmp_path)
    assert _cfbs_json(tmp_path)["name"] == "Web servers"


def test_init_restores_the_cwd(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    before = os.getcwd()
    _init(_options(tmp_path / "project"), monkeypatch)

    assert os.getcwd() == before


def _log(directory: Path, format: str) -> list[str]:
    return subprocess.run(
        ["git", "log", f"--format={format}"], cwd=directory, capture_output=True, text=True, check=True
    ).stdout.splitlines()


@needs_git
def test_init_with_git_makes_one_commit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    project = tmp_path / "project"
    code, stdout, stderr = _init(_options(project, git=True), monkeypatch)

    assert code == 0, stderr
    assert json.loads(stdout) == {"path": str(project), "masterfiles": None}
    assert _cfbs_json(project)["git"] is True
    assert _log(project, "%s") == ["Initialized a new CFEngine Build project"]
    tracked = subprocess.run(["git", "ls-files"], cwd=project, capture_output=True, text=True).stdout
    assert tracked.split() == ["cfbs.json"]


CONTENT = {
    "meta": {
        "policy-builder": {"schema_version": 1, "folders": [], "files": [{"id": "f1", "path": "./policy/web.cf"}]}
    },
    "modules": [{"name": "./policy/web.cf", "added_by": "cfbs add", "steps": ["bundles web:main"]}],
}


@needs_git
def test_init_writes_the_builder_content_before_committing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    project = tmp_path / "project"
    code, _stdout, stderr = _init(_options(project, git=True, content=CONTENT), monkeypatch)

    assert code == 0, stderr
    config = _cfbs_json(project)
    assert config["meta"] == CONTENT["meta"]
    assert config["build"] == CONTENT["modules"]
    status = subprocess.run(["git", "status", "--porcelain"], cwd=project, capture_output=True, text=True).stdout
    assert status == ""


def test_init_rejects_malformed_content(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    project = tmp_path / "project"
    code, _stdout, _stderr = _init(_options(project, content={"meta": []}), monkeypatch)

    assert code == 2
    assert not project.exists()


@needs_git
def test_init_falls_back_to_the_cfbs_git_identity(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    for variable in ("GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"):
        monkeypatch.delenv(variable, raising=False)
    project = tmp_path / "project"
    code, _, stderr = _init(_options(project, git=True), monkeypatch)

    assert code == 0, stderr
    [author] = _log(project, "%an <%ae>")
    assert author.startswith("cfbs <cfbs@")


def test_init_refuses_a_non_empty_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "notes.txt").write_text("keep me")
    code, stdout, stderr = _init(_options(tmp_path), monkeypatch)

    assert code == 2
    assert stdout == ""
    assert "isn't an empty folder" in stderr
    assert os.listdir(tmp_path) == ["notes.txt"]


@pytest.mark.parametrize(
    "stdin",
    [
        "not json",
        "[]",
        json.dumps({"directory": "relative/path", "name": "x", "description": "", "masterfiles": "no", "git": False}),
        json.dumps({"name": "x", "description": "", "masterfiles": "no", "git": False}),
        json.dumps(
            {"directory": "/nope/missing/parent", "name": "x", "description": "", "masterfiles": "no", "git": 0}
        ),
    ],
)
def test_init_rejects_invalid_input(stdin: str, monkeypatch: pytest.MonkeyPatch):
    code, stdout, stderr = _init(stdin, monkeypatch)

    assert code == 2
    assert stdout == ""
    assert len(stderr.strip().splitlines()) == 1


@pytest.mark.parametrize("overrides", [{"masterfiles": "3.24.x"}, {"name": "  "}, {"git": "yes"}])
def test_init_rejects_bad_options(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, overrides: dict):
    project = tmp_path / "project"
    code, _, _ = _init(_options(project, **overrides), monkeypatch)

    assert code == 2
    assert not project.exists()


def test_init_rejects_a_missing_parent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    code, _, stderr = _init(_options(tmp_path / "missing" / "project"), monkeypatch)

    assert code == 2
    assert "Parent folder doesn't exist" in stderr


def _fail_after_writing(directory: str, masterfiles: str):
    Path(directory, "cfbs.json").write_text("{}")
    Path(directory, "modules").mkdir()
    raise cfpb_backend.InitFailed("Couldn't download masterfiles 3.27.1 — check your network connection.")


@pytest.mark.parametrize("existed", [False, True])
def test_init_cleans_up_on_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, existed: bool):
    project = tmp_path / "project"
    if existed:
        project.mkdir()
    monkeypatch.setattr("cfpb_backend._run_cfbs_init", _fail_after_writing)
    code, stdout, stderr = _init(_options(project), monkeypatch)

    assert code == 1
    assert stdout == ""
    assert stderr.strip().splitlines()[-1] == "Couldn't download masterfiles 3.27.1 — check your network connection."
    if existed:
        assert os.listdir(project) == []
    else:
        assert not project.exists()


def test_init_cleans_up_after_an_unexpected_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    def explode(*_args):
        raise OSError("disk full")

    project = tmp_path / "project"
    monkeypatch.setattr("cfpb_backend._update_cfbs_json", explode)
    code, _, stderr = _init(_options(project), monkeypatch)

    assert code == 1
    assert stderr.strip().splitlines()[-1] == "Init failed: OSError: disk full"
    assert not project.exists()


def test_init_reports_a_cfbs_download_failure_as_a_network_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    def offline(*_args, **_kwargs):
        raise __import__("cfbs.utils").utils.CFBSNetworkError("Failed to get JSON from 'https://example'")

    import cfbs.index

    monkeypatch.setattr(cfbs.index, "get_or_read_json", offline)
    monkeypatch.setattr(cfbs.index, "get_json", offline)
    project = tmp_path / "project"
    code, _, stderr = _init(_options(project, masterfiles="3.27.1"), monkeypatch)

    assert code == 1
    assert stderr.strip().splitlines()[-1] == "Couldn't download masterfiles 3.27.1 — check your network connection."
    assert not project.exists()


@network
@pytest.mark.parametrize("masterfiles", ["3.27.1", "master"])
def test_init_with_masterfiles(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, masterfiles: str):
    project = tmp_path / "project"
    code, stdout, stderr = _init(_options(project, masterfiles=masterfiles), monkeypatch)

    assert code == 0, stderr
    entry = json.loads(stdout)["masterfiles"]
    assert entry["name"] == "masterfiles"
    assert entry == _cfbs_json(project)["build"][0]
    assert entry.get("version", entry.get("branch")) == masterfiles
