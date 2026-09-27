/**
 * The "no skills yet" copy shared by every empty state that tells a user where to drop skill
 * files — the Skills tab (`routes/skills.tsx`) and the workflow builder's skill palette
 * (`routes/workflows/workflows.tsx`). #374 (follow-up to #342): both used to mention only
 * `.ai/skills/`, while discovery also scans `.ai/cezar/skills/`, installed
 * project and global skills, and the team skills repo (`src/skills.ts`).
 *
 * The list below is a hand-copy of Cezar's own paths (`SKILL_DIRS` in `src/skills.ts`).
 * `test/unit/skill-dirs.test.ts` keeps it in sync.
 */

/** Cezar's local project directories, in server precedence order. */
const SKILL_PROJECT_DIRS = ['.ai/cezar/skills/', '.ai/skills/'] as const

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
      No skills yet. Add a Markdown file to <ProjectDirList />, or install a skill with{' '}
      <Path>npx skills</Path>. Skills installed in your home and skills from a team repo appear
      here too — try Refresh.
    </>
  )
}

/** Compact copy — the workflow builder's skill palette, where space is tighter and there is no
 *  Refresh action on the surface itself. */
export function SkillEmptyHintCompact() {
  return (
    <>
      No skills yet — add a Markdown file to <ProjectDirList /> or install one with{' '}
      <Path>npx skills</Path>.
    </>
  )
}
