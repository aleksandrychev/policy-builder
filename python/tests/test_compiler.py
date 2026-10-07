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


def _file_control(namespace: str) -> str:
    return f'body file control\n{{\n  namespace => "{namespace}";\n  evaluation_order => "top_down";\n}}'


def _demo() -> dict:
    return copy.deepcopy(DEMO)


def _webserver(meta: dict) -> dict:
    return next(file for file in meta["files"] if file["namespace"] == "webserver")


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


def test_every_file_is_its_own_namespace_evaluated_top_down():
    files = compile_project(DEMO)

    assert _file_control("common") in files[COMMON]
    assert _file_control("webserver") in files[WEBSERVER]


def test_every_block_is_a_promise_of_the_entry_bundle_in_canvas_order():
    policy = compile_project(DEMO)[WEBSERVER]
    labels = [line[4:] for line in policy.splitlines() if line.startswith("  # ")]

    assert policy.count("bundle agent ") == 1
    assert "bundle agent main\n" in policy
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

    assert 'classes => default:results("bundle", "render_nginx_config");' in policy
    restart = _block(policy, "Restart nginx on config change")
    assert '"nginx"\n      service_policy => "restart",\n      if => "render_nginx_config_repaired";' in restart
    assert policy.count('if => "common:webserver_role"') == 2
    # Whatever touches nginx's files waits for its package.
    installed = 'if => "install_web_server_package_kept|install_web_server_package_repaired"'
    assert policy.count(installed) == 3


def test_references_name_the_defining_files_namespace():
    files = compile_project(DEMO)

    assert "bundle common vars\n" in files[COMMON]
    assert '"$(common:vars.webserver_package)"' in files[WEBSERVER]


def test_classes_the_file_doesnt_define_are_the_default_namespaces():
    meta = _demo()
    _webserver(meta)["condition"] = {"kind": "class", "className": "linux.!policy_server", "mode": "if"}

    policy = compile_project(meta)[WEBSERVER]

    assert "    default:linux.!default:policy_server::\n" in policy
    assert 'if => "common:webserver_role"' in policy


def test_a_class_the_file_defines_stays_bare():
    meta = _demo()
    common = meta["files"][0]
    common["condition"] = {"kind": "class", "className": "webserver_role", "mode": "if"}

    assert "    webserver_role::\n" in compile_project(meta)[COMMON]


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

    assert (
        '"render_nginx_config_tpl_worker_processes"\n      string => "$(common:vars.worker_processes)",\n'
        '      if => isvariable("common:vars.worker_processes");'
    ) in render
    assert """'{ "vars": { "common:vars": { "worker_processes": render_nginx_config_tpl_worker_processes, \
"worker_connections": render_nginx_config_tpl_worker_connections } } }'""" in render
    assert "template_data => @(render_nginx_config_template_data)," in render


def _render_template(template: str) -> str:
    meta = _demo()
    block = next(b for b in _webserver(meta)["blocks"] if b["blockId"] == "render-template")
    block["params"]["template_content"] = template
    return _block(compile_project(meta)[WEBSERVER], "Render nginx config")


def test_template_classes_become_true_or_false():
    render = _render_template("{{#classes.common:webserver_role}}on{{/classes.common:webserver_role}}")

    assert """'{ "classes": { "common:webserver_role": %s } }',""" in render
    assert 'ifelse("common:webserver_role", "true", "false")' in render


def test_a_template_falls_back_to_datastate_while_any_variable_it_reads_is_unset():
    render = _render_template("{{{vars.common:vars.worker_connections}}}")

    assert 'if => isvariable("common:vars.worker_connections");' in render
    assert 'data => datastate(),\n      unless => isvariable("render_nginx_config_template_data");' in render


def test_a_template_reading_variables_the_project_doesnt_define_keeps_datastate():
    render = _render_template(
        "{{{vars.common:vars.worker_connections}}} {{#vars.sys.interfaces}}{{.}}{{/vars.sys.interfaces}}"
    )

    assert "template_data" not in render


