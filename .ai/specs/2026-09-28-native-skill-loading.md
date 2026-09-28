# Filesystem-only skill management across agent backends

Status: first implementation · 2026-09-28

## Problem and why the current design exists

`discoverSkills` builds one catalog for the Skills page, workflow `skill:` steps,
and chat `/name` completion. It reads Cezar's legacy Markdown directories,
agent install directories, global copies, and configured team repositories in
that precedence order. This catalog is useful even if agents load skills
themselves: the UI needs names and descriptions, and team repositories need a
cache and the existing `importedSkills` selection.

The runtime took a different route for historical reasons:

- Spec 005 chose a **bare** clone for team repositories, so no skill files were
  initially on disk for an agent. It added a selected-skill body to the system
  prompt and copied directory skills to `.claude/skills` for references. This
  predates the current mix of backends.
- Each task runs in a separate Git worktree. Gitignored local installations
  such as `.agents/skills` do not appear there. Commit `593f48bd` added the
  absolute main-checkout path to the system prompt so an agent could find
  companion files without another copy.
- Chat `/name` was Cezar's own catalog command. Commit `dfcaddf5` expanded it
  before delivery because backends did not agree on that command. Later fixes
  `ec4925a9` and `f5e93561` extended the same rewrite to continuations and
  fresh-run opening prompts.

Together, `packages/cezar/src/workflows/run.ts` and `skills-remote.ts`
guarantee loading only the **first** selected skill. A `/second-skill`
reference inside its Markdown is not a leading user message, so the chat
rewrite never sees it. A team skill is copied only to Claude's directory, and
local skill files may remain outside the task worktree. Thus the catalog's
precedence in `BACKWARD_COMPATIBILITY.md` describes Cezar's picker, not what
every running harness can discover.

## Proposed boundary

Use the installation half of [`vercel-labs/skills`](https://github.com/vercel-labs/skills)
as the model: a canonical skill directory plus symlinks into agent locations,
with copies where symlinks are unavailable. Its `skills use` command also
generates prompts; that is a separate feature and **not** the model here.

Cezar may discover, fetch, update, display, and install skills. Installation
runs while preparing a task worktree, including recovery. It uses the catalog
already available in the process, without waiting for a network refresh.
The agent's native loader owns skill selection, Markdown parsing, references,
and calls to other skills. A later phase can reconcile the project checkout
when a team catalog update finishes; this phase guarantees the task checkout.

1. Keep current discovery locations, precedence, API source values, and
   `importedSkills` selection. A missing team repo still degrades quietly. Do
   not require a new setting or rewrite a user's installation.
2. Install the **complete effective catalog available at task preparation** in
   each task worktree during filesystem setup.
   Preserve references, scripts, assets, and file modes. Link each skill into
   `.agents/skills/<name>/` for Codex, OpenCode, and Pi; link it into
   `.claude/skills/<name>/` for Claude Code. Copy where
   links are unsupported. Preserve the catalog winner on a name collision;
   never overwrite a user file. Recovery repairs missing links without
   modifying an agent prompt.
3. For a legacy flat `.md` source, create a temporary `<name>/SKILL.md`
   adapter with its existing body, name, and description. For a team skill,
   extract the complete directory from the cached revision. Generated files
   must stay out of task diffs without hiding real untracked skills in the
   main checkout.
4. Remove `expandRegistrySlashSkill*` and the selected-only `.claude/skills`
   materialization. A raw user message, including `/name`, reaches the
   harness byte-for-byte. Keep `skillSystemPrompt` only for saved legacy
   workflow steps with `skill:` and emit a migration warning. All new task
   paths create plain prompts that ask the harness to use the named skill.

This eliminates three prompt-delivery paths and the selected-skill special
case for new tasks. Only the installation boundary knows where skill files
belong. A future
harness can use the same canonical files through its documented loader path.

## Authoring nested skills

`/second-skill` in a `SKILL.md` body is text, not a portable command. Claude
Code accepts `/second-skill` as a direct user command; Codex uses `$name`, Pi
uses `/skill:name`, and OpenCode exposes a `skill` tool. Cezar should not parse
or rewrite Markdown bodies to emulate these commands. Team skills that call
other skills should say **“Use the `second-skill` skill”** and include a normal
relative link when they mean a supporting file. Making the files available
fixes discovery; existing slash-only instructions still need this authoring
change for reliable cross-backend use.

## Existing workflow and chat contracts

The strict filesystem boundary conflicts with Cezar's current behavior:
workflow `skill:` steps inject a body into the system prompt, and chat `/name`
is a Cezar command even when the selected harness has no such command. Removing
either changes working behavior. Do **not** leave `skill:` accepted while
silently turning it into mere availability metadata.

The workflow editor, New Task picker, GitHub task generator, automations editor,
and inbox task starter now create ordinary `prompt:` steps. Existing saved
`skill:` workflows are labeled legacy and still inject their body with a run
warning, as requested for this transition. Chat `/name` is sent unchanged to
the chosen harness; authors should use that harness's native invocation syntax
or plain language. The legacy injector can be deleted after saved workflows
have a migration path under `BACKWARD_COMPATIBILITY.md` §4–5.

## Compatibility and proof before replacing the old path

- Preserve `.ai/cezar/skills`, `.ai/skills`, current agent mirrors, globals,
  team-repo shapes, and local-first name precedence as required by
  `BACKWARD_COMPATIBILITY.md` §5. Do not make previously valid flat skills
  disappear from the catalog.
- A test skill A references skill B and `references/rules.md`; the task
  worktree exposes both full directories through `.agents/skills` and
  `.claude/skills`, including binary assets and executable file modes.
- Pin fresh-run, live-message, Continue, and restart paths. Assert the runner
  receives the user's text byte-for-byte, without skill body, absolute path,
  translated slash command, or name-only hint; prove that the test fails
  against the old behavior.
- Verify a clean task Git status and preserved source installations. Installation failures are reported at the
  catalog/worktree boundary; message delivery never compensates with a prompt.

The local E2E check launched Cezar with two fixture skills and a Codex task.
Codex's `skills/list` reported both as repository skills, and the run read the
second skill and the first skill's reference file before producing the expected
output. Other harnesses are covered by directory contract tests; they were not
available as authenticated local runners for this check.

The shared directory covers Cezar's four current backends. No orchestrator
can promise discovery by an arbitrary future harness with an unknown private
directory; support for one that ignores `.agents/skills` needs its documented
loader path at the same preparation boundary.

## Loader documentation

- [Codex, “Where Codex loads local skills”](https://learn.chatgpt.com/docs/build-skills)
- [Claude Code, “Choose where skills load”](https://code.claude.com/docs/en/skills)
- [OpenCode, “Place files”](https://opencode.ai/docs/skills)
- [Pi, “Understand how skills load”](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)
