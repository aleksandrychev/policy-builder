"""Tests for the policy compiler (cfpb_compiler), against the demo project."""

from __future__ import annotations

import copy
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from cfpb_compiler import CompileError, compile_project, quote, templates_module

FIXTURES = Path(__file__).parent / "fixtures"
# The demo project's .policy-builder/project.json, as the app saves it.
DEMO = json.loads((FIXTURES / "demo-project.json").read_text())
COMMON, WEBSERVER = "./common.cf", "./webserver.cf"
TEMPLATE = "./templates/webserver_render_nginx_config.mustache"
TOP_DOWN = 'body file control\n{\n  evaluation_order => "top_down";\n}'


def _demo() -> dict:
    return copy.deepcopy(DEMO)


def _webserver(meta: dict) -> dict:
    return next(file for file in meta["files"] if file["bundle"] == "webserver")


def _block(policy: str, label: str) -> str:
    """One block's part of the entry bundle: from its label comment to the next block's."""
    rest = policy.split(f"\n  # {label}\n")[1]
    return rest.split("\n  # ")[0].split("\n}")[0]


def test_compiles_every_file_to_its_path_and_templates_into_templates():
    assert list(compile_project(DEMO)) == [
        COMMON,
        WEBSERVER,
        TEMPLATE,
        "./templates/webserver_publish_the_demo_landing_page.mustache",
    ]


def test_every_file_evaluates_top_down():
    files = compile_project(DEMO)

    assert TOP_DOWN in files[COMMON]
    assert TOP_DOWN in files[WEBSERVER]


def test_every_block_is_a_promise_of_the_entry_bundle_in_canvas_order():
    policy = compile_project(DEMO)[WEBSERVER]
    labels = [line[4:] for line in policy.splitlines() if line.startswith("  # ")]

    assert "namespace" not in policy
    assert policy.count("bundle agent ") == 1
    assert "bundle agent webserver\n" in policy
    assert "methods:" not in policy
    assert labels == [
        "Install web server package",
        "Remove conflicting Apache",
        "Render nginx config",
        "Restart nginx on config change",
        "Keep nginx running",
        "Publish the demo landing page",
        "Remove default nginx site",
        "Lock down nginx config files",
        "Create deploy user",
        "Report provisioning done",
    ]


def test_arrows_and_conditions_gate_the_promises():
    policy = compile_project(DEMO)[WEBSERVER]

    assert 'classes => results("bundle", "webserver_render_nginx_config");' in policy
    restart = _block(policy, "Restart nginx on config change")
    assert (
        '"nginx"\n      service_policy => "restart",\n      if => "webserver_render_nginx_config_repaired";' in restart
    )
    assert policy.count('if => "webserver_role"') == 2
    # Whatever touches nginx's files waits for its package.
    installed = 'if => "webserver_install_web_server_package_kept|webserver_install_web_server_package_repaired"'
    assert policy.count(installed) == 3


def test_references_name_the_defining_files_vars_bundle():
    files = compile_project(DEMO)

    assert "bundle common common_vars\n" in files[COMMON]
    assert '"$(common_vars.webserver_package)"' in files[WEBSERVER]


def test_a_template_is_its_own_file_used_as_written():
    files = compile_project(DEMO)
    render = _block(files[WEBSERVER], "Render nginx config")
    template = next(b for b in _webserver(DEMO)["blocks"] if b["blockId"] == "render-template")["params"][
        "template_content"
    ]

    assert files[TEMPLATE] == template
    assert 'edit_template => "$(this.promise_dirname)/templates/webserver_render_nginx_config.mustache",' in render
    assert 'template_method => "mustache",' in render


def test_a_nested_file_finds_the_templates_from_its_own_folder():
    meta = _demo()
    _webserver(meta)["path"] = "./services/db/webserver.cf"

    policy = compile_project(meta)["./services/db/webserver.cf"]

    assert '"$(this.promise_dirname)/../../templates/webserver_render_nginx_config.mustache"' in policy


