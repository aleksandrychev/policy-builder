"""The `deploy` subcommand: `cf-remote deploy` run in-process inside the project folder."""

from __future__ import annotations

import io
import json
import os
from pathlib import Path

import pytest
from cf_remote import commands

from cfpb_backend import main


def _run(stdin: str, monkeypatch: pytest.MonkeyPatch) -> tuple[int, str, str]:
    stdout, stderr = io.StringIO(), io.StringIO()
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin))
    monkeypatch.setattr("sys.stdout", stdout)
    monkeypatch.setattr("sys.stderr", stderr)
    return main(["deploy"]), stdout.getvalue(), stderr.getvalue()


def _fake_deploy(monkeypatch: pytest.MonkeyPatch, outcome=0) -> list[dict]:
    """Replaces cf-remote's deploy; records each call. `outcome` is returned, or raised if an exception."""
    calls = []

    def deploy(hubs, masterfiles):
        calls.append(
            {"hubs": hubs, "masterfiles": masterfiles, "cwd": os.getcwd(), "key": os.environ.get("CF_REMOTE_SSH_KEY")}
        )
        print("Deploying to hub...")
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    monkeypatch.setattr(commands, "deploy", deploy)
    return calls


@pytest.fixture(autouse=True)
def _no_key(monkeypatch: pytest.MonkeyPatch):
    """deploy sets CF_REMOTE_SSH_KEY in os.environ; monkeypatch restores it afterwards."""
    monkeypatch.delenv("CF_REMOTE_SSH_KEY", raising=False)


@pytest.mark.parametrize(
    "stdin",
    [
        "not json",
        "[]",
        "{}",
        '{"host": "root@hub"}',
        '{"path": "relative/project", "host": "root@hub"}',
        '{"path": "/abs/project"}',
        '{"path": "/abs/project", "host": 42}',
        '{"path": "/abs/project", "host": "-Fx@hub"}',
        '{"path": "/abs/project", "host": "root@-oProxyCommand=x"}',
    ],
)
def test_deploy_rejects_invalid_input_in_one_line(stdin: str, monkeypatch: pytest.MonkeyPatch):
    calls = _fake_deploy(monkeypatch)

    code, stdout, stderr = _run(stdin, monkeypatch)

    assert code == 2
    assert stdout == ""
    assert len(stderr.strip().splitlines()) == 1
    assert stderr.startswith('Expected {"path"')
    assert calls == []


def test_deploy_runs_cf_remote_inside_the_project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    calls = _fake_deploy(monkeypatch)
    cwd = os.getcwd()

    code, stdout, stderr = _run(json.dumps({"path": str(tmp_path), "host": "root@hub:2222"}), monkeypatch)

    assert code == 0
    assert json.loads(stdout) == {"deployed": True, "log": "Deploying to hub...\n"}
    assert stdout.count("\n") == 1  # the JSON line only: cf-remote's output went to the log
    assert calls == [{"hubs": ["root@hub:2222"], "masterfiles": None, "cwd": str(tmp_path), "key": None}]
    assert os.getcwd() == cwd
    assert stderr.startswith("::stage deploy\n")
    assert "Deploying to hub..." in stderr


def test_deploy_keeps_output_written_to_fd_1_off_stdout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capfd):
    """Children cf-remote spawns write to fd 1 directly; it must point at stderr meanwhile."""

    def deploy(hubs, masterfiles):
        os.write(1, b"from a child process\n")
        return 0

    monkeypatch.setattr(commands, "deploy", deploy)
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({"path": str(tmp_path), "host": "root@hub"})))

    assert main(["deploy"]) == 0
    out, err = capfd.readouterr()
    assert json.loads(out) == {"deployed": True, "log": ""}
    assert "from a child process" in err


def test_deploy_reports_cf_remote_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    _fake_deploy(monkeypatch, outcome=1)

    code, stdout, _ = _run(json.dumps({"path": str(tmp_path), "host": "root@hub"}), monkeypatch)

    assert code == 0
    assert json.loads(stdout) == {"deployed": False, "log": "Deploying to hub...\n"}


@pytest.mark.parametrize(
    "error, logged",
    [
        (RuntimeError("ssh: connect to host hub port 22: Connection refused"), "RuntimeError: ssh: connect to host"),
        (SystemExit("No masterfiles.tgz in out/"), "SystemExit: No masterfiles.tgz in out/"),
    ],
)
def test_deploy_reports_a_crash_in_the_log(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, error, logged):
    _fake_deploy(monkeypatch, outcome=error)
    cwd = os.getcwd()

    code, stdout, _ = _run(json.dumps({"path": str(tmp_path), "host": "root@hub"}), monkeypatch)

    assert code == 0
    result = json.loads(stdout)
    assert result["deployed"] is False
    assert result["log"].startswith("Deploying to hub...\n")
    assert logged in result["log"]
    assert os.getcwd() == cwd


def test_deploy_passes_a_key_through_the_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    calls = _fake_deploy(monkeypatch)
    request = {"path": str(tmp_path), "host": "root@hub", "key": "/home/me/.ssh/hub_ed25519"}

    _run(json.dumps(request), monkeypatch)

    assert calls[0]["key"] == "/home/me/.ssh/hub_ed25519"


@pytest.mark.parametrize("key", [None, ""])
def test_deploy_without_a_key_leaves_the_environment_alone(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, key):
    calls = _fake_deploy(monkeypatch)

    _run(json.dumps({"path": str(tmp_path), "host": "root@hub", "key": key}), monkeypatch)

    assert calls[0]["key"] is None
    assert "CF_REMOTE_SSH_KEY" not in os.environ