def test_a_template_reading_anything_else_keeps_datastate():
    render = _render_template("{{#-top-}}{{@}}{{/-top-}}")

    assert "template_data" not in render


def test_a_template_computed_from_data_renders_inline():
    meta = _demo()
    block = next(b for b in _webserver(meta)["blocks"] if b["blockId"] == "render-template")
    block["paramBindings"] = {
        "template_content": {"valueSourceId": "file-content", "params": {"path": "/srv/nginx.conf.mustache"}}
    }

    files = compile_project(meta)
    render = _block(files[WEBSERVER], "Render nginx config")

    assert TEMPLATE not in files
    assert 'edit_template_string => "$(render_nginx_config_template_content)",' in render
    assert 'template_method => "inline_mustache",' in render
    assert "template_data" not in render


@pytest.mark.parametrize(
    "source, rows",
    [
        ("command-output", 'mergedata(string_split("$(set_settings)", "\\n", "100000"))'),
        ("file-lines", 'mergedata("t:main.set_settings")'),
    ],
)
def test_key_value_settings_computed_from_data_are_split_at_run_time(source: str, rows: str):
    params = {"command": "/bin/cat /srv/sshd"} if source == "command-output" else {"path": "/srv/sshd"}
    block = {
        "instanceId": "s",
        "blockId": "set-config-values",
        "label": "Set",
        "params": {"path": "/etc/ssh/sshd_config"},
        "paramBindings": {"settings": {"valueSourceId": source, "params": params}},
    }
    meta = {"files": [{"id": "f", "name": "T", "namespace": "t", "path": "./t.cf", "blocks": [block]}]}

    policy = compile_project(meta)["./t.cf"]

    assert f"data => {rows};" in policy
    assert '"set_settings__array[$(set_settings__kv_$(set_settings__i)[key])]"' in policy
    assert '"t:main.set_settings__array",' in policy


def test_template_copies_keep_clear_of_parameters_computed_from_data():
    meta = _demo()
    block = next(b for b in _webserver(meta)["blocks"] if b["blockId"] == "render-template")
    block["params"]["template_content"] = "{{{vars.common:vars.owner}}}"
    meta["files"][0]["blocks"][0]["entries"].append(
        {"id": "o", "valueSourceId": "literal", "params": {"variable_name": "owner", "value": "www"}}
    )
    block["paramBindings"] = {"owner": {"valueSourceId": "command-output", "params": {"command": "/usr/bin/id -un"}}}

    render = _block(compile_project(meta)[WEBSERVER], "Render nginx config")

    assert '"render_nginx_config_owner"\n      string => execresult(' in render
    assert '"render_nginx_config_tpl_owner"\n      string => "$(common:vars.owner)",' in render


def test_default_if_empty_splits_into_an_intermediate_and_two_promises():
    policy = compile_project(DEMO)[COMMON]

    assert '"worker_processes__in"\n      int => length(' in policy
    assert 'not(strcmp("$(common:vars.worker_processes__in)", "0"))' in policy
    assert 'string => "auto",\n      if => not(isvariable("common:vars.worker_processes"));' in policy


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


def test_a_literal_list_in_a_chain_is_inline_json_that_reads_back_as_written():
    items = ["it's", "C:\\", "\\d+", 'say "hi"']
    entry = {"id": "l", "valueSourceId": "list", "params": {"variable_name": "l", "items": "\n".join(items)}}
    entry["decorators"] = [{"id": "d", "decoratorId": "sort", "params": {}}]
    block = {"instanceId": "v", "blockId": "define-variable", "label": "V", "params": {}, "entries": [entry]}
    meta = {"files": [{"id": "f", "name": "T", "namespace": "t", "path": "./t.cf", "blocks": [block]}]}

    policy = compile_project(meta)["./t.cf"]

    # Checked with cf-agent: sorts to C:\, \d+, it's, say "hi".
    assert r"""'["it\'s", "C:\\\\", "\\\d+", "say \\"hi\\""]'""" in policy


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


def test_every_file_defines_the_builder_bodies_it_uses_in_its_namespace():
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
    assert files[WEBSERVER].count("body perms mog_dirs(mode, user, group)") == 1
    assert "perms => mog_dirs(" in files[WEBSERVER]


