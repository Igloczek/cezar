# Filesystem-only skill management across agent backends

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

Use the installation half of [`vercel-labs/skills`](https://github.com/vercel-labs/skills)
as the model: a canonical skill directory plus symlinks into agent locations,
with copies where symlinks are unavailable. Its `skills use` command also
generates prompts; that is a separate feature and **not** the model here.

Cezar may discover, fetch, update, display, and install skills. It must not
resolve a skill at message delivery or alter `userPrompt`, `systemPrompt`, or
message blocks because of a skill name. The agent's native loader owns skill
selection, Markdown parsing, references, and calls to other skills.

1. Keep current discovery locations, precedence, API source values, and
   `importedSkills` selection. A missing team repo still degrades quietly. Do
   not require a new setting or rewrite a user's installation.
2. Prepare the **complete effective catalog** before a harness starts in a
   project or task worktree. Preserve references, scripts, assets, and file
   modes. Link each skill into `.agents/skills/<name>/` for Codex, OpenCode,
   and Pi; link it into `.claude/skills/<name>/` for Claude Code. Copy where
   links are unsupported. Preserve the catalog winner on a name collision;
   never overwrite a user file. The filesystem step also runs after a restart
   when a worktree must be reconstructed.
3. For a legacy flat `.md` source, create a temporary `<name>/SKILL.md`
   adapter with its existing body, name, and description. For a team skill,
   extract the complete directory from the cached revision. Generated files
   must stay out of task diffs without hiding real untracked skills in the
   main checkout.
4. Remove `skillSystemPrompt`, `expandRegistrySlashSkill*`, and the
   selected-only `.claude/skills` materialization once the filesystem step
   covers each source. A raw user message, including `/name`, reaches the
   harness byte-for-byte. Cezar neither translates it into another command
   nor adds a “use this skill” hint.

This eliminates three prompt-delivery paths and the selected-skill special
case. Only the installation boundary knows where skill files belong. A future
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

The migration should stop creating new `skill:` steps in the workflow editor,
surface existing steps as legacy, and provide an explicit path to author an
ordinary `prompt:` step with the desired instruction. The same applies to the
New Task skill picker and chat `/name` autocomplete: they must either become
catalog-only UI or use an actual harness-native invocation surface, with no
hidden message rewrite. Existing saved workflows need a documented versioned
transition under `BACKWARD_COMPATIBILITY.md` §4–5 before the legacy runtime
path is deleted. Keeping the old injector temporarily during migration is a
compatibility phase, **not** the target architecture.

## Compatibility and proof before replacing the old path

- Preserve `.ai/cezar/skills`, `.ai/skills`, current agent mirrors, globals,
  team-repo shapes, and local-first name precedence as required by
  `BACKWARD_COMPATIBILITY.md` §5. Do not make previously valid flat skills
  disappear from the catalog.
- A test skill A references skill B and `references/rules.md`; the task
  worktree must expose both full directories to all four current backends,
  even when only A is selected. Test local, global, and team sources, name
  collisions, and a curated `importedSkills` list.
- Pin fresh-run, live-message, Continue, and restart paths. Assert the runner
  receives the user's text byte-for-byte, without skill body, absolute path,
  translated slash command, or name-only hint; prove that the test fails
  against the old behavior.
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
