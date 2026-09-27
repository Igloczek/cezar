/**
 * The "no skills yet" copy shared by every empty state that tells a user where to drop skill
 * files — the Skills tab (`routes/skills.tsx`) and the workflow builder's skill palette
 * (`routes/workflows/workflows.tsx`). #374 (follow-up to #342): both used to mention only
 * `.ai/skills/`, while discovery also scans `.ai/cezar/skills/`, the portable
 * `.agents/skills/`, agent-specific project directories, global skill roots, and the team skills
 * repo (`src/skills.ts`). One shared list, so the two SURFACES render the same copy.
 *
 * The list below is a hand-copy of the server's portable discovery order, which lives in another
 * process (`SKILL_DIRS` in `src/skills.ts`) and cannot be imported into the bundle.
 * `test/unit/skill-dirs.test.ts` keeps those paths in sync; agent-specific directories are found
 * dynamically and are intentionally not enumerated here.
 */

/** Portable local project directories, in the server's precedence order. Agent-specific
 *  directories are discovered dynamically. Pinned by `test/unit/skill-dirs.test.ts`. */
const SKILL_PROJECT_DIRS = ['.ai/cezar/skills/', '.ai/skills/', '.agents/skills/'] as const

function Path({ children }: { children: string }) {
  return <span className="font-mono">{children}</span>
}

/** Renders `SKILL_PROJECT_DIRS` as "a, b, or c" with each entry in `<Path>`. */
function ProjectDirList() {
  return (
    <>
      {SKILL_PROJECT_DIRS.map((dir, index) => (
        <span key={dir}>
          {index > 0 ? (index === SKILL_PROJECT_DIRS.length - 1 ? ', or ' : ', ') : ''}
          <Path>{dir}</Path>
        </span>
      ))}
    </>
  )
}

/** Full copy — the Skills tab's empty list (room for the frontmatter aside + a Refresh hint). */
export function SkillEmptyHint() {
  return (
    <>
      No skills yet. Drop Markdown files into <ProjectDirList /> (agent-specific skill directories
      are discovered too) — optional frontmatter: <Path>name</Path>, <Path>description</Path>.
      Global (<Path>~/.agents/skills</Path> or the agent's configured skills directory) and
      team-repo skills appear here too — try Refresh.
    </>
  )
}

/** Compact copy — the workflow builder's skill palette, where space is tighter and there is no
 *  Refresh action on the surface itself. */
export function SkillEmptyHintCompact() {
  return (
    <>
      No skills yet — drop Markdown files into <ProjectDirList /> (or a global/team-repo skill
      source).
    </>
  )
}