def test_templates_ship_as_one_directory_module_only_when_there_are_any():
    assert templates_module(compile_project(DEMO)) == {
        "name": "./templates/",
        "description": "Local subdirectory added using cfbs command line",
        "tags": ["local"],
        "added_by": "cfbs add",
        "steps": ["directory ./ services/cfbs/templates/"],
    }
    meta = _demo()
    _webserver(meta)["blocks"] = [b for b in _webserver(meta)["blocks"] if b["blockId"] != "render-template"]
    assert templates_module(compile_project(meta)) is None


def test_a_template_gets_only_the_data_it_reads_named_after_its_block():
    render = _block(compile_project(DEMO)[WEBSERVER], "Render nginx config")

    assert '"render_nginx_config_worker_processes"\n      string => "$(common_vars.worker_processes)";' in render
    assert """'{ "vars": { "common_vars": { "worker_processes": render_nginx_config_worker_processes, \
"worker_connections": render_nginx_config_worker_connections } } }'""" in render
    assert "template_data => @(render_nginx_config_template_data)," in render


def _render_template(template: str) -> str:
    meta = _demo()
    block = next(b for b in _webserver(meta)["blocks"] if b["blockId"] == "render-template")
    block["params"]["template_content"] = template
    return _block(compile_project(meta)[WEBSERVER], "Render nginx config")


def test_template_classes_become_true_or_false_and_special_variables_are_copied():
    render = _render_template("{{#classes.webserver_role}}on{{/classes.webserver_role}} {{{vars.sys.fqhost}}}")

    assert """'{ "classes": { "webserver_role": %s } }',""" in render
    assert 'ifelse("webserver_role", "true", "false")' in render
    assert '"render_nginx_config_fqhost" string => "$(sys.fqhost)";' in render


def test_a_template_reading_anything_else_keeps_datastate():
    render = _render_template("{{#-top-}}{{@}}{{/-top-}}")

    assert "template_data" not in render


def test_default_if_empty_splits_into_an_intermediate_and_two_promises():
    policy = compile_project(DEMO)[COMMON]

    assert '"worker_processes__in"\n      int => length(' in policy
    assert 'not(strcmp("$(common_vars.worker_processes__in)", "0"))' in policy
    assert 'string => "auto",\n      if => not(isvariable("common_vars.worker_processes"));' in policy


def test_a_chain_is_explained_step_by_step_from_its_summary_patterns():
    policy = compile_project(DEMO)[COMMON]

    assert (
        "    # The lines of /proc/cpuinfo\n"
        "    # → keep entries matching processor.*\n"
        "    # → count the entries\n"
        '    # → fall back to "auto" if unset or "0"\n'
        '    "worker_processes__in"\n'
    ) in policy


def test_a_parameter_computed_from_data_is_a_local_variable_named_after_its_block():
    meta = _demo()
    block = next(b for b in _webserver(meta)["blocks"] if b["blockId"] == "install-package")
    split = {"id": "s", "decoratorId": "split-list", "params": {}}
    block["paramBindings"] = {
        "package_name": {
            "valueSourceId": "command-output",
            "params": {"command": "/usr/bin/list-pkgs"},
            "decorators": [split],
        }
    }

    install = _block(compile_project(meta)[WEBSERVER], "Install web server package")

    assert '    # The stdout of "/usr/bin/list-pkgs"\n    # → split into a list on "\\n"\n' in install
    assert '    "install_web_server_package_package_name"\n' in install
    assert '"$(install_web_server_package_package_name)"' in install


def test_a_list_parameter_iterates_only_with_several_values():
    policy = compile_project(DEMO)[WEBSERVER]

    assert (
        '"lock_down_nginx_config_files_path"\n'
        '      slist => { "/etc/nginx/nginx.conf", "/etc/nginx/conf.d/default.conf" };'
    ) in policy
    assert '"$(lock_down_nginx_config_files_path)"' in policy
    assert '"apache2"\n      policy => "absent",' in policy


