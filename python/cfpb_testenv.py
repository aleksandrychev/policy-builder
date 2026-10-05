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

# The platforms CFEngine supports that run in a Linux container: the base image, the CFEngine
# package platform it takes (release data classexpr) and how packages install. RHEL-compatible
# ones use AlmaLinux (CentOS 7 for 7, the only free image of it).
PLATFORMS = {
    "ubuntu-20": {"label": "Ubuntu 20.04", "image": "ubuntu:20.04", "package": "ubuntu_20", "family": "deb"},
    "ubuntu-22": {"label": "Ubuntu 22.04", "image": "ubuntu:22.04", "package": "ubuntu_22", "family": "deb"},
    "ubuntu-24": {"label": "Ubuntu 24.04", "image": "ubuntu:24.04", "package": "ubuntu_24", "family": "deb"},
    "debian-12": {"label": "Debian 12", "image": "debian:12", "package": "debian_12", "family": "deb"},
    "debian-13": {"label": "Debian 13", "image": "debian:13", "package": "debian_13", "family": "deb"},
    "rhel-7": {"label": "RHEL 7 (CentOS 7)", "image": "centos:7", "package": "redhat_7", "family": "yum"},
    "rhel-8": {"label": "RHEL 8 (AlmaLinux 8)", "image": "almalinux:8", "package": "redhat_8", "family": "rpm"},
    "rhel-9": {"label": "RHEL 9 (AlmaLinux 9)", "image": "almalinux:9", "package": "redhat_9", "family": "rpm"},
    "rhel-10": {"label": "RHEL 10 (AlmaLinux 10)", "image": "almalinux:10", "package": "redhat_10", "family": "rpm"},
}
# Release data arch -> Docker platform / image architecture.
DOCKER_PLATFORM = {"x86_64": "linux/amd64", "aarch64": "linux/arm64"}
DOCKER_ARCH = {"x86_64": "amd64", "aarch64": "arm64"}
# How CFEngine and what it needs get installed, by package family: (prerequisites, install {file}).
INSTALL = {
    "deb": (
        "DEBIAN_FRONTEND=noninteractive apt-get update -qq && "
        "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 procps curl ca-certificates",
        "DEBIAN_FRONTEND=noninteractive apt-get install -y {file}",
    ),
    "rpm": ("dnf install -y -q python3 procps-ng ca-certificates findutils", "dnf install -y {file}"),
    # CentOS 7 is end of life: its mirrors are gone, the vault keeps the packages.
    "yum": (
        "sed -i -e 's/^mirrorlist/#mirrorlist/' -e 's|^#baseurl=http://mirror.centos.org|baseurl=http://vault.centos.org|' "
        "/etc/yum.repos.d/CentOS-*.repo && yum install -y -q procps-ng curl ca-certificates",
        "yum install -y {file}",
    ),
}
RELEASES = "https://cfengine.com/release-data/{edition}/releases.json"
HTTP_TIMEOUT = 20
# Where fetched release data is kept, so a slow or missing network falls back to the last copy
# (set from the request's cacheDir, which main adds).
CACHE_DIR: str | None = None


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


# A Docker image reference: [registry[:port]/]name[:tag][@digest].
REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$")


def split_reference(image: str) -> tuple[str, str]:
    """(repository, tag or digest) of an image reference; a registry's port isn't a tag."""
    if "@" in image:
        return tuple(image.split("@", 1))  # type: ignore[return-value]
    name, slash, last = image.rpartition("/")
    if ":" in last:
        last, tag = last.split(":", 1)
        return f"{name}{slash}{last}", tag
    return image, "latest"


