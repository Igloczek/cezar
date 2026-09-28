# Native skill loading across agent backends

Status: proposal · 2026-09-28

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

Keep Cezar responsible for **catalog and availability**, then let the harness
read and apply `SKILL.md`. Before each new agent session, including Continue
and recovery, prepare the effective catalog in that session's working tree:

1. Keep current discovery locations, precedence, API source values, workflow
   YAML, and `importedSkills` behavior. A missing team repo still degrades
   quietly. Do not require a new setting or rewrite a user's installation.
2. Place each available skill's **complete directory**, including references,
   scripts, and assets, in `.agents/skills/<name>/`. Mirror it into
   `.claude/skills/<name>/` for Claude Code. Codex, OpenCode, and Pi discover
   `.agents/skills`; Claude Code discovers `.claude/skills` (sources below).
   Preserve the catalog winner when names collide. Never overwrite a user file.
3. For a legacy flat `.md` skill, create a temporary `<name>/SKILL.md` adapter
   with its existing body, name, and description. For a team skill, extract the
   complete directory from the cached revision. Keep generated files out of
   task diffs without hiding real untracked skills in the main checkout.
4. A workflow `skill:` or a leading catalog `/name` asks the agent to use the
   installed skill **by name**. Stop copying its body or an absolute path into
   the system prompt. Keep unknown slash commands untouched. Remove the old
   prompt expansion only after fresh runs, live messages, and continuations
   share this behavior and the native loaders can see the files.

This replaces selected-team-skill handling with one preparation step at the
runner boundary. The existing delivery paths can share a small name-only
translation for Cezar's `/name` command. Each harness then parses the skill, loads its
references, and choosing another installed skill when instructed.

## Authoring nested skills

`/second-skill` in a `SKILL.md` body is text, not a portable command. Claude
Code accepts `/second-skill` as a direct user command; Codex uses `$name`, Pi
uses `/skill:name`, and OpenCode exposes a `skill` tool. Cezar should not parse
or rewrite Markdown bodies to emulate these commands. Team skills that call
other skills should say **“Use the `second-skill` skill”** and include a normal
relative link when they mean a supporting file. Existing `/name` references
remain readable to the model, but reliable cross-backend invocation requires
this source-level wording change.

## Compatibility and proof before replacing the old path

- Preserve `.ai/cezar/skills`, `.ai/skills`, current agent mirrors, globals,
  team-repo shapes, and local-first name precedence as required by
  `BACKWARD_COMPATIBILITY.md` §5. Do not make previously valid flat skills
  disappear from the picker or workflows.
- A test skill A references skill B and `references/rules.md`; the task
  worktree must expose both full directories to all four current backends,
  even when only A is selected. Test local, global, and team sources, name
  collisions, and a curated `importedSkills` list.
- Pin the fresh-run, live-message, Continue, and restart paths. Assert the
  runner receives a skill name without the Markdown body or a main-checkout
  absolute path; prove that the test fails against the old behavior.
- Verify a clean task Git status, preserved source installations, an offline
  team repo, and an in-place run. A failed preparation must produce a visible
  note when a requested skill cannot be loaded, rather than silently telling
  the agent to use a missing skill.

The shared directory covers Cezar's four current backends. No orchestrator
can promise discovery by an arbitrary future harness with an unknown private
directory; support for one that ignores `.agents/skills` needs its documented
loader path at the same preparation boundary.

## Loader documentation

- [Codex, “Where Codex loads local skills”](https://learn.chatgpt.com/docs/build-skills)
- [Claude Code, “Choose where skills load”](https://code.claude.com/docs/en/skills)
- [OpenCode, “Place files”](https://opencode.ai/docs/skills)
- [Pi, “Understand how skills load”](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)
