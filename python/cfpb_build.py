"""Deployment's Build step: `cfbs build` in the project folder, then the policy checked twice:
cfengine_cli's linter on the project's own files, and cf-promises on the whole policy set (the
local one if CFEngine is installed, else in a cached test-host image when Docker has one)."""

from __future__ import annotations

import contextlib
import io
import os
import re
import shutil
import subprocess
import sys
import tarfile

# Where cfbs puts a project's own files in the policy set.
OWN_FILES = "services/cfbs/"
LINT_ERROR = re.compile(r"^Error: (.*) at (.+?):(\d+):\d+$")
PROMISES_ERROR = re.compile(r"^(.+?):(\d+):\d+: error: (.*)$")
CF_PROMISES = ("/var/cfengine/bin/cf-promises", "/usr/local/sbin/cf-promises")


def stage(name: str) -> None:
    """Tells main which step is running (a `::stage` line on stderr, which it streams)."""
    print(f"::stage {name}", file=sys.stderr, flush=True)


class BuildFailed(Exception):
    """cfbs build itself failed: no policy set to check."""


def ensure_gitignore(directory: str) -> None:
    """Keeps cfbs's build output out of git."""
    path = os.path.join(directory, ".gitignore")
    lines = open(path, encoding="utf-8").read().splitlines() if os.path.exists(path) else []
    if not any(line.strip().rstrip("/") in ("out", "/out") for line in lines):
        with open(path, "a", encoding="utf-8") as file:
            file.write(("\n" if lines and lines[-1] else "") + "out/\n")


def _project_path(path: str, root: str) -> str | None:
    """A file's path as the project names it ("./security.cf"), from the project or the policy set."""
    path = os.path.abspath(path)
    built = os.path.join(root, "out", "masterfiles", OWN_FILES)
    for base in (built, root + os.sep):
        if path.startswith(base):
            return "./" + os.path.relpath(path, base)
    return None


def lint(directory: str) -> dict:
    """cfengine_cli's linter over the whole policy set (so stdlib bundles and bodies are known),
    keeping what it finds in the project's own files: masterfiles has strict-mode findings of its own."""
    from cfbs.cfbs_config import CFBSConfig
    from cfengine_cli.lint import lint_args

    # The linter reads cfbs's config singleton too; the build just left it set to the project.
    CFBSConfig.instance = None
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        lint_args([os.path.join(directory, "out", "masterfiles")])
    built = os.path.join(directory, "out", "masterfiles", OWN_FILES)
    problems = []
    for line in output.getvalue().splitlines():
        match = LINT_ERROR.match(line.strip())
        if match and os.path.abspath(match.group(2)).startswith(built):
            problems.append(
                {
                    "message": match.group(1),
                    "file": _project_path(match.group(2), directory),
                    "line": int(match.group(3)),
                }
            )
    return {"ok": not problems, "problems": problems}


def _parse_promises(output: str, root: str, prefix: str) -> list[dict]:
    problems = []
    for line in output.splitlines():
        match = PROMISES_ERROR.match(line.strip())
        if match:
            path = match.group(1)
            if prefix and path.startswith(prefix):
                path = os.path.join(root, "out", "masterfiles", path[len(prefix) :])
            problems.append(
                {
                    "message": match.group(3),
                    "file": _project_path(path, root) or match.group(1),
                    "line": int(match.group(2)),
                }
            )
    return problems


def _local_cf_promises() -> str | None:
    return shutil.which("cf-promises") or next((path for path in CF_PROMISES if os.access(path, os.X_OK)), None)


def validate(directory: str) -> dict:
    """cf-promises on the built policy set: `how` says where it ran, or why it couldn't."""
    masterfiles = os.path.join(directory, "out", "masterfiles")
    binary = _local_cf_promises()
    if binary:
        result = subprocess.run(
            [binary, "-f", os.path.join(masterfiles, "promises.cf")], capture_output=True, text=True, timeout=120
        )
        problems = _parse_promises(result.stdout + result.stderr, directory, "")
        return {"ok": result.returncode == 0 and not problems, "how": "local", "problems": problems}
    return _validate_in_docker(directory, masterfiles)


def _validate_in_docker(directory: str, masterfiles: str) -> dict:
    try:
        import cfpb_testenv

        engine = cfpb_testenv.client()
        images = [tag for image in engine.images.list() for tag in image.tags if tag.startswith("cfpb-cache/")]
    except Exception:  # no Docker, or it isn't running
        return {
            "ok": None,
            "how": "skipped",
            "problems": [],
            "message": "Install CFEngine or start Docker to check with cf-promises.",
        }
    if not images:
        return {
            "ok": None,
            "how": "skipped",
            "problems": [],
            "message": "Start a test host once (Test Results & Logs) to check with cf-promises.",
        }
    container = engine.containers.run(images[0], "sleep infinity", detach=True)
    try:
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as archive:
            archive.add(masterfiles, arcname="masterfiles")
        container.put_archive("/tmp", buffer.getvalue())
        code, output = container.exec_run(["/var/cfengine/bin/cf-promises", "-f", "/tmp/masterfiles/promises.cf"])
        text = output.decode("utf-8", "replace")
        problems = _parse_promises(text, directory, "/tmp/masterfiles/")
        return {"ok": code == 0 and not problems, "how": "docker", "problems": problems}
    finally:
        container.remove(force=True)


def build(directory: str) -> dict:
    """Builds the project's policy set; returns the tarball and both checks' results."""
    import cfbs.main
    from cfbs.cfbs_config import CFBSConfig

    import cfpb_backend

    if not os.path.isfile(os.path.join(directory, "cfbs.json")):
        raise BuildFailed(f"No cfbs.json in {directory}")
    ensure_gitignore(directory)
    stage("build")
    CFBSConfig.instance = None
    with cfpb_backend._cfbs_session(directory, ["build"]) as tee:
        code = cfbs.main.main()
    log = "".join(tee.chunks).splitlines()
    if code != 0:
        raise BuildFailed(next((line for line in reversed(log) if line.strip()), f"cfbs build failed (exit {code})"))
    tarball = os.path.join(directory, "out", "masterfiles.tgz")
    stage("lint")
    linted = lint(directory)
    stage("promises")
    validated = validate(directory)
    return {
        "tarball": tarball if os.path.exists(tarball) else None,
        "masterfiles": os.path.join(directory, "out", "masterfiles"),
        "log": log[-200:],
        "lint": linted,
        "promises": validated,
    }