def pull(image: str, arch: str | None = None) -> None:
    """Pulls an image (for `arch`, else the engine's own), streaming `progress` events (bytes over
    all layers) and `log` lines."""
    repository, tag = split_reference(image)
    layers: dict[str, tuple[int, int]] = {}
    last = -1
    platform = DOCKER_PLATFORM.get(arch) if arch else None
    for status in client().api.pull(repository, tag=tag, stream=True, decode=True, platform=platform):
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
    cached = Path(CACHE_DIR, "release-data", hashlib.sha256(url.encode()).hexdigest() + ".json") if CACHE_DIR else None
    try:
        with urllib.request.urlopen(url, timeout=HTTP_TIMEOUT) as response:
            data = json.load(response)
    except (OSError, ValueError) as error:
        if cached and cached.is_file():
            return json.loads(cached.read_text())
        raise RunnerError(f"Couldn't read {url}: {error}") from error
    if cached:
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_text(json.dumps(data))
    return data


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
            # Unpublished: built, but not supported (e.g. Ubuntu 20.04 hubs, Debian 11).
            if item.get("Published") is False:
                continue
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


# --- environments -----------------------------------------------------------
#
# An environment (the tab's, saved in .policy-builder/test-environments.json):
#   {id, name, edition: "community"|"enterprise", version: "latest"|"3.27.1", hub: <host id>,
#    env: {KEY: value}, hosts: [{id, name, platform, ports: [{host, container}], env: {KEY: value}}]}
# Every container and the network carry labels (cfpb.env, cfpb.host), so state is found again
# from Docker itself after the app restarts.

LABEL_ENV, LABEL_HOST, LABEL_CONFIG = "cfpb.env", "cfpb.host", "cfpb.config"
CFENGINE = "/var/cfengine/bin"
# Agent runs per host and Deploy & run, until one repairs nothing (the environment's maxRuns, 1-10).
MAX_RUNS = 3
# promise_summary.log, one line per agent run (update.cf runs get their own). Community:
# "... Promises observed to be kept 97.44%, Promises repaired 2.56%, Promises not repaired 0.00%";
# Enterprise: "... Total promise compliance: 98% kept, 2% repaired, 1% not kept (out of 340 events) ...".
COMPLIANCE = (
    re.compile(r"kept ([\d.]+)%, Promises repaired ([\d.]+)%, Promises not repaired ([\d.]+)%"),
    re.compile(r"Total promise compliance: ([\d.]+)% kept, ([\d.]+)% repaired, ([\d.]+)% not kept"),
)


def _short(env_id: str) -> str:
    return re.sub(r"[^a-z0-9]", "", env_id.lower())[:8] or "env"


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "host"


def container_name(env: dict, host: dict) -> str:
    return f"cfpb-{_short(env['id'])}-{_slug(host['name'])}"


def network_name(env: dict) -> str:
    return f"cfpb-{_short(env['id'])}"


def host_env(env: dict, host: dict, dotenv: dict[str, str]) -> dict[str, str]:
    """Environment variables for a host: its own beat the environment's, which beat .env."""
    return {**dotenv, **(env.get("env") or {}), **(host.get("env") or {})}


def read_dotenv(path: str | None) -> dict[str, str]:
    """`KEY=value` lines (`#` comments, `export ` prefix and surrounding quotes allowed). A missing file is empty."""
    if not path or not os.path.isfile(path):
        return {}
    values = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.removeprefix("export ").split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key.strip()] = value
    return values


class _Lines:
    """Turns streamed output chunks into whole lines, emitted as `log` events."""

    def __init__(self, host: str | None, stream: str, keep: list[str] | None = None):
        self.host, self.stream, self.partial, self.keep = host, stream, "", keep

    def feed(self, chunk: bytes | str | None) -> None:
        if not chunk:
            return
        text = self.partial + (chunk.decode("utf-8", "replace") if isinstance(chunk, bytes) else chunk)
        *lines, self.partial = text.split("\n")
        for line in lines:
            self.line(line.rstrip("\r"))

    def line(self, line: str) -> None:
        emit("log", host=self.host, stream=self.stream, line=line)
        if self.keep is not None:
            self.keep.append(line)

    def close(self) -> None:
        if self.partial:
            self.line(self.partial)
            self.partial = ""


def run_in(
    engine, container, command: str, host: str | None, stream: str, environment: dict | None = None, keep=None
) -> int:
    """Runs a shell command in a container, streaming its output (also into `keep`); returns its exit code."""
    exec_id = engine.api.exec_create(container.id, ["bash", "-lc", command], environment=environment or None)["Id"]
    lines = _Lines(host, stream, keep)
    for out, err in engine.api.exec_start(exec_id, stream=True, demux=True):
        lines.feed(out)
        lines.feed(err)
    lines.close()
    return engine.api.exec_inspect(exec_id)["ExitCode"]


