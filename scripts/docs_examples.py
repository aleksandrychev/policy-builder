"""The Block reference's examples: each block of scripts/docs-examples.json compiled on its own,
as the policy it generates. Prints {block id: policy} as JSON (scripts/docs-blocks.mjs runs it).

    uv run --directory python python ../scripts/docs_examples.py
"""

import json
import sys
from pathlib import Path

from cfpb_compiler import Library, compile_project

EXAMPLES = Path(__file__).with_name("docs-examples.json")


def defaults(declared: list[dict]) -> dict[str, str]:
    """A parameter's default, or its first option; empty otherwise."""
    values = {}
    for param in declared:
        default = param.get("default")
        if isinstance(default, bool):
            default = str(default).lower()
        options = param.get("options") or []
        if default in (None, "") and options and param.get("required"):
            default = (
                options[0]["value"] if isinstance(options[0], dict) else options[0]
            )
        values[param["name"]] = "" if default is None else str(default)
    return values


def builder_bodies(policy: list[str]) -> list[str]:
    """The file's own bodies, other than its file control: those the builder adds for its blocks."""
    bodies, current = [], None
    for line in policy:
        if line.startswith("body ") and not line.startswith("body file control"):
            current = [line]
        elif current is not None:
            current.append(line)
            if line == "}":
                bodies.append("\n".join(current))
                current = None
    return bodies


def block_of(block_id: str, example: dict, descriptor: dict) -> dict:
    block = {
        "instanceId": "b",
        "blockId": block_id,
        "label": example["label"],
        "params": {},
    }
    if "entries" not in example:
        block["params"] = {
            **defaults(descriptor.get("parameters", [])),
            **example["params"],
        }
        return block
    sources = {source["id"]: source for source in descriptor["value_sources"]}
    name_param = descriptor["entries"]["name_param"]
    block["entries"] = [
        {
            "id": f"e{i}",
            "valueSourceId": entry["source"],
            "params": {
                name_param: entry["name"],
                **defaults(sources[entry["source"]]["parameters"]),
                **entry["params"],
            },
        }
        for i, entry in enumerate(example["entries"])
    ]
    return block


def main() -> int:
    library = Library.load()
    examples = json.loads(EXAMPLES.read_text())
    out = {}
    for block_id, example in examples.items():
        block = block_of(block_id, example, library.descriptors[block_id])
        file = {
            "id": "f",
            "name": "Example",
            "namespace": "example",
            "path": "./example.cf",
            "blocks": [block],
            "order": ["b"],
        }
        source_map: dict = {}
        policy = compile_project({"files": [file]}, source_map=source_map)[
            "./example.cf"
        ].splitlines()
        lines = [
            line
            for first, last in source_map["./example.cf"].get("b", [])
            for line in policy[first - 1 : last] + [""]
        ]
        if not lines:
            print(f"{block_id}: compiled to nothing", file=sys.stderr)
            return 1
        # Bodies Policy Builder writes into the file for it (mog_dirs…), so a bare name has its definition.
        text = "\n".join(lines)
        for body in builder_bodies(policy):
            name = body.split("\n")[0].split()[2].split("(")[0]
            if f"{name}(" in text and body not in text:
                lines += [body, ""]
        out[block_id] = "\n".join(lines).rstrip()
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
