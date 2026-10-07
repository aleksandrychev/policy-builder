/**
 * The guide AI agents read (get_guide, the guide:// resources, the build_policy
 * prompt): how to work in Policy Builder well. Markdown, one page per topic.
 */

export interface GuidePage {
  summary: string;
  text: string;
  title: string;
}

const workflow = `# Working in CFEngine Policy Builder

Policy Builder builds CFEngine policy from blocks on a canvas. You change the project only through these tools; the app generates the .cf files and cfbs.json from the blocks when the project is saved. Editing generated files directly is lost (or refused) on the next save.

## The loop

1. **begin_work** with one sentence on what you're about to do. The user sees it, and the editor is locked so they don't edit at the same time. Always pair it with **end_work**.
2. **get_project_status** / **get_project_overview**: what's open, its files and their namespaces, what's selected. Open or create a project first if none is (create_project, open_project).
3. **Plan from the block catalog**: list_block_types, then get_block_type for each type you'll use. Use its parameter names, options and required fields exactly; values are checked like the Properties form checks them.
4. **Edit**: add_block, update_block, connect; variables and classes with add_entry; transformers; conditions. Each call is one undo step for the user.
5. **tidy_file** after adding or connecting several blocks, so the canvas reads top to bottom in run order.
6. **Check**: get_warnings (empty required parameters, values a parameter doesn't take, and notCompiled: blocks or entries the policy leaves out, with why), then get_generated_policy for the file you changed: read the promises you meant to write.
7. **save_project** when the change is complete.
8. **Test** when the user asks for it, a change is risky, or you built or translated a whole policy: offer it before saying you're done. See the testing guide.
9. **end_work** with a one-sentence summary.

If a call comes back "Stopped by the user", stop at once: say where you were and ask what to do.

## Good habits

- Name blocks by what they achieve, short and specific ("Install nginx", "Render nginx config"): the label names the block in the generated policy and in its outcome classes.
- Read before you write: get_file shows a file's blocks, run order, arrows and groups with ids.
- Prefer several small, clear blocks over one clever one; the canvas is for people to read.
- After a refusal, read the message: it says what's wrong and which tool shows the valid values.

Other guide topics: ${'`blocks`, `variables`, `conditions`, `testing`, `pitfalls`'}.`;

const blocks = `# Blocks, arrows and groups

## Blocks
- Each block compiles to one CFEngine promise (or a call to a standard-library bundle) in its file's \`main\` bundle, in run order.
- get_block_type lists parameters with \`required\`, \`default\`, \`options\` (the only values accepted), \`absolutePath\` and \`allowedChars\`. Parameters left out keep their defaults.
- Parameters with \`allowList\` take one value per line: the promise then iterates over them.
- Define Variable and Define Class hold entries instead of parameters: add the block without params, then add_entry (see the variables guide).

## Arrows (run order and outcomes)
- connect(sourceId, targetId, outcomes): the target runs only after the source ended with one of the outcomes: \`kept\` (already right), \`repaired\` (it changed something), \`not_kept\` (it failed).
- The default is kept + repaired: "after it succeeded".
- **Reacting to a change**: put a restart or reload behind a \`repaired\` arrow from what changes the config (e.g. Render Template → Manage Service with action restart). Without it, a restart runs on every agent run.
- **Handling a failure**: \`not_kept\` runs a block only when the source failed (a report, a fallback).
- Blocks without arrows run in canvas order; arrows can't form loops and can't connect Define Variable / Define Class blocks (use a condition on their classes instead).

## Groups
- group_blocks puts blocks into a frame that runs as one step (its own bundle). Arrows into and out of the group attach to its frame; an arrow out of a group reads the group's combined outcome.
- Use groups for a set of blocks that belong together ("Configure nginx"), and set_group_condition to gate them all.

## Layout
- New blocks are stacked under the lowest block. After adding or connecting several, call **tidy_file**: it lays the file out by run order, like the canvas's Tidy button (one undo step).`;