def _check(code: int, what: str) -> None:
    if code != 0:
        raise RunnerError(f"{what} failed (exit {code})")


def _has_image(engine, image: str, arch: str) -> bool:
    """Whether `image` is pulled for `arch` (a tag holds one architecture at a time)."""
    try:
        return engine.images.get(image).attrs.get("Architecture") == DOCKER_ARCH[arch]
    except Exception:  # docker.errors.ImageNotFound
        return False


def ensure_image(
    engine,
    platform: str,
    edition: str,
    version: str,
    hub: bool,
    arch: str,
    host_id: str | None = None,
    base: str | None = None,
) -> str:
    """A local image with CFEngine installed (built once per platform, edition, role, version and arch).
    `base` is a custom image to build on instead of the platform's; `platform` then says which
    package it takes and how it installs."""
    if platform not in PLATFORMS:
        raise RunnerError(f"Unknown platform: {platform}")
    if base is not None and not REFERENCE.match(base):
        raise RunnerError(f"Not an image reference: {base}")
    role = "hub" if edition == "enterprise" and hub else "agent"
    spec = PLATFORMS[platform]
    image = base or spec["image"]
    found = package({"edition": edition, "version": version, "platform": platform, "arch": arch, "hub": hub})
    repository = f"cfpb-cache/{platform}"
    if base:
        repository = f"cfpb-cache/custom-{hashlib.sha256(base.encode()).hexdigest()[:12]}-{platform}"
    tag = f"{edition}-{role}-{found['version']}-{DOCKER_ARCH[arch]}"
    if _has_image(engine, f"{repository}:{tag}", arch):
        return f"{repository}:{tag}"
    label = f"{base or spec['label']} ({arch}) with CFEngine {edition} {found['version']} ({role})"
    emit("step", host=host_id, step="image", message=f"Preparing {label}")
    if not _has_image(engine, image, arch):
        pull(image, arch)
    # Custom images may set an entrypoint or a non-root user: the cached image drops both.
    builder = engine.containers.run(
        image,
        ["infinity"],
        entrypoint=["sleep"],
        user="root",
        detach=True,
        init=True,
        labels={"cfpb.build": "1"},
        platform=DOCKER_PLATFORM[arch],
    )
    try:
        prerequisites, install = INSTALL[spec["family"]]
        _check(run_in(engine, builder, prerequisites, None, "setup"), "Installing prerequisites")
        file = f"/tmp/{found['filename']}"
        command = f"curl -fsSL -o {file} {found['url']} && {install.format(file=file)} && rm {file}"
        _check(run_in(engine, builder, command, None, "setup"), "Installing CFEngine")
        builder.commit(
            repository=repository, tag=tag, changes=['ENTRYPOINT [""]', 'CMD ["sleep", "infinity"]', "USER root"]
        )
    finally:
        builder.remove(force=True)
    return f"{repository}:{tag}"


# os-release codenames of releases whose derivatives (Mint, Pop!_OS, …) name them.
CODENAMES = {
    "focal": "ubuntu-20",
    "jammy": "ubuntu-22",
    "noble": "ubuntu-24",
    "bookworm": "debian-12",
    "trixie": "debian-13",
}
RHEL_LIKE = {"rhel", "centos", "rocky", "almalinux", "ol", "redhat"}


def parse_os_release(text: str) -> dict[str, str]:
    fields = {}
    for line in text.splitlines():
        key, equals, value = line.partition("=")
        if equals:
            fields[key.strip()] = value.strip().strip("'\"")
    return fields