def test_block_names_never_clash():
    meta = _demo()
    for block in _webserver(meta)["blocks"]:
        if block["blockId"] in ("install-package", "remove-package"):
            block["label"] = "Same"
            block.setdefault("condition", None)
        if block["blockId"] == "render-template":
            block["label"] = "Main"

    files = compile_project(meta)

    assert 'results("bundle", "same")' in files[WEBSERVER]
    # main is the entry bundle: a block named Main gets main_2 (its template too).
    assert 'results("bundle", "main_2")' in files[WEBSERVER]
    assert "./templates/webserver_main_2.mustache" in files


def test_two_files_sharing_a_namespace_fail_the_compile():
    meta = _demo()
    meta["files"][0]["namespace"] = "webserver"

    with pytest.raises(CompileError, match="share the namespace 'webserver'"):
        compile_project(meta)


def test_a_project_saved_with_bundle_names_compiles_them_as_namespaces():
    meta = _demo()
    for file in meta["files"]:
        file["bundle"] = file.pop("namespace")

    assert compile_project(meta) == compile_project(DEMO)


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

    assert "  packages:\n    default:linux::\n" in policy
    assert "  reports:\n    default:linux::\n" in policy


def test_line_breaks_in_labels_stay_inside_their_comments():
    meta = _demo()
    injected = 'Users\n  commands:\n    "/bin/sh -c evil";'
    next(b for b in _webserver(meta)["blocks"] if b["blockId"] == "manage-users")["label"] = injected
    meta["files"][0]["blocks"][0]["label"] = injected

    files = compile_project(meta)

    for policy in (files[COMMON], files[WEBSERVER]):
        assert '  # Users commands: "/bin/sh -c evil";\n' in policy
        assert "commands:\n" not in policy


def test_names_with_characters_they_cant_hold_are_skipped_with_a_note():
    call = {"label": "Run", "bundle_name": "x;\nbundle agent evil"}
    variable = {"variable_name": "a b", "value": "1"}
    reference = {"variable_name": "copy", "from_variable": "vars.x) }; evil"}
    blocks = [
        {"instanceId": "m", "blockId": "call-method", "label": "Call", "params": call},
        {
            "instanceId": "v",
            "blockId": "define-variable",
            "label": "V",
            "params": {},
            "entries": [
                {"id": "1", "valueSourceId": "literal", "params": variable},
                {"id": "2", "valueSourceId": "list-variable", "params": reference},
            ],
        },
    ]
    meta = {"files": [{"id": "f", "name": "T", "namespace": "t", "path": "./t.cf", "blocks": blocks}]}

    policy = compile_project(meta)["./t.cf"]

    assert '# Skipped "Call": Bundle name not valid.' in policy
    assert "# Skipped a b: Variable name not valid." in policy
    assert "# Skipped copy: 't:vars.x) }; evil' isn't a variable name." in policy
    assert "evil" not in policy.replace("# Skipped copy: 't:vars.x) }; evil'", "")


def test_a_file_namespace_that_isnt_a_name_fails_the_compile():
    meta = _demo()
    _webserver(meta)["namespace"] = "webserver {}\nbundle agent evil"

    with pytest.raises(CompileError, match="isn't a valid namespace"):
        compile_project(meta)


def test_a_condition_that_isnt_a_class_expression_fails_the_compile():
    meta = _demo()
    _webserver(meta)["condition"] = {"kind": "class", "className": 'any::\n"/bin/sh" usebundle => evil', "mode": "if"}

    with pytest.raises(CompileError, match="isn't a valid class expression"):
        compile_project(meta)


@pytest.mark.parametrize(
    "name, expected", [("linux", "!default:linux"), ("linux|darwin", "!(default:linux|default:darwin)")]
)
def test_unless_negates_the_whole_expression(name: str, expected: str):
    meta = _demo()
    block = next(b for b in _webserver(meta)["blocks"] if b["blockId"] == "manage-users")
    block["condition"] = {"kind": "class", "className": name, "mode": "unless"}

    users = _block(compile_project(meta)[WEBSERVER], "Create deploy user")

    assert f'if => "{expected}"' in users


