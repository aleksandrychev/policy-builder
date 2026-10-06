# cfpb-backend

Python sidecar hosting the CFEngine toolchain. Electron spawns it once per
action: input on stdin, result on stdout, diagnostics on stderr with a
non-zero exit.

| Subcommand | stdin | stdout | exit codes |
| --- | --- | --- | --- |
| `format` (also the default with no subcommand) | policy | formatted policy | 1 syntax error, 2 other |
| `init` | `{"directory", "name", "description", "masterfiles", "git", "content"?}` | `{"path", "masterfiles"}` | 1 failed (cleaned up), 2 invalid input (nothing touched) |
| `masterfiles` | `{"version"}` (`3.27.1` or `master`) | the masterfiles `build` entry `cfbs init` writes | 1 failed, 2 invalid input |
| `compile` | the project's `.policy-builder/project.json` | `{"files": {<path>: <contents>}, "source_map": {<path>: {<block or group id>: [[first, last], …]}}}` | 1 can't compile, 2 compiler fault |
| `deploy` | `{"path", "host": "user@host[:port]", "key"?}` | `{"deployed", "log"}`: `cf-remote deploy`'s outcome and output | 2 invalid input |
| `testenv doctor` / `images` | nothing | one JSON object: Docker's state / the base images and which are pulled | 1 can't answer |
| `testenv package` | `{edition, version, platform, arch, hub}` | `{url, sha256, version, filename}` from CFEngine's release data | 1 no such package |
| `testenv pull` | `{image}` | streamed: one JSON event per line (`progress`, `log`, then `done` or `error`) | 1 failed |

`init` runs `cfbs init` in-process (non-interactive, `--git=no`) in `directory`,
which must be absent or empty, with an existing parent. `masterfiles` is an
exact version (`3.27.1`), `master`, or `no`; cfbs 5.7.0 mishandles branch names
like `3.24.x`, so they are refused. It then writes `name`/`description` into
`cfbs.json` via `cfbs.pretty`, and with `git` makes one commit (falling back to
cfbs's `cfbs <cfbs@hostname>` identity if git has none). The result's
`masterfiles` is the build entry cfbs wrote, or `null`. All cfbs output goes to
stderr; the last stderr line is a one-line summary for the UI. Any failure
removes what init created. With `content` (the builder's modules and its
`project` data, optionally `testEnvironments`), it also writes the modules into
`cfbs.json`, the data into `.policy-builder/project.json` (and
`test-environments.json`) and the compiled files, before the commit. With
`"type": "module"` there's no `cfbs init` and no masterfiles: `cfbs.json` is a
module project (`"type": "module"`, named after the module) whose `provides`
holds the project as one module.

`masterfiles` runs `cfbs init` in a throwaway folder and returns the masterfiles
entry it wrote: how a module project gets masterfiles when it becomes a policy set.

`compile` (`cfpb_compiler.py`) turns the builder's canvases into policy, one
formatted `.cf` per policy file plus the template files its blocks render (in
`./templates/`, which ships as one directory module), following the contract in
[`blocks/README.md`](../blocks/README.md). It reads the descriptors from the
repo's `blocks/`, which the PyInstaller bundle carries as data.

Managed with [uv](https://docs.astral.sh/uv/), which also fetches the
interpreter pinned in `.python-version`.

```sh
uv sync                                                    # .venv + deps
uv run pytest                                              # CFPB_NETWORK_TESTS=1 adds masterfiles downloads
uv run black .                                             # no linter here
uv run pyinstaller --clean --noconfirm cfpb-backend.spec   # → dist/cfpb-backend/
```

Also available from the repo root as `npm run backend:*`, which is what CI and
the packaging scripts use.

`deploy` runs `cf-remote deploy` in-process in the built project, which ships its
`out/masterfiles.tgz`; a chosen key goes in as `CF_REMOTE_SSH_KEY`. Bundling cf-remote brings ~27 MB of libcloud
drivers along.
