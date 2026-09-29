"""CFEngine toolchain sidecar: one process per user action, result on stdout,
diagnostics on stderr, non-zero exit on failure.

  cfpb-backend [format]   policy on stdin -> formatted policy on stdout
  cfpb-backend init       JSON options on stdin -> JSON result on stdout

Calls cfengine_cli and cfbs in-process. Import cfengine_cli.format, never
cfengine_cli.main — that one pulls in cf_remote and ~27 MB of libcloud.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from collections import OrderedDict
from typing import Iterator

from cfengine_cli.format import format_policy_fin_fout
from cfengine_cli.lint import PolicySyntaxError

LINE_LENGTH = 80
INIT_COMMIT_MESSAGE = "Initialized a new CFEngine Build project"
# Exact versions, "master", or "no". cfbs 5.7.0 mishandles branch names like 3.24.x.
MASTERFILES = re.compile(r"^(\d+\.\d+\.\d+(-\d+)?|master|no)$")
# Substrings of cfbs/git output that mean the download failed, not the input.
NETWORK_HINTS = ("network", "failed to fetch", "failed to get json", "failed to find branch", "could not resolve")


class InvalidInput(Exception):
    """Bad request: exit 2, nothing touched."""


class InitFailed(Exception):
    """Init went wrong after we started touching the disk: exit 1, cleaned up."""


def format_command() -> int:
    try:
        format_policy_fin_fout(sys.stdin, sys.stdout, LINE_LENGTH, False)
    except PolicySyntaxError as error:
        # Expected: the editor holds a live buffer, so invalid policy is normal.
        # Upstream's message names a "<stdin>" file, meaningless in a textarea.
        print(f"Syntax error at line {error.line}, column {error.column}", file=sys.stderr)
        return 1
    except Exception as error:
        # A sidecar or packaging fault. One line: the renderer shows stderr verbatim.
        print(f"Formatting backend failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 2
    return 0


def _parse_init_options(text: str) -> dict:
    try:
        options = json.loads(text)
    except json.JSONDecodeError as error:
        raise InvalidInput(f"Invalid JSON on stdin: {error}")
    if not isinstance(options, dict):
        raise InvalidInput("Expected a JSON object on stdin")

    for key, kind in (("directory", str), ("name", str), ("description", str), ("masterfiles", str), ("git", bool)):
        if not isinstance(options.get(key), kind):
            raise InvalidInput(f'"{key}" must be a {"boolean" if kind is bool else "string"}')

    directory = options["directory"]
    if not os.path.isabs(directory):
        raise InvalidInput(f"Directory must be an absolute path: {directory}")
    directory = os.path.normpath(directory)
    if not os.path.isdir(os.path.dirname(directory)):
        raise InvalidInput(f"Parent folder doesn't exist: {os.path.dirname(directory)}")
    if os.path.lexists(directory) and (not os.path.isdir(directory) or os.listdir(directory)):
        raise InvalidInput(f"{directory} already exists and isn't an empty folder")
    if not options["name"].strip():
        raise InvalidInput("Project name must not be empty")
    if not MASTERFILES.match(options["masterfiles"]):
        raise InvalidInput(f"Unsupported masterfiles value: {options['masterfiles']}")
    content = options.get("content")
    if content is not None and not (
        isinstance(content, dict)
        and isinstance(content.get("builder"), dict)
        and isinstance(content.get("modules"), list)
    ):
        raise InvalidInput('"content" must be {"builder": {...}, "modules": [...]}')

    return {**options, "directory": directory}


class _Tee:
    """Writes to stderr and keeps a copy, so failures can be classified."""

    def __init__(self, stream):
        self.stream, self.chunks = stream, []

    def write(self, text: str) -> int:
        self.chunks.append(text)
        return self.stream.write(text)

    def flush(self):
        self.stream.flush()


@contextlib.contextmanager
def _cfbs_session(directory: str, argv: list[str]) -> Iterator[_Tee]:
    """cfbs reads sys.argv, prints to stdout and works in the cwd; contain all three."""
    tee = _Tee(sys.stderr)
    saved_argv, saved_cwd = sys.argv, os.getcwd()
    # Children cfbs spawns inherit fd 1 too, so point it at stderr as well.
    sys.stdout.flush()
    saved_fd = os.dup(1)
    os.dup2(2, 1)
    try:
        sys.argv = ["cfbs", *argv]
        os.chdir(directory)
        with contextlib.redirect_stdout(tee):
            yield tee
    finally:
        os.chdir(saved_cwd)
        sys.argv = saved_argv
        sys.stderr.flush()
        os.dup2(saved_fd, 1)
        os.close(saved_fd)


def _run_cfbs_init(directory: str, masterfiles: str) -> None:
    import cfbs.main
    from cfbs.cfbs_config import CFBSConfig

    CFBSConfig.instance = None  # process-wide singleton; stale if init ran before in this process
    argv = ["--non-interactive", f"--masterfiles={masterfiles}", "--git=no", "init"]
    with _cfbs_session(directory, argv) as tee:
        code = cfbs.main.main()
    if code == 0:
        return

    output = "".join(tee.chunks)
    if masterfiles != "no" and any(hint in output.lower() for hint in NETWORK_HINTS):
        raise InitFailed(f"Couldn't download masterfiles {masterfiles} — check your network connection.")
    errors = [line[len("Error: ") :] for line in output.splitlines() if line.startswith("Error: ")]
    raise InitFailed(f"cfbs init failed: {errors[-1]}" if errors else f"cfbs init failed (exit {code})")


def _update_cfbs_json(directory: str, options: dict) -> dict:
    from cfbs.pretty import CFBS_DEFAULT_SORTING_RULES, pretty

    path = os.path.join(directory, "cfbs.json")
    with open(path, encoding="utf-8") as file:
        config = json.load(file, object_pairs_hook=OrderedDict)
    config["name"] = options["name"]
    config["description"] = options["description"]
    config["git"] = options["git"]  # what `cfbs init --git=yes` would have written
    # The builder's own state (see blocks/README.md), in before the initial commit.
    content = options.get("content")
    if content:
        config["builder"] = content["builder"]
        config["build"] = [*config.get("build", []), *content["modules"]]
    with open(path, "w", encoding="utf-8") as file:
        file.write(pretty(config, CFBS_DEFAULT_SORTING_RULES) + "\n")
    return config


def _git(directory: str, *args: str, echo: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(["git", *args], cwd=directory, capture_output=True, text=True)
    for output in (result.stdout, result.stderr) if echo else ():
        if output.strip():
            print(output.rstrip(), file=sys.stderr)
    return result


def _git_commit_all(directory: str) -> None:
    for args in (("init", "--quiet"), ("add", "--all")):
        if _git(directory, *args).returncode != 0:
            raise InitFailed(f"git {args[0]} failed")
    # Same fallback identity cfbs uses when git has none configured.
    identity = []
    for key, fallback in (("user.name", "cfbs"), ("user.email", f"cfbs@{socket.gethostname()}")):
        if not _git(directory, "config", key, echo=False).stdout.strip():
            identity += ["-c", f"{key}={fallback}"]
    if _git(directory, *identity, "commit", "--quiet", "-m", INIT_COMMIT_MESSAGE).returncode != 0:
        raise InitFailed("git commit failed")


def _clean_up(directory: str, created: bool) -> None:
    if created:
        shutil.rmtree(directory, ignore_errors=True)
        return
    # It was empty before we started, so everything in it is ours.
    for entry in os.listdir(directory):
        path = os.path.join(directory, entry)
        if os.path.isdir(path) and not os.path.islink(path):
            shutil.rmtree(path, ignore_errors=True)
        else:
            os.unlink(path)


def init_command() -> int:
    try:
        options = _parse_init_options(sys.stdin.read())
    except InvalidInput as error:
        print(error, file=sys.stderr)
        return 2

    # masterfiles from a branch is a git clone, even without our own git step.
    if (options["git"] or options["masterfiles"] == "master") and not shutil.which("git"):
        print("Git isn't installed or isn't on PATH — install it, or create the project without git.", file=sys.stderr)
        return 1

    directory = options["directory"]
    created = not os.path.exists(directory)
    try:
        if created:
            os.mkdir(directory)
        _run_cfbs_init(directory, options["masterfiles"])
        config = _update_cfbs_json(directory, options)
        if options["git"]:
            _git_commit_all(directory)
    except Exception as error:
        _clean_up(directory, created)
        message = str(error) if isinstance(error, InitFailed) else f"Init failed: {type(error).__name__}: {error}"
        print(message, file=sys.stderr)
        return 1

    masterfiles = None
    if options["masterfiles"] != "no":
        build = config.get("build", [])
        masterfiles = next(
            (entry for entry in build if entry.get("name") == "masterfiles"), build[0] if build else None
        )
    print(json.dumps({"path": directory, "masterfiles": masterfiles}))
    return 0


def main(argv: list[str] | None = None) -> int:
    # Windows would otherwise decode stdio with the ANSI code page.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(prog="cfpb-backend")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("format", help="format CFEngine policy (the default)")
    commands.add_parser("init", help="create a cfbs project")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    return init_command() if args.command == "init" else format_command()


if __name__ == "__main__":
    sys.exit(main())
