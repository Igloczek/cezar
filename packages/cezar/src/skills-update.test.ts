import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillsUpdateConflictError, SkillsUpdateCoordinator, SkillsUpdateService } from './skills-update.ts';

const oldDryRun = process.env.CEZ_DRY_RUN;
afterEach(() => { if (oldDryRun === undefined) delete process.env.CEZ_DRY_RUN; else process.env.CEZ_DRY_RUN = oldDryRun; });

async function fixture(project: unknown, global?: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'cez-skills-update-'));
  const home = join(root, 'home'); const repo = join(root, 'repo');
  await mkdir(join(home, '.agents'), { recursive: true }); await mkdir(repo);
  if (project !== undefined) await writeFile(join(repo, 'skills-lock.json'), typeof project === 'string' ? project : JSON.stringify(project));
  if (global !== undefined) await writeFile(join(home, '.agents', '.skill-lock.json'), typeof global === 'string' ? global : JSON.stringify(global));
  return { home, repo };
}

describe('SkillsUpdateService', () => {
  beforeEach(() => { process.env.CEZ_DRY_RUN = '0'; });

  it('fails closed for malformed and unknown locks without executing', async () => {
    for (const value of ['{oops', { version: 99, skills: {} }, { version: 3, nope: {} }]) {
      const { home, repo } = await fixture(value); const run = vi.fn();
      const state = await new SkillsUpdateService({ homeDir: home, run, resolveNpx: async () => '/npx' }).check(repo);
      expect(run).not.toHaveBeenCalled(); expect(state.scopes[0]?.status).toBe('unavailable');
    }
  });

  it('inventories mixed sources without invoking a potentially mutating upstream check', async () => {
    const lock = { version: 3, skills: { zed: { source: 'acme/skills' }, alpha: { sourceUrl: 'https://example.test/team/skills' } } };
    const { home, repo } = await fixture(lock, lock); const run = vi.fn();
    const state = await new SkillsUpdateService({ homeDir: home, run, resolveNpx: async () => '/npx' }).check(repo);
    expect(run).not.toHaveBeenCalled(); expect(state.available).toBe(false);
    expect(state.scopes.map((s) => s.skills)).toEqual([['alpha', 'zed'], ['alpha', 'zed']]);
    expect(state.scopes[0]?.reason).toBeUndefined();
  });

  it('runs updates for every installed source with explicit scope and bounded timeout', async () => {
    const lock = { skills: { om: { source: 'open-mercato/skills' }, other: { source: 'acme/skills' } } };
    const { home, repo } = await fixture(lock, lock); const calls: string[][] = [];
    const run = vi.fn(async (_file: string, args: readonly string[], _cwd: string, timeout: number) => {
      calls.push([...args]); expect(timeout).toBe(1234); return { stdout: '', stderr: '' };
    });
    const service = new SkillsUpdateService({ homeDir: home, run, resolveNpx: async () => '/npx', timeoutMs: 1234 });
    await service.check(repo); await service.update(repo);
    expect(calls).toEqual([['--yes', 'skills', 'update', '-p', '-y'], ['--yes', 'skills', 'update', '-g', '-y']]);
  });

  it('normalizes missing CLI, timeout and command failures without exposing child output', async () => {
    const lock = { skills: { skill: { source: 'any/source' } } };
    const { home, repo } = await fixture(lock);
    const missing = new SkillsUpdateService({ homeDir: home, resolveNpx: async () => null });
    expect((await missing.update(repo)).scopes[0]?.reason).toBe('npx is unavailable');
    const timed = new SkillsUpdateService({ homeDir: home, resolveNpx: async () => 'npx', timeoutMs: 5,
      run: async () => { throw Object.assign(new Error('token=secret'), { killed: true }); } });
    const state = await timed.update(repo);
    expect(state.scopes[0]?.reason).toBe('update check timed out');
    expect(JSON.stringify(state)).not.toContain('secret');
  });

  it('returns deterministic dry-run state without files, tools, or network', async () => {
    process.env.CEZ_DRY_RUN = '1'; const run = vi.fn();
    const state = await new SkillsUpdateService({ homeDir: '/missing', run, resolveNpx: async () => { throw new Error('no'); } }).check('/missing');
    expect(state.status).toBe('current'); expect(run).not.toHaveBeenCalled();
  });

  it('preserves per-scope partial update outcomes', async () => {
    const lock = { skills: { alpha: { source: 'open-mercato/skills' } } };
    const { home, repo } = await fixture(lock, lock);
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[2] === 'update' && args.includes('-g')) throw new Error('failed secret');
      return { stdout: args[2] === 'check' ? 'alpha update available' : '', stderr: '' };
    });
    const service = new SkillsUpdateService({ homeDir: home, resolveNpx: async () => 'npx', run });
    await service.check(repo);
    const state = await service.update(repo);
    expect(state.status).toBe('error');
    expect(state.scopes[0]).toMatchObject({ scope: 'project', updatedAt: expect.any(String) });
    expect(state.scopes[1]).toMatchObject({ scope: 'global', status: 'error', reason: 'update check failed' });
    expect(JSON.stringify(state)).not.toContain('secret');
  });

  it('deduplicates concurrent update calls and dry-run never executes', async () => {
    const lock = { skills: { alpha: { source: 'open-mercato/skills' } } };
    const { home, repo } = await fixture(lock);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[2] === 'update') await gate;
      return { stdout: args[2] === 'check' ? 'alpha update available' : '', stderr: '' };
    });
    const service = new SkillsUpdateService({ homeDir: home, resolveNpx: async () => 'npx', run });
    await service.check(repo);
    const one = service.update(repo); const two = service.update(repo); release();
    expect(await one).toBe(await two);
    expect(run.mock.calls.filter((call) => call[1][2] === 'update')).toHaveLength(1);

    process.env.CEZ_DRY_RUN = '1';
    const dryRun = vi.fn();
    const dry = new SkillsUpdateService({ run: dryRun, resolveNpx: async () => 'npx' });
    expect((await dry.update(repo)).needsUpgradeNotes).toBe(true);
    expect(dryRun).not.toHaveBeenCalled();
  });

});

describe('SkillsUpdateCoordinator', () => {
  it('queues lifecycle work, excludes missing/removed projects, owns auto apply, and swallows failures', async () => {
    const service = {
      check: vi.fn(async (root: string) => {
        if (root === '/bad') throw new Error('offline');
        return { available: false, scopes: [{ skills: ['skill'] }] };
      }),
      update: vi.fn(async () => ({ available: false })),
      evict: vi.fn(),
    } as unknown as SkillsUpdateService;
    const coordinator = new SkillsUpdateCoordinator(service, async () => true);
    coordinator.start([{ id: 'gone', root: '/gone', status: 'missing' }, { id: 'bad', root: '/bad' }]);
    coordinator.add('later', '/later');
    coordinator.add('removed', '/removed');
    coordinator.remove('removed');
    await expect(coordinator.settled()).resolves.toBeUndefined();
    expect(service.check).toHaveBeenCalledWith('/bad');
    expect(service.check).toHaveBeenCalledWith('/later');
    expect(service.check).not.toHaveBeenCalledWith('/gone');
    expect(service.check).not.toHaveBeenCalledWith('/removed');
    expect(service.update).toHaveBeenCalledTimes(1);
    expect(service.evict).toHaveBeenCalledWith('/removed');
  });
});