const variables = `# Variables, classes, references and transformers

## Namespaces and references
- Every policy file is a CFEngine namespace (get_project_overview shows it). It's fixed when the file is created: renaming the file doesn't change it.
- A variable lives in its file's \`vars\` bundle. Reference it as \`$(vars.name)\` in the same file (the generated policy writes it \`$(<namespace>:vars.name)\`, which is what CFEngine needs outside a promiser) and \`$(<namespace>:vars.name)\` from another file. In a Mustache template: \`{{{vars.<namespace>:vars.name}}}\` (lists: a section).
- A class from Define Class: \`name\` in the same file, \`<namespace>:name\` from another file.
- list_variables and list_classes give every definition with the exact reference forms: use them instead of building names yourself.

## Entries
- Add a Define Variable or Define Class block, then add_entry(blockId, name, valueSource, params, condition?). list_value_sources shows each source's parameters.
- Names must be unique within a file; class names can't be CFEngine hard classes (linux, debian…).
- **Per condition** values: \`cases\` is a JSON list of rows \`{"className": "debian", "mode": "if", "value": "nginx"}\`; the first row whose condition holds wins, else \`otherwise\`.

## Transformers (a value's data chain)
- add_transformer on an entry's value (or on a parameter computed from data) chains functions: e.g. lines of /proc/cpuinfo → grep "processor.*" → length gives the CPU count as an int.
- Types must fit: list_transformers shows each one's input → output (string, list, int, data). split-list makes a list; join, nth or length make a string or int again.
- Typed-in values (literal, list, JSON) take no transformers.

## Computed parameters
- bind_parameter makes a block's parameter come from data (a command's output, a file, another variable) instead of a typed-in value; transformers apply to it too. list_bindings shows them.`;

const conditions = `# Conditions

- A condition gates a block, an entry, a group or a whole file: \`{"className": "<class expression>", "mode": "if" | "unless"}\`; null removes it.
- Class expressions: \`linux\`, \`debian|redhat\` (or), \`linux.!debian\` (and not), parentheses for grouping.
- **Hard classes** (linux, debian, ubuntu_22, redhat, x86_64, Hr14…) are set by CFEngine on every host.
- **Classes the file doesn't define** are written as \`default:<name>\` in the generated policy (that's where masterfiles, augments and hard classes live): write them bare.
- **A class another file defines** needs its namespace: \`common:webserver_role\` (list_classes gives the exact form).
- Prefer a condition on a file or group over repeating it on every block.
- A condition decides whether a block runs at all; an arrow decides when it runs relative to another block and on which outcome.`;

const testing = `# Testing

Test environments are Docker containers running real CFEngine: the policy set is built (cfbs build with masterfiles), deployed to a hub, and the agent runs on each host.

1. get_docker_status: Docker must be running.
2. get_test_environments; if there's none, set_test_environment: hosts (\`platform\` from list_test_platforms, e.g. debian-12, rhel-9), which host is the hub, variables. One host can be its own hub.
3. run_tests: deploys and runs; it switches the app to Tests & Logs and waits (up to 10 minutes) for the outcome per host: compliance (kept / repaired / not kept %) and problems traced back to blocks (block id, label, file).
4. get_test_results (with logLines) for the log, or while a run is still going.
5. stop_test_environment (destroy: true removes the containers) when you're done, if the user wants the hosts gone.

Reading results:
- A problem names the block it came from: fix that block, then run again.
- The first run after a host is set up does most of the work (installing, writing files). If a run reports everything kept on a fresh host, read the log (get_test_results with logLines) for errors from that first run.
- **not converged**: a host still repaired something in its last run, so a promise changes the host every time (a command that always runs, a file rewritten each run). complianceByRun shows it; find the block before calling the policy done.
- Policy changed since the last run shows as \`policyChangedSince\`: run again to test the current blocks.`;

const pitfalls = `# Pitfalls

- **Don't edit generated files** (.cf, cfbs.json, templates/): the next save overwrites them from the blocks, or refuses to.
- **Parameter names come from get_block_type**, never from memory: e.g. Manage Service takes \`action\` (start, stop, restart…), Render Template takes \`destination\` and \`template_content\`.
- **Paths are absolute** where a parameter says absolutePath.
- **A restart without a "repaired" arrow** restarts the service on every agent run.
- **Namespaces don't follow renames**: reference variables and classes the way list_variables / list_classes show them.
- **The user can undo or delete your changes** in the app: if a block id is suddenly unknown, read the file again (get_file).
- **The user may stop you**: a "Stopped by the user" answer means stop and ask.
- **One change at a time** is easier for the user to follow and undo than a large rewrite.`;

export const GUIDE: Record<string, GuidePage> = {
  workflow: { title: 'Workflow', summary: 'How to work in Policy Builder, step by step (start here)', text: workflow },
  blocks: { title: 'Blocks, arrows and groups', summary: 'Parameters, outcomes and run order, groups, tidy', text: blocks },
  variables: { title: 'Variables and transformers', summary: 'Entries, namespaces and references, data chains, computed parameters', text: variables },
  conditions: { title: 'Conditions', summary: 'Class expressions, hard classes, namespaced classes', text: conditions },
  testing: { title: 'Testing', summary: 'Test environments in Docker, running tests, reading results', text: testing },
  pitfalls: { title: 'Pitfalls', summary: 'Mistakes agents make here, and how to avoid them', text: pitfalls }
};

export const GUIDE_TOPICS = Object.keys(GUIDE) as [string, ...string[]];

export function guideIndex(): string {
  return Object.entries(GUIDE)
    .map(([topic, page]) => `- \`${topic}\`: ${page.summary}`)
    .join('\n');
}
