"""Custom CFEngine blocks: their text checked offline, and compiled into a bundle of their own."""

from __future__ import annotations

import json

import pytest
from test_cfpb_backend import _run

from cfpb_compiler import compile_project
from cfpb_custom import check, syntax_error

MIRROR = 'files:\n  "/var/www/site"\n    copy_from => mirror("/srv/site"),\n    depth_search => default:recurse("inf");'
BODY = 'body copy_from mirror(from)\n{\n  source => "$(from)";\n  purge => "true";\n}'


def test_problems_point_at_their_field_and_line():
    assert check(MIRROR, BODY, "site") == []
    [problem] = check(MIRROR.replace("default:recurse", "recurse"), BODY, "site")
    assert problem == {
        "field": "promises",
        "line": 4,
        "column": 21,
        "message": "recurse isn't defined in this block: from the standard library, write default:recurse",
    }
    [broken] = check(MIRROR, "body copy_from mirror(from)\n{\n  source => \n}", "site")
    assert (broken["field"], broken["line"], broken["message"]) == ("definitions", 3, "Syntax error")


def test_names_from_other_namespaces_are_left_to_testing():
    assert check('methods:\n  "x" usebundle => default:something_from_masterfiles;', "", "site") == []
    assert check('methods:\n  "x" usebundle => other:bundle_of_another_file;', "", "site") == []


def test_only_a_syntax_error_stops_the_compile():
    assert syntax_error(MIRROR.replace("default:recurse", "recurse"), BODY, "site") is None
    assert (
        syntax_error('files:\n  "/a" create => "true" copy_from => ;', "", "site")
        == "a syntax error in its promises, line 2"
    )


def test_lint_custom_checks_several_blocks(monkeypatch: pytest.MonkeyPatch):
    request = {
        "blocks": [
            {"id": "a", "namespace": "site", "promises": MIRROR, "definitions": BODY},
            {"id": "b", "namespace": "site", "promises": "files: ;", "definitions": ""},
        ]
    }
    code, out, _err = _run(["lint-custom"], json.dumps(request), monkeypatch)
    problems = json.loads(out)["problems"]
    assert code == 0
    assert problems["a"] == []
    assert problems["b"][0]["message"] == "Syntax error"
    assert _run(["lint-custom"], "[]", monkeypatch)[0] == 1


def _project(*blocks: dict) -> dict:
    return {
        "files": [
            {
                "id": "f",
                "path": "./site.cf",
                "namespace": "site",
                "order": [b["instanceId"] for b in blocks],
                "blocks": list(blocks),
            }
        ]
    }


def _custom(instance_id: str, label: str, promises: str = MIRROR, definitions: str = BODY) -> dict:
    return {
        "instanceId": instance_id,
        "blockId": "custom-cfengine",
        "label": label,
        "params": {"promises": promises, "definitions": definitions},
    }


def test_a_custom_block_runs_as_a_bundle_of_its_own():
    policy = compile_project(_project(_custom("c", "Mirror the site")))["./site.cf"]

    assert '"Mirror the site" usebundle => mirror_the_site;' in policy
    assert (
        '# Custom CFEngine "Mirror the site", run as one step of main.\nbundle agent mirror_the_site\n{\n  files:'
        in policy
    )
    assert "body copy_from mirror(from)\n{" in policy


def test_copied_blocks_define_their_bodies_once():
    policy = compile_project(_project(_custom("a", "Mirror one"), _custom("b", "Mirror two")))["./site.cf"]

    assert "bundle agent mirror_one" in policy and "bundle agent mirror_two" in policy
    assert policy.count("body copy_from mirror(from)") == 1


def test_a_custom_block_that_doesnt_parse_is_left_out_with_why():
    policy = compile_project(_project(_custom("c", "Broken", promises="files: ;")))["./site.cf"]

    assert '# Skipped "Broken": a syntax error in its promises, line 1.' in policy
    assert "bundle agent broken" not in policy


def test_blocks_around_a_custom_one_keep_their_lines():
    report = {"instanceId": "r", "blockId": "report-message", "label": "After it", "params": {"message": "done"}}
    source_map: dict = {}
    policy = compile_project(_project(_custom("c", "Mirror the site"), report), source_map=source_map)["./site.cf"]
    lines = policy.splitlines()
    ranges = source_map["./site.cf"]

    texts = [lines[first - 1].strip() for first, _last in ranges["c"]]
    assert texts == [
        "# Mirror the site",
        '# Custom CFEngine "Mirror the site", run as one step of main.',
        '# Bodies and bundles of Custom CFEngine "Mirror the site".',
    ]
    # The bodies run to the end of the file: every line of them.
    assert lines[ranges["c"][2][1] - 1] == "}"
    [[first, last]] = ranges["r"]
    assert lines[first - 1].strip() == "# After it" and '"done"' in "\n".join(lines[first - 1 : last])


def test_a_perms_body_without_rxdirs_is_pointed_out():
    # CFEngine 3.28 warns on every run: "Using the default value 'false' for attribute rxdirs".
    promises = 'files:\n  "/srv/app/.managed"\n    create => "true",\n    perms => locked;'
    [problem] = check(promises, 'body perms locked\n{\n  mode => "600";\n}', "site")
    assert (problem["field"], problem["line"]) == ("definitions", 1)
    assert problem["message"].startswith("body perms locked doesn't set rxdirs")
    assert check(promises, 'body perms locked\n{\n  mode => "600";\n  rxdirs => "false";\n}', "site") == []