def platform_of(fields: dict[str, str]) -> str | None:
    """The PLATFORMS key whose package an OS takes, from its os-release; None if unsure."""
    ids = {fields.get("ID", "").lower(), *fields.get("ID_LIKE", "").lower().split()}
    major = fields.get("VERSION_ID", "").split(".")[0]
    found = None
    if fields.get("ID") in ("ubuntu", "debian"):
        found = f"{fields['ID']}-{major}"
    elif ids & RHEL_LIKE and major:
        found = f"rhel-{major}"
    else:
        found = CODENAMES.get(fields.get("UBUNTU_CODENAME") or fields.get("VERSION_CODENAME") or "")
    return found if found in PLATFORMS else None


def inspect(request: dict) -> None:
    """Pulls a custom image if needed and reads its /etc/os-release: emits `detected` with the
    OS and the platform whose package it takes (null when that has to be picked)."""
    image, arch = request.get("image"), request.get("arch") or "x86_64"
    if not isinstance(image, str) or not REFERENCE.match(image):
        raise RunnerError(f"Not an image reference: {image}")
    if arch not in DOCKER_PLATFORM:
        raise RunnerError(f"Unknown architecture: {arch}")
    engine = client()
    if not _has_image(engine, image, arch):
        emit("step", step="pull", message=f"Pulling {image}")
        pull(image, arch)
    output = engine.containers.run(
        image,
        ["/etc/os-release"],
        entrypoint=["cat"],
        user="root",
        remove=True,
        platform=DOCKER_PLATFORM[arch],
    )
    fields = parse_os_release(output.decode("utf-8", "replace"))
    emit(
        "detected",
        image=image,
        os=fields.get("PRETTY_NAME") or fields.get("NAME") or None,
        platform=platform_of(fields),
    )
    emit("done")


def search(query: dict) -> dict:
    """Images matching `term`: pulled ones, and Docker Hub's when `hub` (its error, if any, as `hubError`)."""
    term = str(query.get("term") or "").strip().lower()
    engine = client()
    local = sorted(
        {
            tag
            for image in engine.images.list()
            for tag in image.tags
            if not tag.startswith("cfpb-cache/") and term in tag.lower()
        }
    )
    result: dict = {"local": local[:50], "hub": [], "hubError": None}
    if query.get("hub") and term:
        try:
            found = engine.images.search(term, limit=25)
            result["hub"] = [
                {
                    "name": item.get("name"),
                    "description": item.get("description") or "",
                    "stars": item.get("star_count", 0),
                    "official": bool(item.get("is_official")),
                }
                for item in found
            ]
        except Exception as error:  # offline, rate limited
            result["hubError"] = f"Docker Hub search failed: {error}"
    return result


def platforms(query: dict) -> dict:
    """Every platform, and whether this edition + version has a client / hub package for `arch`."""
    edition, version = query.get("edition", "community"), query.get("version", "latest")
    arch = query.get("arch", "x86_64")
    releases = _fetch_json(RELEASES.format(edition=edition))
    cache: dict[str, dict] = {}

    def detail_of(url: str) -> dict:
        if url not in cache:
            cache[url] = _fetch_json(url)
        return cache[url]

    def has(platform: str, hub: bool) -> bool:
        try:
            find_package(releases, detail_of, edition, version, platform, arch, hub)
            return True
        except RunnerError:
            return False

    listed = [
        # In Community any host can serve policy; an Enterprise hub needs the hub package.
        {"id": key, "label": spec["label"], "client": has(spec["package"], False), "hub": has(spec["package"], True)}
        for key, spec in PLATFORMS.items()
    ]
    return {"platforms": listed}


def _labelled(engine, env: dict) -> dict:
    """The environment's containers by host id."""
    found = engine.containers.list(all=True, filters={"label": f"{LABEL_ENV}={env['id']}"})
    return {container.labels.get(LABEL_HOST): container for container in found}


def _network(engine, env: dict):
    name = network_name(env)
    existing = engine.networks.list(names=[name])
    return existing[0] if existing else engine.networks.create(name, labels={LABEL_ENV: env["id"]})


def _config_hash(image: str, host: dict) -> str:
    """What a container is created with that can't change afterwards: image, name and ports."""
    ports = sorted((int(p["host"]), int(p["container"])) for p in host.get("ports") or [])
    return hashlib.sha256(json.dumps([image, host["name"], ports]).encode()).hexdigest()[:16]


