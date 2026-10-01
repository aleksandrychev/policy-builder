"""Tests for the policy compiler (cfpb_compiler), against the demo project."""

from __future__ import annotations

import copy
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from cfpb_compiler import CompileError, compile_project, quote

FIXTURES = Path(__file__).parent / "fixtures"
# The demo project's meta["policy-builder"], as the app saves it.
DEMO = json.loads((FIXTURES / "demo-project.json").read_text())
COMMON, WEBSERVER = "./common.cf", "./webserver.cf"


def _demo() -> dict:
    return copy.deepcopy(DEMO)


def _webserver(meta: dict) -> dict:
    return next(file for file in meta["files"] if file["bundle"] == "webserver")


def _bundle(policy: str, name: str) -> str:
    """One bundle's body, up to the next bundle or body."""
    rest = policy.split(f"bundle agent {name}\n")[1]
    return rest.split("\nbundle ")[0].split("\nbody ")[0]


def test_compiles_every_file_to_its_path():
    assert list(compile_project(DEMO)) == [COMMON, WEBSERVER]


def test_the_entry_bundle_is_named_after_the_file_and_calls_blocks_in_order():
    policy = compile_project(DEMO)[WEBSERVER]
    calls = [
        line.split("usebundle => ")[1].rstrip(",;").split(",")[0]
        for line in policy.splitlines()
        if "usebundle =>" in line
    ]

    assert "bundle agent webserver\n" in policy
    assert "namespace" not in policy
    assert calls == [
        "webserver_install_web_server_package",
        "webserver_remove_conflicting_apache",
        "webserver_render_nginx_config",
        "webserver_restart_nginx_on_config_change",
        "webserver_remove_default_nginx_site",
        "webserver_lock_down_nginx_config_files",
        "webserver_create_deploy_user",
        "webserver_report_provisioning_done",
    ]
    assert "bundle agent webserver_install_web_server_package\n" in policy


def test_arrow_and_conditions_gate_the_calls():
    policy = compile_project(DEMO)[WEBSERVER]

    assert 'classes => results("bundle", "webserver_render_nginx_config");' in policy
    assert 'if => "webserver_render_nginx_config_repaired";' in policy
    assert policy.count('if => "webserver_role";') == 2


def test_references_name_the_defining_files_vars_bundle():
    files = compile_project(DEMO)

    assert "bundle common common_vars\n" in files[COMMON]
    assert '"$(common_vars.webserver_package)" policy => "present";' in files[WEBSERVER]


def test_default_if_empty_splits_into_an_intermediate_and_two_promises():
    policy = compile_project(DEMO)[COMMON]

    assert '"worker_processes__in"\n      int => length(' in policy
    assert 'not(strcmp("$(common_vars.worker_processes__in)", "0"))' in policy
    assert 'string => "auto",\n      if => not(isvariable("common_vars.worker_processes"));' in policy


def test_a_file_of_only_variables_and_classes_has_no_entry_bundle():
    policy = compile_project(DEMO)[COMMON]

    assert "bundle agent" not in policy


def test_a_template_gets_only_the_data_it_reads():
    render = _bundle(compile_project(DEMO)[WEBSERVER], "webserver_render_nginx_config")

    assert '"worker_processes" string => "$(common_vars.worker_processes)";' in render
    assert (
        """'{ "vars": { "common_vars": { "worker_processes": worker_processes, "worker_connections": worker_connections } } }'"""
        in render
    )
    assert "template_data => @(template_data);" in render


def _render_template(template: str) -> str:
    meta = _demo()
    block = next(b for b in _webserver(meta)["blocks"] if b["blockId"] == "render-template")
    block["params"]["template_content"] = template
    return _bundle(compile_project(meta)[WEBSERVER], "webserver_render_nginx_config")


def test_template_classes_become_true_or_false_and_special_variables_are_copied():
    render = _render_template("{{#classes.webserver_role}}on{{/classes.webserver_role}} {{{vars.sys.fqhost}}}")

    assert """'{ "classes": { "webserver_role": %s } }',""" in render
    assert 'ifelse("webserver_role", "true", "false")' in render
    assert '"fqhost" string => "$(sys.fqhost)";' in render


