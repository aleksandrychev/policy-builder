"""Test environments: finding the Docker Engine and the CFEngine package for a host."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

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
