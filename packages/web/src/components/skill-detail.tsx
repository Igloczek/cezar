import { ArrowRightIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from '@/lib/project-router'

import { useHealth, useLaunchKey, useProjects } from '@/api/queries'
import type { Skill } from '@open-mercato/cezar-api-client'
import { repoChipOf } from '@/components/app-shell-container'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toaster'
import { bookmarkletUrl } from '@/lib/bookmarklet'
import { isProjectSkill } from '@/lib/skills'
import { useActiveProjectId } from '@/lib/project-router'
import { cn } from '@/lib/utils'

import { Markdown } from '@/routes/task-thread/markdown'

/**
 * The ONE skill detail rendering (R6 Step 1.4, spec §"Skills, Workflows, Inbox"): the
 * Skills catalog pane and the "View skill" preview the pickers open
 * (GitHub tab, /new composer) both render THIS component — the two surfaces can never drift.
 *
 * Body is markdown (the redesign upgrade over the legacy `<pre>`), through the same
 * Streamdown/Shiki path the thread uses.
 */

/** The source tag every skill listing shows — project sources read emphasized (#377). */
export function SkillSourceTag({ source, className }: { source: Skill['source']; className?: string }) {
  const project = isProjectSkill({ source })
  return (
    <span
      data-slot="skill-source"
      data-source={source}
      className={cn(
        'shrink-0 rounded-full border border-border px-2 py-px font-mono text-[10.5px]',
        project ? 'font-semibold text-foreground' : 'text-soft-foreground',
        className,
      )}
    >
      {source}
    </span>
  )
}

export function SkillDetailBody({
  skill,
  usedBy,
  heading: Heading = 'h2',
  enabled = true,
}: {
  skill: Skill
  /** "workflow › step" breadcrumbs (`skillUsedBy`). Omit to hide the section (the pickers'
   *  preview has no workflow catalog at hand — absence must not read as "unused"). */
  usedBy?: readonly string[]
  heading?: 'h2' | 'h3'
  enabled?: boolean
}) {
  return (
    <div data-slot="skill-detail" className="mx-auto w-full min-w-0 max-w-[var(--measure)]">
      <section data-slot="skill-properties" className="rounded-lg border border-border bg-muted/20 p-4">
        <p className="mb-3 text-[11px] font-semibold tracking-[.04em] text-soft-foreground uppercase">
          Properties
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <Heading className="min-w-0 font-mono text-lg font-semibold break-all">{skill.name}</Heading>
          <SkillSourceTag source={skill.source} />
          {!enabled ? (
            <span data-slot="skill-status" className="rounded-full border border-border px-2 py-px font-mono text-[10.5px] text-soft-foreground">
              disabled
            </span>
          ) : null}
        </div>
        <p data-slot="skill-path" className="mt-1 font-mono text-[10.5px] break-all text-soft-foreground">
          {skill.path}
          {skill.team ? ` · from ${skill.team.repo}` : ''}
        </p>
        {skill.description ? (
          <p data-slot="skill-description" className="mt-2.5 text-[13px] text-muted-foreground">
            {skill.description}
          </p>
        ) : null}

        {enabled ? <SkillBookmarklet skill={skill} /> : null}

        {usedBy !== undefined ? (
          <section data-slot="skill-used-by" className="mt-4 border-t border-border pt-4">
            <h3 className="text-[11px] font-semibold tracking-[.04em] text-soft-foreground uppercase">
              Used by
            </h3>
            {usedBy.length > 0 ? (
              <ul className="mt-1.5 flex flex-col gap-1">
                {usedBy.map((entry) => (
                  <li key={entry} className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                    <ArrowRightIcon aria-hidden="true" className="size-3 shrink-0 text-soft-foreground" />
                    {entry}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-soft-foreground">
                Not referenced by any workflow yet — quick-task picks it up when the task mentions it.
              </p>
            )}
          </section>
        ) : null}
      </section>

      <section data-slot="skill-content" className="mt-6 min-w-0 border-t border-border pt-5">
        <h3 className="text-[11px] font-semibold tracking-[.04em] text-soft-foreground uppercase">Content</h3>
        <div data-slot="skill-body" className="mt-3 text-sm">
          <Markdown>{skill.body}</Markdown>
        </div>
      </section>
    </div>
  )
}

function SkillBookmarklet({ skill }: { skill: Skill }) {
  const launchKey = useLaunchKey()
  const health = useHealth()
  const projects = useProjects()
  const [auto, setAuto] = useState(false)
  const anchor = useRef<HTMLAnchorElement>(null)
  const key = launchKey.data?.key ?? ''
  const origin = window.location.origin
  const projectId = useActiveProjectId() ?? health.data?.bootProject ?? null
  const repoName =
    projects.data?.projects.find((project) => project.id === projectId)?.name ??
    repoChipOf(health.data)?.name ??
    null
  const url = bookmarkletUrl(skill.name, auto, key, origin, projectId)

  useEffect(() => {
    anchor.current?.setAttribute('href', url)
  }, [url])

  return (
    <section data-slot="skill-run-from-github" className="mt-5 border-t border-border pt-4">
      <h3 className="text-[11px] font-semibold tracking-[.04em] text-soft-foreground uppercase">Run from GitHub</h3>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Drag the button to your bookmarks bar, then click it on a GitHub PR or issue.
      </p>
      <div className="mt-3 flex items-center gap-2 text-xs font-medium">
        <Switch
          data-slot="bookmarklet-auto"
          size="sm"
          aria-label="Start automatically"
          checked={auto}
          onCheckedChange={setAuto}
        />
        <span>Start automatically</span>
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        <a
          ref={anchor}
          draggable
          title="Drag me to your bookmarks bar"
          onClick={(event) => {
            event.preventDefault()
            toast('Drag me to your bookmarks bar')
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 font-mono text-xs font-medium shadow-xs hover:bg-muted"
        >
          {repoName ? `/${skill.name} (${repoName})` : `/${skill.name}`}
        </a>
        <button
          type="button"
          data-slot="skill-bookmarklet-copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url)
              toast('Bookmarklet URL copied.')
            } catch {
              toast('Copy failed — drag the button instead.', { tone: 'danger' })
            }
          }}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Copy
        </button>
      </div>
      <p className="mt-2 text-xs text-soft-foreground">
        To update an existing bookmarklet after changing this option, drag the button to your bookmarks bar again.
      </p>
    </section>
  )
}

/**
 * The read-only "View skill" preview the cmdk pickers open. `skill === null` keeps the dialog
 * mounted-but-closed so open/close animates. The footer link jumps to the full catalog entry.
 */
export function SkillPreviewDialog({ skill, onClose }: { skill: Skill | null; onClose: () => void }) {
  return (
    <Dialog open={skill !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        data-slot="skill-preview"
        className="block max-h-[80dvh] overflow-y-auto sm:max-w-2xl"
      >
        {skill ? (
          <>
            {/* The visible title is SkillDetailBody's heading; these two feed the dialog a11y contract. */}
            <DialogTitle className="sr-only">{skill.name}</DialogTitle>
            <DialogDescription className="sr-only">Skill preview with GitHub launcher</DialogDescription>
            <SkillDetailBody skill={skill} heading="h3" />
            <p className="mt-5">
              <Link
                to={`/skills?skill=${encodeURIComponent(skill.name)}`}
                data-slot="skill-preview-manage"
                onClick={onClose}
                className="text-xs font-semibold text-violet hover:underline"
              >
                Open in the Skills catalog
              </Link>
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