def _ensure_container(engine, env: dict, host: dict, image: str, environment: dict):
    existing = _labelled(engine, env).get(host["id"])
    config = _config_hash(image, host)
    if existing is not None and existing.labels.get(LABEL_CONFIG) != config:
        emit("step", host=host["id"], step="recreate", message="Recreating (image, name or ports changed)")
        existing.remove(force=True)
        existing = None
    if existing is not None:
        if existing.status != "running":
            existing.start()
        return existing
    emit("step", host=host["id"], step="create", message=f"Creating {container_name(env, host)}")
    return engine.containers.run(
        image,
        "sleep infinity",
        name=container_name(env, host),
        hostname=_slug(host["name"]),
        detach=True,
        init=True,  # reaps zombies (an Enterprise hub leaves defunct httpd / php-fpm otherwise)
        network=network_name(env),
        platform=DOCKER_PLATFORM.get(env.get("arch") or "x86_64"),
        ports={f"{int(p['container'])}/tcp": int(p["host"]) for p in host.get("ports") or []},
        environment=environment,
        labels={LABEL_ENV: env["id"], LABEL_HOST: host["id"], LABEL_CONFIG: config},
    )


def _ip(engine, container, env: dict) -> str:
    container.reload()
    return container.attrs["NetworkSettings"]["Networks"][network_name(env)]["IPAddress"]


def _deploy(engine, hub, masterfiles: str) -> None:
    """Replaces the hub's /var/cfengine/masterfiles with the built policy set."""
    import io
    import tarfile

    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        archive.add(masterfiles, arcname="masterfiles")
    _check(run_in(engine, hub, "rm -rf /var/cfengine/masterfiles", None, "setup"), "Clearing masterfiles")
    if not hub.put_archive("/var/cfengine", buffer.getvalue()):
        raise RunnerError("Couldn't copy the policy to the hub")


def build_policy(content: dict, masterfiles: str, cache_dir: str) -> str:
    """Builds the project as a policy set (cfbs) in a scratch copy; returns its out/masterfiles.
    One pristine `cfbs init` per masterfiles version is kept, so a rebuild needs no network."""
    import cfbs.main
    from cfbs.cfbs_config import CFBSConfig

    import cfpb_backend

    base = os.path.join(cache_dir, "masterfiles", masterfiles)
    if not os.path.isfile(os.path.join(base, "cfbs.json")):
        emit("step", step="build", message=f"Downloading masterfiles {masterfiles}")
        shutil.rmtree(base, ignore_errors=True)
        os.makedirs(base)
        cfpb_backend._run_cfbs_init(base, masterfiles)
    work = os.path.join(cache_dir, "build")
    shutil.rmtree(work, ignore_errors=True)
    shutil.copytree(base, work)
    options = {"type": "policy-set", "name": "test", "description": "Test build", "git": False, "content": content}
    cfpb_backend._update_cfbs_json(work, options)
    emit("step", step="build", message="Building the policy set")
    CFBSConfig.instance = None
    with cfpb_backend._cfbs_session(work, ["build"]) as tee:
        code = cfbs.main.main()
    for line in "".join(tee.chunks).splitlines():
        emit("log", host=None, stream="setup", line=line)
    if code != 0:
        raise RunnerError(f"cfbs build failed (exit {code})")
    return os.path.join(work, "out", "masterfiles")


def _bootstrapped(engine, container) -> bool:
    return run_in(engine, container, "test -s /var/cfengine/policy_server.dat", None, "quiet") == 0