def test_a_file_of_only_variables_and_classes_has_no_entry_bundle():
    assert "bundle agent" not in compile_project(DEMO)[COMMON]


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


def test_block_names_never_clash():
    meta = _demo()
    for block in _webserver(meta)["blocks"]:
        if block["blockId"] in ("install-package", "remove-package"):
            block["label"] = "Same"
            block.setdefault("condition", None)
    meta["files"].append({"id": "f3", "name": "Other", "bundle": "webserver_same", "path": "./webserver_same.cf"})

    policy = compile_project(meta)[WEBSERVER]

    # webserver_same is another file's entry bundle: the blocks' results classes keep clear of it.
    assert '"webserver_same"' not in policy
    assert 'results("bundle", "webserver_same_2")' in policy


def test_a_block_missing_a_required_parameter_is_skipped_with_a_note():
    meta = _demo()
    next(b for b in _webserver(meta)["blocks"] if b["blockId"] == "manage-users")["params"]["username"] = ""

    policy = compile_project(meta)[WEBSERVER]

    assert '# Skipped "Create deploy user": Username not set.' in policy
    assert '"deploy"' not in policy


def test_the_file_condition_guards_every_promise():
    meta = _demo()
    _webserver(meta)["condition"] = {"kind": "class", "className": "linux", "mode": "if"}

    policy = compile_project(meta)[WEBSERVER]

    assert "  packages:\n    linux::\n" in policy
    assert "  reports:\n    linux::\n" in policy


@pytest.mark.parametrize("name, expected", [("linux", "!linux"), ("linux|darwin", "!(linux|darwin)")])
def test_unless_negates_the_whole_expression(name: str, expected: str):
    meta = _demo()
    block = next(b for b in _webserver(meta)["blocks"] if b["blockId"] == "manage-users")
    block["condition"] = {"kind": "class", "className": name, "mode": "unless"}

    users = _block(compile_project(meta)[WEBSERVER], "Create deploy user")

    assert f'if => "{expected}"' in users


def _custom_class(expression: str) -> dict:
    entry = {"id": "e", "valueSourceId": "custom", "params": {"class_name": "custom", "condition": expression}}
    block = {"instanceId": "c", "blockId": "define-class", "label": "Classes", "params": {}, "entries": [entry]}
    return {"files": [{"id": "f", "name": "T", "bundle": "t", "path": "./t.cf", "blocks": [block]}]}


@pytest.mark.parametrize(
    "expression, compiled",
    [
        ("linux.!(debian|redhat)", '"linux.!(debian|redhat)"'),
        ("role_$(sys.uqhost)", '"role_$(sys.uqhost)"'),
        ('not(fileexists("/x"))', 'not(fileexists("/x"))'),
        ('and(linux, isvariable("sys.fqhost"))', 'and(linux, isvariable("sys.fqhost"))'),
    ],
)
def test_a_custom_class_expression_is_written_as_is(expression: str, compiled: str):
    assert f'"custom" expression => {compiled};' in compile_project(_custom_class(expression))["./t.cf"]


@pytest.mark.parametrize(
    "expression", ['not(fileexists("/x")', 'fileexists("/etc/hosts").linux', "linux |", "linux debian", "(linux"]
)
def test_a_malformed_custom_class_expression_is_skipped_with_a_note(expression: str):
    policy = compile_project(_custom_class(expression))["./t.cf"]

    assert "# Skipped custom: not a valid class expression or function call." in policy
    assert "expression =>" not in policy


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


@pytest.mark.skipif(shutil.which("cf-promises") is None, reason="needs a local CFEngine 3.27+")
def test_compiled_demo_passes_cf_promises(tmp_path: Path):
    for path, policy in compile_project(DEMO).items():
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_text(policy)
    shutil.copy(FIXTURES / "stdlib-stub.cf", tmp_path / "stdlib.cf")
    (tmp_path / "promises.cf").write_text(
        'body common control { inputs => { "stdlib.cf", "common.cf", "webserver.cf" };'
        ' bundlesequence => { "webserver" }; }\n'
    )

    result = subprocess.run(["cf-promises", "-f", str(tmp_path / "promises.cf")], capture_output=True, text=True)

    assert result.returncode == 0, result.stderr