def test_a_template_reading_anything_else_keeps_datastate():
    render = _render_template("{{#-top-}}{{@}}{{/-top-}}")

    assert "template_data" not in render


def test_builder_bodies_are_defined_once_per_project():
    meta = _demo()
    common = meta["files"][0]
    common["blocks"].append(
        {
            "instanceId": "perms-in-common",
            "blockId": "set-permissions",
            "label": "Lock down logs",
            "params": {"path": "/var/log/nginx", "mode": "640", "owner": "root", "group": "adm"},
        }
    )
    common["order"] = ["perms-in-common"]

    files = compile_project(meta)

    assert files[COMMON].count("body perms mog_dirs(mode, user, group)") == 1
    assert "body perms mog_dirs" not in files[WEBSERVER]
    assert "perms => mog_dirs(" in files[WEBSERVER]


def test_a_list_parameter_iterates_only_with_several_values():
    policy = compile_project(DEMO)[WEBSERVER]

    assert '"path"\n      slist => { "/etc/nginx/nginx.conf", "/etc/nginx/conf.d/default.conf" };' in policy
    assert '"$(path)" perms =>' in policy
    assert '"apache2" policy => "absent";' in policy


def test_block_bundles_never_clash_with_each_other_or_masterfiles():
    meta = _demo()
    for block in _webserver(meta)["blocks"]:
        block["label"] = "Same"
    meta["files"].append({"id": "f3", "name": "Main", "bundle": "webserver_same", "path": "./webserver_same.cf"})

    policy = compile_project(meta)[WEBSERVER]

    assert "bundle agent webserver_same\n" not in policy
    assert "bundle agent webserver_same_2\n" in policy
    assert "bundle agent webserver_same_3\n" in policy


def test_a_block_missing_a_required_parameter_is_skipped_with_a_note():
    meta = _demo()
    next(b for b in _webserver(meta)["blocks"] if b["blockId"] == "manage-users")["params"]["username"] = ""

    policy = compile_project(meta)[WEBSERVER]

    assert '# Skipped "Create deploy user": Username not set.' in policy
    assert '"deploy"' not in policy


def test_the_file_condition_guards_every_call():
    meta = _demo()
    _webserver(meta)["condition"] = {"kind": "class", "className": "linux", "mode": "if"}

    policy = compile_project(meta)[WEBSERVER]

    assert "  methods:\n    linux::\n" in policy


def test_unknown_block_types_fail_the_compile():
    meta = _demo()
    _webserver(meta)["blocks"][0]["blockId"] = "no-such-block"

    with pytest.raises(CompileError, match="no-such-block"):
        compile_project(meta)


@pytest.mark.parametrize(
    "text, expected",
    [
        (r"\d+", r'"\d+"'),
        ('say "hi"', r'"say \"hi\""'),
        ("C:\\", r'"C:\\"'),
        # Checked with cf-agent: reads back as a\\b.
        (r"a\\b", r'"a\\\b"'),
    ],
)
def test_strings_escape_only_what_cfengine_would_misread(text: str, expected: str):
    assert quote(text) == expected


@pytest.mark.skipif(shutil.which("cf-promises") is None, reason="needs a local CFEngine")
def test_compiled_demo_passes_cf_promises(tmp_path: Path):
    for path, policy in compile_project(DEMO).items():
        (tmp_path / Path(path).name).write_text(policy)
    shutil.copy(FIXTURES / "stdlib-stub.cf", tmp_path / "stdlib.cf")
    (tmp_path / "promises.cf").write_text(
        'body common control { inputs => { "stdlib.cf", "common.cf", "webserver.cf" };'
        ' bundlesequence => { "webserver" }; }\n'
    )

    result = subprocess.run(["cf-promises", "-f", str(tmp_path / "promises.cf")], capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