def up(request: dict, finish: bool = True) -> str:
    """Start: build the policy, make sure every host's container exists and runs CFEngine, deploy
    the policy to the hub and bootstrap everyone to it. Returns the built masterfiles."""
    env, engine = request["environment"], client()
    hosts = env.get("hosts") or []
    hub_host = next((h for h in hosts if h["id"] == env.get("hub")), hosts[0] if hosts else None)
    if hub_host is None:
        raise RunnerError("The environment has no hosts")
    # x86-64 by default, also on Apple Silicon (emulated there): the widest set of packages.
    arch = env.get("arch") or "x86_64"
    edition, version = env.get("edition", "community"), env.get("version", "latest")
    masterfiles_dir = build_policy(request["content"], request["masterfiles"], request["cacheDir"])
    dotenv = read_dotenv(request.get("envFile"))
    _network(engine, env)
    containers = {}
    for host in sorted(hosts, key=lambda h: h is not hub_host):
        emit("host", host=host["id"], state="provisioning")
        image = ensure_image(
            engine, host["platform"], edition, version, host is hub_host, arch, host["id"], host.get("image") or None
        )
        containers[host["id"]] = _ensure_container(engine, env, host, image, host_env(env, host, dotenv))
    hub = containers[hub_host["id"]]
    _deploy(engine, hub, masterfiles_dir)
    hub_ip = _ip(engine, hub, env)
    for host in sorted(hosts, key=lambda h: h is not hub_host):
        container = containers[host["id"]]
        if not _bootstrapped(engine, container):
            emit("step", host=host["id"], step="bootstrap", message=f"Bootstrapping to {hub_ip}")
            environment = host_env(env, host, dotenv)
            _check(
                run_in(
                    engine, container, f"{CFENGINE}/cf-agent --bootstrap {hub_ip}", host["id"], "setup", environment
                ),
                "Bootstrap",
            )
        emit("host", host=host["id"], state="ready", container=container.name, ip=_ip(engine, container, env))
    if edition == "enterprise":
        _setup_code(engine, hub, hub_host)
    if finish:
        emit("done")
    return masterfiles_dir


def _setup_code(engine, hub, hub_host: dict) -> None:
    """A fresh Mission Portal first-login code (it expires after an hour)."""
    exec_id = engine.api.exec_create(hub.id, [f"{CFENGINE}/cf-hub", "--new-setup-code"])["Id"]
    output = engine.api.exec_start(exec_id).decode("utf-8", "replace")
    code = re.search(r"\b(\d{4,})\b", output)
    port = next((int(p["host"]) for p in hub_host.get("ports") or [] if int(p["container"]) == 443), None)
    emit(
        "hub",
        host=hub_host["id"],
        setup_code=code.group(1) if code else None,
        url=f"https://localhost:{port}/" if port else None,
    )


# cf-agent's own location for what it's reporting on, e.g.
# "info: Promise belongs to bundle 'x' in file '/var/cfengine/inputs/services/cfbs/security.cf' near line 74".
BELONGS = re.compile(r"Promise belongs to bundle '([^']+)' in file '([^']+)' near line (\d+)")
# Roll-ups of an error already reported on its own line.
ROLLUP = re.compile(r"Method '[^']+' failed in some repairs|Errors encountered when actuating|Not all promises")
INPUTS = "/var/cfengine/inputs/services/cfbs/"


def _where(file: str) -> str | None:
    """A deployed policy file's path in the project ("./security.cf"), if it's one of ours."""
    return "./" + file[len(INPUTS) :] if file.startswith(INPUTS) else None


def find_problems(lines: list[str], source_map: dict, block_files: dict) -> list[dict]:
    """The errors of one agent run, each with what caused it (the info lines just before) and the
    block it comes from (cf-agent's file and line, through the compiler's source map)."""
    problems: dict[tuple, dict] = {}
    context: list[str] = []
    location: tuple[str, str, int] | None = None
    for raw in lines:
        line = raw.strip()
        belongs = BELONGS.search(line)
        if belongs:
            location = (belongs.group(1), belongs.group(2), int(belongs.group(3)))
            continue
        if line.startswith("info:"):
            context.append(line[len("info:") :].strip())
            context = context[-4:]
            continue
        if not line.startswith("error:"):
            continue
        message = line[len("error:") :].strip()
        if ROLLUP.search(message) and problems:
            continue
        path = _where(location[1]) if location else None
        block = _block_at(source_map.get(path or "", {}), location[2]) if path and location else None
        key = (block or (location and location[1:]) or None, message)
        if key in problems:
            problems[key]["count"] += 1
        else:
            problems[key] = {
                "message": message,
                "cause": list(dict.fromkeys(c for c in context if c != message)),
                "count": 1,
                "block": block,
                "fileId": block_files.get(block) if block else None,
                "bundle": location[0] if location else None,
                "file": path or (location[1] if location else None),
                "line": location[2] if location else None,
            }
        context, location = [], None
    return list(problems.values())


