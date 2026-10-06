"""CFEngine toolchain sidecar: one process per user action, result on stdout,
diagnostics on stderr, non-zero exit on failure.

  cfpb-backend [format]   policy on stdin -> formatted policy on stdout
  cfpb-backend init       JSON options on stdin -> JSON result on stdout
  cfpb-backend compile    builder project on stdin -> {"files": {path: policy}} on stdout
  cfpb-backend masterfiles  {"version"} on stdin -> the masterfiles build entry on stdout
  cfpb-backend build      {"path"} on stdin -> the built policy set and its checks on stdout

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

from cfpb_compiler import CompileError, compile_project, templates_module

LINE_LENGTH = 80
INIT_COMMIT_MESSAGE = "Initialized a new CFEngine Build project"
# The builder's own data (project.json), next to cfbs.json, which stays plain cfbs.
BUILDER_DIR = ".policy-builder"
# A cfbs module name (cfbs validates a module project's name this way).
MODULE_NAME = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")
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
    options.setdefault("type", "policy-set")
    if options["type"] not in ("policy-set", "module"):
        raise InvalidInput(f"Unsupported project type: {options['type']}")
    content = options.get("content")
    if content is not None and not (
        isinstance(content, dict)
        and isinstance(content.get("project"), dict)
        and isinstance(content.get("modules"), list)
        and isinstance(content.get("provided", {}), dict)
        and isinstance(content.get("testEnvironments", []), list)
    ):
        raise InvalidInput('"content" must be {"project": {...}, "modules": [...], "provided": {...}}')
    if options["type"] == "module":
        name = (content or {}).get("project", {}).get("module_name")
        if not isinstance(name, str) or not MODULE_NAME.match(name):
            raise InvalidInput("A module needs a module name: lowercase letters, digits and dashes")
        if not isinstance(content.get("provided"), dict):
            raise InvalidInput('A module needs its "provided" module')

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
    module = options["type"] == "module"
    if module:
        # No cfbs init for a module (it has no masterfiles): its cfbs.json is just what it provides.
        config = OrderedDict([("type", "module"), ("provides", OrderedDict())])
    else:
        with open(path, encoding="utf-8") as file:
            config = json.load(file, object_pairs_hook=OrderedDict)
    content = options.get("content")
    # A module's name is its module name (cfbs validates it); the display name stays in project.json.
    config["name"] = content["project"]["module_name"] if module else options["name"]
    config["description"] = options["description"]
    config["git"] = options["git"]  # what `cfbs init --git=yes` would have written
    # The builder's modules, its generated policy and its own data, in before the initial commit.
    if content:
        files = compile_project(content["project"])
        _write_policy(directory, files)
        # What this save generated, so the next one can remove what it no longer does.
        project = {**content["project"], "generated": list(files)}
        os.makedirs(os.path.join(directory, BUILDER_DIR), exist_ok=True)
        with open(os.path.join(directory, BUILDER_DIR, "project.json"), "w", encoding="utf-8") as file:
            file.write(json.dumps(project, indent=2) + "\n")
        environments = content.get("testEnvironments")
        if environments:
            with open(os.path.join(directory, BUILDER_DIR, "test-environments.json"), "w", encoding="utf-8") as file:
                file.write(json.dumps({"environments": environments}, indent=2, ensure_ascii=False) + "\n")
        if module:
            config["provides"][config["name"]] = _with_templates(content["provided"], config["name"], files)
        else:
            templates = templates_module(files)
            config["build"] = [*config.get("build", []), *content["modules"], *([templates] if templates else [])]
    with open(path, "w", encoding="utf-8") as file:
        file.write(pretty(config, CFBS_DEFAULT_SORTING_RULES) + "\n")
    return config


def _with_templates(provided: dict, module_name: str, files: dict[str, str]) -> dict:
    """A module ships its templates with a copy step, before its policy_files."""
    if not any(path.startswith("./templates/") for path in files):
        return provided
    steps = list(provided["steps"])
    at = next((i for i, step in enumerate(steps) if step.startswith("policy_files ")), len(steps))
    steps.insert(at, f"copy ./templates/ services/cfbs/{module_name}/templates/")
    return {**provided, "steps": steps}


def _write_policy(directory: str, files: dict[str, str]) -> None:
    for path, policy in files.items():
        target = os.path.normpath(os.path.join(directory, path))
        inside = target.startswith(directory + os.sep) and not target.startswith(
            os.path.join(directory, "out") + os.sep
        )
        if not inside or not target.endswith((".cf", ".mustache")):
            raise InitFailed(f"Refusing to write policy outside the project: {path}")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as file:
            file.write(policy)


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
        if options["type"] == "policy-set":
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
    if options["type"] == "policy-set" and options["masterfiles"] != "no":
        build = config.get("build", [])
        masterfiles = next(
            (entry for entry in build if entry.get("name") == "masterfiles"), build[0] if build else None
        )
    print(json.dumps({"path": directory, "masterfiles": masterfiles}))
    return 0


def masterfiles_command() -> int:
    """The masterfiles build entry cfbs init writes for a version, from a throwaway project:
    for turning a module into a policy set."""
    import tempfile

    try:
        version = json.loads(sys.stdin.read()).get("version")
    except (json.JSONDecodeError, AttributeError):
        version = None
    if not isinstance(version, str) or not MASTERFILES.match(version) or version == "no":
        print('Expected {"version": "<x.y.z>" or "master"} on stdin', file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory() as scratch:
        try:
            _run_cfbs_init(scratch, version)
            with open(os.path.join(scratch, "cfbs.json"), encoding="utf-8") as file:
                build = json.load(file, object_pairs_hook=OrderedDict).get("build", [])
        except Exception as error:
            print(str(error) if isinstance(error, InitFailed) else f"masterfiles failed: {error}", file=sys.stderr)
            return 1
    entry = next((module for module in build if module.get("name") == "masterfiles"), None)
    if entry is None:
        print(f"cfbs init added no masterfiles for {version}", file=sys.stderr)
        return 1
    print(json.dumps(entry))
    return 0


def compile_command() -> int:
    try:
        meta = json.loads(sys.stdin.read())
        if not isinstance(meta, dict):
            raise CompileError("Expected a JSON object on stdin")
        source_map: dict = {}
        files = compile_project(meta, source_map=source_map)
    except (json.JSONDecodeError, CompileError) as error:
        print(f"Couldn't generate the policy: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"Policy compiler failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 2
    print(json.dumps({"files": files, "source_map": source_map}))
    return 0


def build_command() -> int:
    """Deployment: cfbs build in a saved project, then lint + cf-promises (cfpb_build)."""
    import cfpb_build

    try:
        request = json.loads(sys.stdin.read() or "{}")
        path = request.get("path") if isinstance(request, dict) else None
        if not isinstance(path, str) or not os.path.isabs(path):
            raise cfpb_build.BuildFailed('Expected {"path": <absolute project folder>} on stdin')
        result = cfpb_build.build(path)
    except (json.JSONDecodeError, cfpb_build.BuildFailed) as error:
        print(f"Build failed: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"Build failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result))
    return 0


def deploy_command() -> int:
    """Deployment: `cf-remote deploy` as is, run in the built cfbs project (it ships out/masterfiles.tgz)."""
    try:
        request = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        request = None
    path = request.get("path") if isinstance(request, dict) else None
    if not isinstance(path, str) or not os.path.isabs(path) or not isinstance(request.get("host"), str):
        print(
            'Expected {"path": <absolute project folder>, "host": "user@host[:port]", "key": <path> | null}',
            file=sys.stderr,
        )
        return 2
    key = request.get("key")
    if key:
        os.environ["CF_REMOTE_SSH_KEY"] = key  # cf-remote's only way to take a key
    print("::stage deploy", file=sys.stderr, flush=True)
    tee = _Tee(sys.stderr)
    saved_cwd = os.getcwd()
    # cf-remote prints its progress to stdout, which is our result channel.
    sys.stdout.flush()
    saved_fd = os.dup(1)
    os.dup2(2, 1)
    try:
        os.chdir(path)
        with contextlib.redirect_stdout(tee):
            from cf_remote import commands

            errors = commands.deploy([request["host"]], None)
    except BaseException as error:  # cf-remote exits through SystemExit too
        errors = 1
        tee.chunks.append(f"{type(error).__name__}: {error}\n")
    finally:
        os.chdir(saved_cwd)
        sys.stderr.flush()
        os.dup2(saved_fd, 1)
        os.close(saved_fd)
    print(json.dumps({"deployed": not errors, "log": "".join(tee.chunks)}))
    return 0


def testenv_command(action: str) -> int:
    """Test environments (cfpb_testenv): `doctor`, `images`, `package`, `platforms`, `search`, `status` answer with one JSON
    object; the rest stream events, one JSON object per line, ending with a `done` or `error` event."""
    import cfpb_testenv

    try:
        query = json.loads(sys.stdin.read() or "{}") if action not in ("doctor", "images") else {}
        if not isinstance(query, dict):
            raise cfpb_testenv.RunnerError("Expected a JSON object on stdin")
        if isinstance(query.get("cacheDir"), str):
            cfpb_testenv.CACHE_DIR = query["cacheDir"]
        if action == "pull":
            image = query.get("image")
            if image not in {p["image"] for p in cfpb_testenv.PLATFORMS.values()}:
                raise cfpb_testenv.RunnerError(f"Not a supported base image: {image}")
            cfpb_testenv.pull(image)
            cfpb_testenv.emit("done")
            return 0
        streaming = {
            "up": cfpb_testenv.up,
            "run": cfpb_testenv.run,
            "test": cfpb_testenv.test,
            "exec": cfpb_testenv.execute,
            "stop": cfpb_testenv.stop,
            "start": cfpb_testenv.start,
            "destroy": cfpb_testenv.destroy,
            "reset": cfpb_testenv.reset,
        }
        if action == "inspect":
            cfpb_testenv.inspect(query)
            return 0
        if action in streaming:
            if not isinstance(query.get("environment"), dict):
                raise cfpb_testenv.RunnerError('"environment" must be an object')
            streaming[action](query)
            return 0
        answers = {"doctor": cfpb_testenv.doctor, "images": cfpb_testenv.images}
        queries = {
            "package": cfpb_testenv.package,
            "status": cfpb_testenv.status,
            "platforms": cfpb_testenv.platforms,
            "search": cfpb_testenv.search,
        }
        result = answers[action]() if action in answers else queries[action](query)
        print(json.dumps(result))
        return 0
    except (json.JSONDecodeError, cfpb_testenv.RunnerError) as error:
        message = str(error)
    except Exception as error:  # Docker SDK / network errors: one line for the UI
        message = f"{type(error).__name__}: {error}"
    if action in ("pull", "inspect", "up", "run", "test", "exec", "start", "stop", "destroy", "reset"):
        cfpb_testenv.emit("error", message=message)
    print(message, file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    # Windows would otherwise decode stdio with the ANSI code page.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(prog="cfpb-backend")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("format", help="format CFEngine policy (the default)")
    commands.add_parser("init", help="create a cfbs project")
    commands.add_parser("compile", help="generate policy from the builder's project data")
    commands.add_parser("masterfiles", help="the masterfiles build entry for a version")
    commands.add_parser("build", help="build a saved project's policy set and check it")
    commands.add_parser("deploy", help="deploy a built policy set to a hub with cf-remote")
    testenv = commands.add_parser("testenv", help="test environments (Docker hosts)")
    testenv.add_argument(
        "action",
        choices=[
            "doctor",
            "images",
            "package",
            "platforms",
            "pull",
            "inspect",
            "search",
            "status",
            "up",
            "run",
            "test",
            "exec",
            "start",
            "stop",
            "destroy",
            "reset",
        ],
    )
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    if args.command == "testenv":
        return testenv_command(args.action)

    commands = {
        "init": init_command,
        "compile": compile_command,
        "masterfiles": masterfiles_command,
        "build": build_command,
        "deploy": deploy_command,
    }
    return commands.get(args.command, format_command)()


if __name__ == "__main__":
    sys.exit(main())
