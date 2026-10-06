"""Test environments: finding the Docker Engine and the CFEngine package for a host."""

from __future__ import annotations

import hashlib
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest

import cfpb_backend
import cfpb_testenv
from cfpb_testenv import RunnerError, docker_host, find_package

RELEASES = Path(__file__).parent / "fixtures" / "releases"


def _context(home: Path, name: str, host: str) -> None:
    (home / ".docker").mkdir(parents=True, exist_ok=True)
    (home / ".docker" / "config.json").write_text(json.dumps({"currentContext": name}))
    meta = home / ".docker" / "contexts" / "meta" / hashlib.sha256(name.encode()).hexdigest()
    meta.mkdir(parents=True)
    (meta / "meta.json").write_text(json.dumps({"Name": name, "Endpoints": {"docker": {"Host": host}}}))


def test_docker_host_prefers_docker_host_then_the_current_context(tmp_path: Path):
    _context(tmp_path, "desktop-linux", "unix:///Users/x/.docker/run/docker.sock")

    assert docker_host(tmp_path, {"DOCKER_HOST": "tcp://10.0.0.1:2375"}) == "tcp://10.0.0.1:2375"
    assert docker_host(tmp_path, {}) == "unix:///Users/x/.docker/run/docker.sock"


def test_docker_host_falls_back_to_a_socket_that_exists(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(cfpb_testenv.sys, "platform", "darwin")
    _context(tmp_path, "default", "unix:///var/run/docker.sock")
    socket = tmp_path / ".colima/default/docker.sock"
    socket.parent.mkdir(parents=True)
    socket.touch()
    monkeypatch.setattr(cfpb_testenv.Path, "exists", lambda p: str(p) == str(socket))

    assert docker_host(tmp_path, {}) == f"unix://{socket}"


def test_without_any_socket_docker_is_reported_missing(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(cfpb_testenv, "docker_host", lambda: None)
    monkeypatch.setattr(cfpb_testenv, "_docker_installed", lambda: False)

    assert cfpb_testenv.doctor() == {
        "available": False,
        "problem": "not_installed",
        "message": "Install Docker to run test hosts.",
        "host": None,
    }


def _find(version="3.27.1", platform="ubuntu_22", arch="x86_64", hub=False) -> dict:
    releases = json.loads((RELEASES / "enterprise-releases.json").read_text())
    detail = json.loads((RELEASES / "enterprise-3.27.1.json").read_text())
    details = {entry["URL"]: detail for entry in releases["releases"] if entry["version"] == "3.27.1"}

    def detail_of(url: str) -> dict:
        if url not in details:
            pytest.skip("fixture only has 3.27.1")
        return details[url]

    return find_package(releases, detail_of, "enterprise", version, platform, arch, hub)


def test_enterprise_hosts_get_the_hub_or_the_client_package():
    hub = _find(hub=True)
    client = _find(hub=False)

    assert hub["filename"] == "cfengine-nova-hub_3.27.1-1.ubuntu22_amd64.deb"
    assert client["filename"] == "cfengine-nova_3.27.1-1.ubuntu22_amd64.deb"
    assert hub["url"].startswith("https://cfengine-package-repos.s3.amazonaws.com/enterprise/Enterprise-3.27.1/hub/")


def test_platforms_match_inside_alternatives_and_by_arch():
    assert _find(platform="redhat_9")["filename"] == "cfengine-nova-3.27.1-1.el9.x86_64.rpm"
    assert _find(platform="debian_12", arch="aarch64")["filename"] == "cfengine-nova_3.27.1-1.debian12_arm64.deb"


def test_a_platform_without_a_package_says_so():
    with pytest.raises(RunnerError, match="No CFEngine enterprise hub 3.27.1 package for redhat_7"):
        _find(platform="redhat_7", hub=True)


def test_nightly_builds_are_never_picked():
    with pytest.raises(RunnerError, match="No CFEngine enterprise release master"):
        _find(version="master")


def test_unpublished_packages_are_not_offered():
    with pytest.raises(RunnerError, match="No CFEngine enterprise hub 3.27.1 package for ubuntu_20"):
        _find(platform="ubuntu_20", hub=True)
    assert _find(platform="ubuntu_20")["filename"] == "cfengine-nova_3.27.1-1.ubuntu20_amd64.deb"


def test_release_data_falls_back_to_the_cached_copy_when_offline(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(cfpb_testenv, "CACHE_DIR", str(tmp_path))

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self, *args):
            return b'{"releases": []}'

    monkeypatch.setattr(cfpb_testenv.urllib.request, "urlopen", lambda url, timeout: Response())
    assert cfpb_testenv._fetch_json("https://example.test/releases.json") == {"releases": []}

    def offline(url, timeout):
        raise OSError("timed out")

    monkeypatch.setattr(cfpb_testenv.urllib.request, "urlopen", offline)
    assert cfpb_testenv._fetch_json("https://example.test/releases.json") == {"releases": []}
    with pytest.raises(RunnerError, match="Couldn't read https://example.test/other.json"):
        cfpb_testenv._fetch_json("https://example.test/other.json")


def test_platforms_say_which_have_client_and_hub_packages(monkeypatch):
    releases = json.loads((RELEASES / "enterprise-releases.json").read_text())
    detail = json.loads((RELEASES / "enterprise-3.27.1.json").read_text())
    monkeypatch.setattr(cfpb_testenv, "_fetch_json", lambda url: releases if url.endswith("releases.json") else detail)

    found = cfpb_testenv.platforms({"edition": "enterprise", "version": "3.27.1", "arch": "x86_64"})["platforms"]
    support = {p["id"]: (p["client"], p["hub"]) for p in found}

    assert support["ubuntu-22"] == (True, True)
    assert support["ubuntu-20"] == (True, False)
    assert support["rhel-7"] == (True, False)
    assert support["rhel-9"] == (True, True)


def test_errors_are_traced_back_to_the_block_that_made_them():
    lines = [
        "    info: Could not get GID for group 'shadow', (getgrnam: not found)",
        "    info: Promise belongs to bundle 'security_account_protection' in file "
        "'/var/cfengine/inputs/services/cfbs/security.cf' near line 74",
        "   error: None of the promised groups for '/etc/shadow' exist -- see INFO logs for more",
        "    info: Could not get GID for group 'shadow', (getgrnam: not found)",
        "    info: Promise belongs to bundle 'security_account_protection' in file "
        "'/var/cfengine/inputs/services/cfbs/security.cf' near line 74",
        "   error: None of the promised groups for '/etc/shadow' exist -- see INFO logs for more",
        "   error: Errors encountered when actuating files promise '/etc/shadow'",
        "R: Web server provisioning complete",
    ]
    source_map = {"./security.cf": {"group": [[60, 90]], "shadow-block": [[70, 76]]}}

    [problem] = cfpb_testenv.find_problems(lines, source_map, {"shadow-block": "file-1"})

    assert problem["block"] == "shadow-block"
    assert problem["fileId"] == "file-1"
    assert problem["count"] == 2
    assert problem["message"].startswith("None of the promised groups for '/etc/shadow' exist")
    assert problem["cause"] == ["Could not get GID for group 'shadow', (getgrnam: not found)"]


def test_errors_outside_the_project_keep_their_own_location():
    lines = [
        "    info: Promise belongs to bundle 'cfe_internal_update' in file '/var/cfengine/inputs/update.cf' near line 9",
        "   error: Something failed",
    ]

    [problem] = cfpb_testenv.find_problems(lines, {}, {})

    assert problem["block"] is None
    assert (problem["file"], problem["line"]) == ("/var/cfengine/inputs/update.cf", 9)


def test_custom_images_take_the_package_of_the_os_they_are():
    def platform(text: str):
        return cfpb_testenv.platform_of(cfpb_testenv.parse_os_release(text))

    assert platform('ID=rocky\nID_LIKE="rhel centos fedora"\nVERSION_ID="9.4"') == "rhel-9"
    assert platform('ID="ol"\nID_LIKE="fedora"\nVERSION_ID="8.10"') == "rhel-8"
    assert platform('ID=ubuntu\nVERSION_ID="24.04"') == "ubuntu-24"
    assert platform('ID=linuxmint\nID_LIKE="ubuntu debian"\nVERSION_ID=21.3\nUBUNTU_CODENAME=jammy') == "ubuntu-22"
    assert platform("ID=alpine\nVERSION_ID=3.20.0") is None
    assert platform("ID=debian\nVERSION_ID=11") is None


def test_a_registry_port_is_not_a_tag():
    assert cfpb_testenv.split_reference("registry.corp:5000/base/rhel9") == ("registry.corp:5000/base/rhel9", "latest")
    assert cfpb_testenv.split_reference("registry.corp:5000/base/rhel9:1.2") == ("registry.corp:5000/base/rhel9", "1.2")
    assert cfpb_testenv.split_reference("rockylinux:9") == ("rockylinux", "9")


@pytest.mark.parametrize("version", ["/victim", "../../victim", "3.27.1\n", "3.27", "", None])
def test_build_policy_refuses_a_masterfiles_version_that_is_not_a_release(tmp_path: Path, version):
    victim = tmp_path / "victim"
    victim.mkdir()
    (victim / "keep").write_text("mine")
    with pytest.raises(RunnerError, match="Unsupported masterfiles version"):
        cfpb_testenv.build_policy(
            {}, str(victim) if version == "/victim" else version, str(tmp_path / "cache"), str(tmp_path / "work")
        )
    assert (victim / "keep").read_text() == "mine"


def test_build_policy_never_deletes_outside_the_cache(tmp_path: Path):
    victim = tmp_path / "victim"
    victim.mkdir()
    (victim / "keep").write_text("mine")
    (tmp_path / "cache" / "masterfiles").mkdir(parents=True)
    (tmp_path / "cache" / "masterfiles" / "3.27.1").symlink_to(victim)
    with pytest.raises(RunnerError, match="Unsupported masterfiles version"):
        cfpb_testenv.build_policy({}, "3.27.1", str(tmp_path / "cache"), str(tmp_path / "work"))
    assert (victim / "keep").read_text() == "mine"


def _init_writing_cfbs_json(fail: bool):
    def init(directory: str, masterfiles: str):
        Path(directory, "cfbs.json").write_text("{}")
        if fail:
            raise cfpb_backend.InitFailed(f"Couldn't download masterfiles {masterfiles}")

    return init


class _Built(Exception):
    """Stops build_policy once the masterfiles are in place."""


def _stop_building(*_args):
    raise _Built()


def test_a_failed_masterfiles_download_leaves_no_cache_behind(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(cfpb_backend, "_run_cfbs_init", _init_writing_cfbs_json(fail=True))
    with pytest.raises(cfpb_backend.InitFailed):
        cfpb_testenv.build_policy({}, "3.27.1", str(tmp_path), str(tmp_path / "work"))
    assert os.listdir(tmp_path / "masterfiles") == [".lock"]


def test_a_masterfiles_download_moves_into_place_once_complete(tmp_path: Path, monkeypatch):
    (tmp_path / "masterfiles" / "3.27.1").mkdir(parents=True)  # a broken one: no cfbs.json
    monkeypatch.setattr(cfpb_backend, "_run_cfbs_init", _init_writing_cfbs_json(fail=False))
    monkeypatch.setattr(cfpb_backend, "_update_cfbs_json", _stop_building)
    with pytest.raises(_Built):
        cfpb_testenv.build_policy({}, "3.27.1", str(tmp_path), str(tmp_path / "work"))
    assert sorted(os.listdir(tmp_path / "masterfiles")) == [".lock", "3.27.1"]
    assert os.listdir(tmp_path / "masterfiles" / "3.27.1") == ["cfbs.json"]


def test_overlapping_runs_build_in_folders_of_their_own(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(cfpb_testenv, "build_policy", lambda content, masterfiles, cache, work: work)
    request = {"content": {}, "masterfiles": "3.27.1", "cacheDir": str(tmp_path)}
    with cfpb_testenv.built_policy(request) as first, cfpb_testenv.built_policy(request) as second:
        assert first != second
        assert Path(first).parent == Path(second).parent == tmp_path / "build"
        with cfpb_testenv.built_policy(request, first) as reused:
            assert reused == first
        assert Path(first).is_dir()
    assert os.listdir(tmp_path / "build") == []


@pytest.mark.skipif(sys.platform == "win32", reason="checks the lock with flock")
def test_the_masterfiles_lock_is_held_for_the_block(tmp_path: Path):
    import fcntl

    lock = tmp_path / ".lock"
    with cfpb_testenv._locked(str(lock)):
        with open(lock, "a+b") as other, pytest.raises(BlockingIOError):
            fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
    with open(lock, "a+b") as other:
        fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)


class _Running:
    def __init__(self, container_id: str):
        self.id = self.name = container_id


@pytest.mark.parametrize("hub_recreated", [True, False])
def test_a_recreated_hub_makes_every_client_bootstrap_to_it_again(monkeypatch, hub_recreated: bool):
    hosts = [{"id": h, "name": h, "platform": "ubuntu-24"} for h in ("hub", "a", "b")]
    before = {h: _Running(h) for h in ("hub", "a", "b")}
    after = {**before, "hub": _Running("new-hub") if hub_recreated else before["hub"]}
    bootstrapped = {"hub", "a", "b"} - ({"new-hub"} if hub_recreated else set())
    commands = []

    def run_in(engine, container, command, host, stream, environment=None, keep=None):
        commands.append((host, command.split()[0].rsplit("/", 1)[-1]))
        if command.startswith("rm -f /var/cfengine/policy_server.dat"):
            bootstrapped.discard(container.id)
        if "--bootstrap" in command:
            bootstrapped.add(container.id)
        return 0

    for name, fake in {
        "client": lambda: None,
        "sweep_orphans": lambda engine: None,
        "_network": lambda engine, env: None,
        "_labelled": lambda engine, env: before,
        "ensure_image": lambda *args: "image",
        "_ensure_container": lambda engine, env, host, image, environment: after[host["id"]],
        "_deploy": lambda *args: None,
        "_ip": lambda *args: "10.0.0.2",
        "_bootstrapped": lambda engine, container: container.id in bootstrapped,
        "run_in": run_in,
    }.items():
        monkeypatch.setattr(cfpb_testenv, name, fake)

    # Starting only "a": "b" also knew the old hub.
    cfpb_testenv.up({"environment": {"id": "e", "hub": "hub", "hosts": hosts}, "hosts": ["a"]}, masterfiles_dir="built")

    if hub_recreated:
        assert commands == [
            ("a", "rm"),
            ("b", "rm"),
            ("hub", "cf-agent"),
            ("a", "cf-agent"),
            ("b", "cf-agent"),
        ]
    else:
        assert commands == []


class _Container:
    def __init__(self, owner: str):
        self.labels, self.removed = {cfpb_testenv.LABEL_OWNER: owner}, False

    def remove(self, force: bool):
        self.removed = force


def test_sweep_removes_only_the_throwaway_containers_of_dead_sidecars():
    finished = subprocess.Popen([sys.executable, "-c", ""])
    finished.wait()
    host = socket.gethostname()
    dead, alive = _Container(f"{host}:{finished.pid}"), _Container(f"{host}:{os.getpid()}")
    elsewhere = _Container(f"other-machine:{finished.pid}")
    # A test host, whose image a builder made, keeps that builder's label.
    host_container = _Container(f"{host}:{finished.pid}")
    host_container.labels[cfpb_testenv.LABEL_ENV] = "env"
    queries = []

    class Containers:
        def list(self, all, filters):
            queries.append(filters)
            return [dead, alive, elsewhere, host_container]

    cfpb_testenv.sweep_orphans(type("Engine", (), {"containers": Containers()})())

    assert queries == [{"label": cfpb_testenv.LABEL_OWNER}]
    assert (dead.removed, alive.removed, elsewhere.removed, host_container.removed) == (True, False, False, False)
    assert cfpb_testenv.owner_labels() == {cfpb_testenv.LABEL_OWNER: f"{host}:{os.getpid()}"}