def _block_at(ranges_by_block: dict, line: int) -> str | None:
    """The block (or group) whose lines hold `line`: the narrowest range wins."""
    best, size = None, None
    for block, ranges in ranges_by_block.items():
        for first, last in ranges:
            if first <= line <= last and (size is None or last - first < size):
                best, size = block, last - first
    return best


def _compliance(engine, container) -> dict | None:
    command = "grep -v 'version update.cf' /var/cfengine/promise_summary.log | tail -n 1"
    exec_id = engine.api.exec_create(container.id, ["bash", "-c", command])["Id"]
    line = engine.api.exec_start(exec_id).decode("utf-8", "replace")
    match = next((m for m in (pattern.search(line) for pattern in COMPLIANCE) if m), None)
    if not match:
        return None
    kept, repaired, not_kept = (float(g) for g in match.groups())
    return {"kept": kept, "repaired": repaired, "notKept": not_kept}


def run(request: dict, masterfiles_dir: str | None = None) -> None:
    """Run policy: rebuild (unless just built) and redeploy the current edits, then run the agent on
    every host (hub first) until a run repairs nothing, at most the environment's maxRuns times."""
    env, engine = request["environment"], client()
    hosts = env.get("hosts") or []
    hub_host = next((h for h in hosts if h["id"] == env.get("hub")), hosts[0] if hosts else None)
    containers = _labelled(engine, env)
    only = set(request.get("hosts") or [h["id"] for h in hosts])
    # The hosts to run, and the hub that serves them, have to be up.
    needed = [h for h in hosts if h["id"] in only or h is hub_host]
    missing = [h["name"] for h in needed if h["id"] not in containers or containers[h["id"]].status != "running"]
    if hub_host is None or missing:
        raise RunnerError(f"Start the environment first ({', '.join(missing) or 'no hosts'} not running)")
    masterfiles_dir = masterfiles_dir or build_policy(request["content"], request["masterfiles"], request["cacheDir"])
    hub = containers[hub_host["id"]]
    _deploy(engine, hub, masterfiles_dir)
    # Clients' update.cf needs masterfiles/cf_promises_validated, which the deploy removed and only the
    # hub's own run writes again: tag it now, so running only some clients works too.
    tagged = run_in(engine, hub, f"{CFENGINE}/cf-promises -T /var/cfengine/masterfiles", hub_host["id"], "setup")
    _check(tagged, "Validating the policy on the hub")
    # Where each block's lines are, to trace errors back to blocks.
    from cfpb_compiler import compile_project

    source_map: dict = {}
    project = request["content"]["project"]
    compile_project(project, source_map=source_map)
    block_files = {
        item: file["id"]
        for file in project.get("files", [])
        for item in [b["instanceId"] for b in file.get("blocks", [])] + [g["id"] for g in file.get("groups", [])]
    }
    dotenv = read_dotenv(request.get("envFile"))
    max_runs = env.get("maxRuns") if isinstance(env.get("maxRuns"), int) and 1 <= env["maxRuns"] <= 10 else MAX_RUNS
    for host in sorted(hosts, key=lambda h: h is not hub_host):
        if host["id"] not in only:
            continue
        container, environment = containers[host["id"]], host_env(env, host, dotenv)
        emit("host", host=host["id"], state="running")
        result = None
        for number in range(1, max_runs + 1):
            emit("step", host=host["id"], step="run", message=f"Run {number} of {max_runs}")
            # update.cf's errors are problems too (its compliance isn't in the summary we read).
            updating: list[str] = []
            run_in(
                engine, container, f"{CFENGINE}/cf-agent -KI -f update.cf", host["id"], "agent", environment, updating
            )
            output: list[str] = []
            code = run_in(engine, container, f"{CFENGINE}/cf-agent -KI", host["id"], "agent", environment, output)
            result = {**(_compliance(engine, container) or {}), "exit": code, "run": number}
            emit("result", host=host["id"], **result)
            if code != 0 or result.get("repaired", 0) == 0:
                break
        # What went wrong in the last pass (earlier passes may have been fixed by later ones).
        emit(
            "problems",
            host=host["id"],
            problems=[
                *find_problems(updating if result else [], source_map, block_files),
                *find_problems(output if result else [], source_map, block_files),
            ],
        )
        # Done unless the agent itself failed; still repairing after MAX_RUNS is "not converged" (an
        # Enterprise hub repairs a little on every run).
        converged = bool(result) and result["exit"] == 0 and result.get("repaired", 1) == 0
        failed = not result or result["exit"] != 0
        emit("host", host=host["id"], state="failed" if failed else "done", converged=converged)
    emit("done")


