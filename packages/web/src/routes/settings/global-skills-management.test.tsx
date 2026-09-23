import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { queryKeys, workspaceQueryKeys } from '@/api/queries'
import { createQueryClient } from '@/api/query-client'
import type { WorkspaceConfigResponse } from '@open-mercato/cezar-api-client'
import { AppRoutes } from '@/routes'

const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = []

function renderPage() {
  requests.length = 0
  const config: WorkspaceConfigResponse = {
    browseRoot: '~/', projectsDir: '~/projects', skillsAutoUpdate: null,
    effectiveSkillsAutoUpdate: true,
    composerDefaults: { autonomous: null, worktree: null, inheritedAutonomous: 'source-dependent', inheritedWorktree: false },
    resources: { maxParallel: 2, maxMonitoringSessions: 2, monitoringWakeIntervalMinutes: null, autoResumeOnUsageLimit: true, memoryLimitMb: null, worktreeRetentionDefault: 10 },
    agentDefaults: {},
  }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
    requests.push({ method, url, body })
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/v1/workspace/config' && method === 'GET') return json(config)
    if (url === '/api/v1/workspace/config' && method === 'PUT') return json(config)
    if (url === '/api/v1/workspace/projects') return json({ projects: [], bootProject: 'boot', projectsDir: '~/projects' })
    if (url === '/api/v1/workspace/skills-update?projectId=boot') return json({ status: 'current', available: false, autoUpdateEnabled: true, inherited: true, checkedAt: null, updatedAt: null, needsUpgradeNotes: false, scopes: [] })
    if (url === '/api/v1/workspace/ui-state' && method === 'GET') return json({})
    if (url === '/api/v1/workspace/ui-state' && method === 'PUT') return json(body ?? {})
    if (url.includes('/skills/importable')) return json([{ name: 'code-review', description: 'Review changes' }, { name: 'write-tests', description: 'Write tests' }])
    return json([])
  }))
  const client = createQueryClient()
  client.setQueryData(queryKeys.health, { bootProject: 'boot' })
  client.setQueryData(workspaceQueryKeys.projects, { projects: [], bootProject: 'boot', projectsDir: '~/projects' })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/settings/global/skills']}><AppRoutes /></MemoryRouter></QueryClientProvider>)
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('GlobalSkillsManagement', () => {
  it('keeps workspace auto-update controls and presents the global importable catalog', async () => {
    renderPage()
    expect(await screen.findByRole('switch', { name: 'Update Open Mercato skills automatically' })).toBeTruthy()
    expect(await screen.findByRole('checkbox', { name: /code-review/ })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /write-tests/ })).toBeTruthy()
    expect(requests.some((request) => request.url.includes('/skills/importable'))).toBe(true)
    expect(requests.some((request) => request.url === '/api/v1/workspace/config')).toBe(true)
  })

  it('curates active skills in workspace UI state and loads the workspace global catalog from its unscoped API route', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('checkbox', { name: /code-review/ }))
    await waitFor(() => expect(requests.some((request) => request.method === 'PUT' && request.url === '/api/v1/workspace/ui-state' && request.body?.importedSkills?.toString() === 'write-tests')).toBe(true))
    expect(requests.some((request) => request.url === '/api/v1/skills/importable')).toBe(true)
    expect(requests.some((request) => request.url.includes('/p/'))).toBe(false)
  })
})
