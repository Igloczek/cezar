import { useProjects } from '@/api/queries'
import { ImportSkillsPanel } from '@/components/skills-import-panel'
import { SkillsSection } from './skills-section'

/** Workspace-wide controls and catalog curation for skills available from the cezar root. */
export function GlobalSkillsManagement() {
  const projects = useProjects()
  const updateProjectId = projects.data?.bootProject ?? ''

  return (
    <div data-slot="global-skills-management" className="flex flex-col gap-6 p-4 pb-[calc(90px+env(safe-area-inset-bottom))] md:p-6 md:pb-6">
      <SkillsSection />
      <section aria-label="Manage active skills" className="border-t border-border pt-5">
        <ImportSkillsPanel projectId={updateProjectId} />
      </section>
    </div>
  )
}