def test(request: dict) -> None:
    """Run Test: Start what isn't up yet, then run the policy everywhere."""
    run(request, up(request, finish=False))


def execute(request: dict) -> None:
    """The terminal: runs a shell command on the chosen hosts, one after another, streaming each
    one's output; emits a `result`-free `exec` event with its exit code."""
    env, engine = request["environment"], client()
    command = request.get("command")
    if not isinstance(command, str) or not command.strip():
        raise RunnerError("No command to run")
    containers = _labelled(engine, env)
    dotenv = read_dotenv(request.get("envFile"))
    only = set(request.get("hosts") or [])
    for host in env.get("hosts") or []:
        if only and host["id"] not in only:
            continue
        container = containers.get(host["id"])
        if container is None or container.status != "running":
            emit("log", host=host["id"], stream="exec", line=f"{host['name']} isn't running")
            continue
        emit("log", host=host["id"], stream="command", line=f"$ {command}")
        code = run_in(engine, container, command, host["id"], "exec", host_env(env, host, dotenv))
        emit("exec", host=host["id"], exit=code)
    emit("done")


def status(request: dict) -> dict:
    """Each host's container, as Docker sees it (found by label)."""
    env, engine = request["environment"], client()
    containers = _labelled(engine, env)
    hosts = {}
    for host in env.get("hosts") or []:
        container = containers.get(host["id"])
        if container is None:
            hosts[host["id"]] = {"state": "absent"}
            continue
        networks = container.attrs.get("NetworkSettings", {}).get("Networks", {})
        ip = (networks.get(network_name(env)) or {}).get("IPAddress") or None
        hosts[host["id"]] = {"state": container.status, "container": container.name, "ip": ip}
    return {"hosts": hosts}


def stop(request: dict) -> None:
    """Stops the environment's containers (or only `hosts`); they keep what's installed."""
    only = set(request.get("hosts") or [])
    for host_id, container in _labelled(client(), request["environment"]).items():
        if only and host_id not in only:
            continue
        emit("step", host=host_id, step="stop", message=f"Stopping {container.name}")
        container.stop(timeout=5)
        emit("host", host=host_id, state="exited", container=container.name)
    emit("done")


def start(request: dict) -> None:
    """Starts stopped containers again (or only `hosts`): already installed and bootstrapped."""
    env, engine = request["environment"], client()
    only = set(request.get("hosts") or [])
    for host_id, container in _labelled(engine, env).items():
        if only and host_id not in only:
            continue
        emit("step", host=host_id, step="start", message=f"Starting {container.name}")
        container.start()
        emit("host", host=host_id, state="ready", container=container.name, ip=_ip(engine, container, env))
    emit("done")


def destroy(request: dict) -> None:
    """Removes the environment's containers (or only `hosts`) and, when all go, its network."""
    env, engine = request["environment"], client()
    only = set(request.get("hosts") or [])
    for host_id, container in _labelled(engine, env).items():
        if only and host_id not in only:
            continue
        emit("step", host=host_id, step="destroy", message=f"Removing {container.name}")
        container.remove(force=True)
        emit("host", host=host_id, state="absent")
    if not only:
        for network in engine.networks.list(names=[network_name(env)]):
            network.remove()
    emit("done")