def test_entries_that_run_commands_run_them_only_in_cf_agent():
    command = {"variable_name": "out", "command": "/bin/hostname"}
    variable = {"id": "v", "valueSourceId": "command-output", "params": command}
    variable["condition"] = {"kind": "class", "className": "linux", "mode": "if"}
    check = {
        "id": "c",
        "valueSourceId": "check-command-succeeds",
        "params": {"class_name": "ok", "command": "/bin/true"},
    }
    blocks = [
        {"instanceId": "v", "blockId": "define-variable", "label": "V", "params": {}, "entries": [variable]},
        {"instanceId": "c", "blockId": "define-class", "label": "C", "params": {}, "entries": [check]},
    ]
    meta = {"files": [{"id": "f", "name": "T", "namespace": "t", "path": "./t.cf", "blocks": blocks}]}

    policy = compile_project(meta)["./t.cf"]

    assert 'execresult("/bin/hostname", "noshell", "stdout"),\n      if => "agent.default:linux";' in policy
    assert 'expression => returnszero("/bin/true", "noshell"),\n      if => "agent";' in policy
    assert policy.count('"agent') == 2


def _custom_class(expression: str) -> dict:
    entry = {"id": "e", "valueSourceId": "custom", "params": {"class_name": "custom", "condition": expression}}
    block = {"instanceId": "c", "blockId": "define-class", "label": "Classes", "params": {}, "entries": [entry]}
    return {"files": [{"id": "f", "name": "T", "namespace": "t", "path": "./t.cf", "blocks": [block]}]}


@pytest.mark.parametrize(
    "expression, compiled",
    [
        ("linux.!(debian|redhat)", '"default:linux.!(default:debian|default:redhat)"'),
        ("role_$(sys.uqhost)", '"role_$(sys.uqhost)"'),
        ('not(fileexists("/x"))', 'not(fileexists("/x"))'),
        ('and(linux, isvariable("sys.fqhost"))', 'and(linux, isvariable("sys.fqhost"))'),
    ],
)
def test_a_custom_class_expression_is_written_in_the_files_namespace(expression: str, compiled: str):
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
        # \' is an escape too: reads back as it\'s.
        (r"it\'s", r'''"it\\'s"'''),
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
        ' bundlesequence => { "webserver:main" }; }\n'
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
    group = policy.split("bundle agent configure_nginx\n")[1]
    entry = policy.split("bundle agent main\n")[1].split("\n}")[0]

    assert '  # Group: Configure nginx\n  methods:\n    "Configure nginx"\n' in entry
    call = _block(policy, "Group: Configure nginx")
    assert "usebundle => configure_nginx," in call
    assert 'if => "default:linux.(install_web_server_package_kept|install_web_server_package_repaired)"' in call
    assert 'classes => default:results("bundle", "configure_nginx");' in call
    keep = _block(policy, "Keep nginx running")
    assert keep.endswith('.(configure_nginx_kept|configure_nginx_repaired)";\n')
    # Arrows inside the group stay inside its bundle.
    assert "# Render nginx config" not in entry
    assert 'classes => default:results("bundle", "render_nginx_config");' in group
    assert 'if => "render_nginx_config_repaired"' in group


@pytest.mark.skipif(shutil.which("cf-promises") is None, reason="needs a local CFEngine 3.27+")
def test_compiled_groups_pass_cf_promises(tmp_path: Path):
    for path, policy in compile_project(_grouped_demo()).items():
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_text(policy)
    shutil.copy(FIXTURES / "stdlib-stub.cf", tmp_path / "stdlib.cf")
    (tmp_path / "promises.cf").write_text(
        'body common control { inputs => { "stdlib.cf", "common.cf", "webserver.cf" };'
        ' bundlesequence => { "webserver:main" }; }\n'
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
    assert lines[bundle[0] : bundle[1]][0] == "bundle agent configure_nginx"
    assert lines[bundle[1] - 1] == "}"
