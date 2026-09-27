/** Shared copy for the Skills catalog and workflow builder empty states. */

/** Full copy — the Skills tab's empty list (room for the frontmatter aside + a Refresh hint). */
export function SkillEmptyHint() {
  return (
    <>
      No skills yet. Install a skill for any coding agent and Cezar will find it here.
      Skills from a team repo appear here too — try Refresh.
    </>
  )
}

/** Compact copy — the workflow builder's skill palette, where space is tighter and there is no
 *  Refresh action on the surface itself. */
export function SkillEmptyHintCompact() {
  return (
    <>
      No skills yet — install a skill for any coding agent. Cezar will find it here alongside
      team skills.
    </>
  )
}