def _grouped_demo() -> dict:
    """The demo with Render config + Restart nginx in a group, arrows attached to its frame."""
    meta = _demo()
    file = _webserver(meta)
    ids = {block["label"]: block["instanceId"] for block in file["blocks"]}
    for label in ("Render nginx config", "Restart nginx on config change"):
        next(b for b in file["blocks"] if b["label"] == label)["groupId"] = "g1"
    file["groups"] = [
        {"id": "g1", "name": "Configure nginx", "condition": {"kind": "class", "className": "linux", "mode": "if"}}
    ]
    file["layout"]["groups"] = [{"id": "g1", "name": "Configure nginx", "color": "info"}]
    for edge in file["edges"]:
        if edge["target"] == ids["Render nginx config"]:
            edge["target"] = "g1"
    file["edges"].append(
        {"id": "e-out", "source": "g1", "target": ids["Keep nginx running"], "outcomes": ["kept", "repaired"]}
    )
    return meta


def test_a_group_is_its_own_bundle_called_as_one_step():
    policy = compile_project(_grouped_demo())[WEBSERVER]
    group = policy.split("bundle agent webserver_configure_nginx\n")[1]
    entry = policy.split("bundle agent webserver\n")[1].split("\n}")[0]

    assert '  # Group: Configure nginx\n  methods:\n    "Configure nginx"\n' in entry
    call = _block(policy, "Group: Configure nginx")
    assert "usebundle => webserver_configure_nginx," in call
    assert (
        'if => "linux.(webserver_install_web_server_package_kept|webserver_install_web_server_package_repaired)"'
        in call
    )
    assert 'classes => results("bundle", "webserver_configure_nginx");' in call
    keep = _block(policy, "Keep nginx running")
    assert keep.endswith('.(webserver_configure_nginx_kept|webserver_configure_nginx_repaired)";\n')
    # Arrows inside the group stay inside its bundle.
    assert "# Render nginx config" not in entry
    assert 'classes => results("bundle", "webserver_render_nginx_config");' in group
    assert 'if => "webserver_render_nginx_config_repaired"' in group


@pytest.mark.skipif(shutil.which("cf-promises") is None, reason="needs a local CFEngine 3.27+")
def test_compiled_groups_pass_cf_promises(tmp_path: Path):
    for path, policy in compile_project(_grouped_demo()).items():
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_text(policy)
    shutil.copy(FIXTURES / "stdlib-stub.cf", tmp_path / "stdlib.cf")
    (tmp_path / "promises.cf").write_text(
        'body common control { inputs => { "stdlib.cf", "common.cf", "webserver.cf" };'
        ' bundlesequence => { "webserver" }; }\n'
    )

    result = subprocess.run(["cf-promises", "-f", str(tmp_path / "promises.cf")], capture_output=True, text=True)

    assert result.returncode == 0, result.stderr


def test_the_source_map_points_at_each_block_and_group():
    meta = _grouped_demo()
    source_map: dict = {}
    lines = compile_project(meta, source_map=source_map)[WEBSERVER].splitlines()
    ids = {block["label"]: block["instanceId"] for block in _webserver(meta)["blocks"]}
    where = source_map[WEBSERVER]

    [[first, last]] = where[ids["Keep nginx running"]]
    assert lines[first - 1] == "  # Keep nginx running"
    assert lines[last - 1].endswith('";')
    call, bundle = where["g1"]
    assert lines[call[0] - 1] == "  # Group: Configure nginx"
    assert lines[bundle[0] : bundle[1]][0] == "bundle agent webserver_configure_nginx"
    assert lines[bundle[1] - 1] == "}"
