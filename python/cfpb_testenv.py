"""Test environments: Docker containers that run the generated policy (the Test Results & Logs tab).

Talks to the Docker Engine through the official SDK. Long operations stream their progress as
one JSON event per line on stdout (see `emit`); everything else answers with one JSON object.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import urllib.request
from pathlib import Path

# The base images a host can run, and the CFEngine package platform each one takes.
PLATFORMS = {
    "ubuntu-22": {"label": "Ubuntu 22.04", "image": "ubuntu:22.04", "package": "ubuntu_22"},
    "ubuntu-24": {"label": "Ubuntu 24.04", "image": "ubuntu:24.04", "package": "ubuntu_24"},
    "debian-12": {"label": "Debian 12", "image": "debian:12", "package": "debian_12"},
}
RELEASES = "https://cfengine.com/release-data/{edition}/releases.json"
HTTP_TIMEOUT = 20


class RunnerError(Exception):
    """A problem worth showing as is (the sidecar's one-line summary)."""


def emit(event: str, **fields) -> None:
    """One streamed event: a JSON object per line, flushed so main sees it at once."""
    try:
        print(json.dumps({"t": event, **fields}), flush=True)
    except BrokenPipeError:
        # Nobody's reading any more (the run was cancelled): stop without a traceback.
        os._exit(1)


# --- the Docker Engine ------------------------------------------------------


def _context_host(home: Path, environ: dict) -> str | None:
    """The endpoint of the current docker context (`docker context use`), unless it's "default"."""
    name = environ.get("DOCKER_CONTEXT")
    if not name:
        try:
            name = json.loads((home / ".docker" / "config.json").read_text()).get("currentContext")
        except (OSError, ValueError):
            return None
    if not name or name == "default":
        return None
    meta = home / ".docker" / "contexts" / "meta" / hashlib.sha256(name.encode()).hexdigest() / "meta.json"
    try:
        return json.loads(meta.read_text())["Endpoints"]["docker"]["Host"]
    except (OSError, ValueError, KeyError, TypeError):
        return None


def docker_host(home: Path | None = None, environ: dict | None = None) -> str | None:
    """Where the Docker Engine listens: DOCKER_HOST, the current context, or the first socket
    that exists. docker.from_env() only knows DOCKER_HOST and /var/run/docker.sock, which misses
    Docker Desktop (~/.docker/run), Colima and OrbStack."""
    home = home or Path.home()
    environ = os.environ if environ is None else environ
    if environ.get("DOCKER_HOST"):
        return environ["DOCKER_HOST"]
    context = _context_host(home, environ)
    if context:
        return context
    if sys.platform == "win32":
        return "npipe:////./pipe/docker_engine"
    for socket in (
        Path("/var/run/docker.sock"),
        home / ".docker/run/docker.sock",
        home / ".colima/default/docker.sock",
        home / ".orbstack/run/docker.sock",
        home / ".rd/docker.sock",
    ):
        if socket.exists():
            return f"unix://{socket}"
    return None


def client():
    import docker

    host = docker_host()
    if host is None:
        raise RunnerError("Docker isn't installed (no Docker Engine socket found)")
    return docker.DockerClient(base_url=host, timeout=30)


def _docker_installed() -> bool:
    apps = [Path("/Applications/Docker.app"), Path("/Applications/OrbStack.app")]
    return bool(shutil.which("docker") or shutil.which("colima") or any(app.exists() for app in apps))


def doctor() -> dict:
    """Docker's state for the tab: available, or why not (not installed / not running)."""
    host = docker_host()
    if host is None:
        problem = "not_running" if _docker_installed() else "not_installed"
        message = "Start Docker, then retry." if problem == "not_running" else "Install Docker to run test hosts."
        return {"available": False, "problem": problem, "message": message, "host": None}
    try:
        engine = client()
        engine.ping()
        info = engine.info()
        version = engine.version().get("Version")
    except Exception as error:  # the SDK raises several types for a dead socket
        return {
            "available": False,
            "problem": "not_running",
            "message": f"Docker isn't responding: {error}",
            "host": host,
        }
    return {
        "available": True,
        "problem": None,
        "message": f"Docker {version} ({info.get('OperatingSystem')}, {info.get('Architecture')})",
        "host": host,
        "version": version,
        "arch": info.get("Architecture"),
    }


def images() -> dict:
    """Each platform's base image, and whether it's pulled already."""
    engine = client()
    present = {tag for image in engine.images.list() for tag in image.tags}
    return {
        "platforms": [
            {"id": key, "label": p["label"], "image": p["image"], "present": p["image"] in present}
            for key, p in PLATFORMS.items()
        ]
    }


def pull(image: str) -> None:
    """Pulls an image, streaming `progress` events (bytes over all layers) and `log` lines."""
    repository, _, tag = image.partition(":")
    layers: dict[str, tuple[int, int]] = {}
    last = -1
    for status in client().api.pull(repository, tag=tag or "latest", stream=True, decode=True):
        if "error" in status:
            raise RunnerError(status["error"])
        detail = status.get("progressDetail") or {}
        if status.get("id") and detail.get("total"):
            layers[status["id"]] = (detail.get("current", 0), detail["total"])
        elif status.get("id") and status.get("status") in ("Pull complete", "Already exists"):
            total = layers.get(status["id"], (0, 0))[1]
            layers[status["id"]] = (total, total)
        current, total = sum(c for c, _ in layers.values()), sum(t for _, t in layers.values())
        percent = int(current * 100 / total) if total else 0
        if percent != last:
            last = percent
            emit("progress", current=current, total=total)
        if not detail:
            emit("log", line=" ".join(str(status[k]) for k in ("id", "status") if status.get(k)))


# --- CFEngine packages ------------------------------------------------------


def _fetch_json(url: str):
    try:
        with urllib.request.urlopen(url, timeout=HTTP_TIMEOUT) as response:
            return json.load(response)
    except (OSError, ValueError) as error:
        raise RunnerError(f"Couldn't read {url}: {error}") from error


def _matches(classexpr: str, platform: str, arch: str) -> bool:
    # e.g. "(redhat_9|centos_9).x86_64", "am_policy_hub.ubuntu_22.aarch64"
    expr = classexpr.removeprefix("!").removeprefix("am_policy_hub.")
    systems, _, expr_arch = expr.rpartition(".")
    return expr_arch == arch and platform in re.findall(r"[a-z]+_\d+", systems)


def find_package(releases: dict, detail_of, edition: str, version: str, platform: str, arch: str, hub: bool) -> dict:
    """The package for a host, from CFEngine's release data (what cf-remote reads).
    `version`: an exact release, or "latest" for the latest stable one."""
    entries = [r for r in releases.get("releases", []) if not r.get("debug")]
    if version == "latest":
        entry = next((r for r in entries if r.get("latest_stable")), None)
    else:
        entry = next((r for r in entries if r.get("version") == version), None)
    if entry is None:
        raise RunnerError(f"No CFEngine {edition} release {version}")
    detail = detail_of(entry["URL"])
    for items in detail.get("artifacts", {}).values():
        for item in items:
            expr = item.get("classexpr", "")
            if edition == "enterprise" and expr.startswith("am_policy_hub.") != hub:
                continue
            if _matches(expr, platform, arch):
                return {
                    "url": item["URL"],
                    "sha256": item.get("SHA256"),
                    "version": entry["version"],
                    "filename": item["URL"].rsplit("/", 1)[1],
                }
    role = " hub" if edition == "enterprise" and hub else ""
    raise RunnerError(f"No CFEngine {edition}{role} {entry['version']} package for {platform} ({arch})")


def package(query: dict) -> dict:
    edition = query.get("edition", "community")
    if edition not in ("community", "enterprise"):
        raise RunnerError(f"Unknown edition: {edition}")
    platform = PLATFORMS.get(query.get("platform", ""), {}).get("package") or query.get("platform", "")
    releases = _fetch_json(RELEASES.format(edition=edition))
    return find_package(
        releases,
        _fetch_json,
        edition,
        query.get("version", "latest"),
        platform,
        query.get("arch", "x86_64"),
        bool(query.get("hub")),
    )
