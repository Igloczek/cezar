import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverSkills,
  filterImportedTeamSkills,
  readImportedSkills,
  type Skill,
} from './skills.ts';

/**
 * The opt-out gate's two pure halves (#391 follow-up: the promo banner is gone, replaced by
 * per-skill curation). `readImportedSkills` parses a user-editable ui-state as a tri-state
 * (absent = not curated = keep all); `filterImportedTeamSkills` applies the gate. Kept pure so
 * they are testable without a network clone — the gated repo set is otherwise a vendor default.
 */

const OM = 'open-mercato/skills';
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function teamSkill(name: string, repo: string): Skill {
  return {
    name,
    body: `${name} body`,
    path: `${repo}@main:${name}/SKILL.md`,
    source: 'team',
    team: { repo, ref: 'main', path: `${name}/SKILL.md` },
  };
}

function localSkill(name: string): Skill {
  return { name, body: `${name} body`, path: `/repo/.future/skills/${name}/SKILL.md`, source: 'project' };
}

describe('readImportedSkills', () => {
  it('returns the string names from a well-formed array', () => {
    expect(readImportedSkills({ importedSkills: ['pr-create', 'code-review'] })).toEqual([
      'pr-create',
      'code-review',
    ]);
  });

  it('returns undefined for a missing key — not curated, so the caller keeps all', () => {
    expect(readImportedSkills({})).toBeUndefined();
  });

  it('returns undefined for a non-array (a hand-edited file) — the safe, keep-all reading', () => {
    expect(readImportedSkills({ importedSkills: 'pr-create' })).toBeUndefined();
  });

  it('distinguishes an explicit empty array (curated to nothing) from absent', () => {
    expect(readImportedSkills({ importedSkills: [] })).toEqual([]);
  });

  it('drops non-string and empty entries rather than throwing', () => {
    expect(readImportedSkills({ importedSkills: ['ok', 42, '', null, 'fine'] })).toEqual(['ok', 'fine']);
  });
});

describe('filterImportedTeamSkills', () => {
  const gated = new Set([OM]);

  it('keeps every gated-repo skill when not curated (undefined) — opt-out default, no upgrade break', () => {
    const skills = [teamSkill('pr-create', OM), teamSkill('code-review', OM)];
    expect(filterImportedTeamSkills(skills, gated, undefined).map((s) => s.name)).toEqual([
      'pr-create',
      'code-review',
    ]);
  });

  it('drops a gated-repo skill once curated away (explicit empty array)', () => {
    const skills = [teamSkill('pr-create', OM), teamSkill('code-review', OM)];
    expect(filterImportedTeamSkills(skills, gated, []).map((s) => s.name)).toEqual([]);
  });

  it('keeps only the named skills from a gated repo when curated', () => {
    const skills = [teamSkill('pr-create', OM), teamSkill('code-review', OM)];
    expect(filterImportedTeamSkills(skills, gated, ['code-review']).map((s) => s.name)).toEqual([
      'code-review',
    ]);
  });

  it('keeps every skill from a repo that is not gated (custom team repo auto-loads)', () => {
    const skills = [teamSkill('alpha', 'acme/team-skills'), teamSkill('beta', 'acme/team-skills')];
    expect(filterImportedTeamSkills(skills, gated, []).map((s) => s.name)).toEqual(['alpha', 'beta']);
  });

  it('never gates a local skill (no team field), even when curated to nothing', () => {
    const skills = [localSkill('house-rules'), teamSkill('pr-create', OM)];
    expect(filterImportedTeamSkills(skills, gated, []).map((s) => s.name)).toEqual(['house-rules']);
  });

  it('gates nothing when the gated set is empty (repo configured its own skillsRepos)', () => {
    const skills = [teamSkill('pr-create', OM)];
    expect(filterImportedTeamSkills(skills, new Set(), []).map((s) => s.name)).toEqual(['pr-create']);
  });
});

describe('discoverSkills local entrypoints', () => {
  it('recognizes only scalar true as the interactive composer hint', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'cezar-skills-'));
    tempDirs.push(repoRoot);
    const skillsDir = join(repoRoot, '.future/skills');
    for (const name of ['true', 'false', 'array', 'yes', 'missing']) {
      await mkdir(join(skillsDir, name), { recursive: true });
    }
    await writeFile(join(skillsDir, 'true/SKILL.md'), '---\r\ninteractive: "true"\r\n---\r\nBody');
    await writeFile(join(skillsDir, 'false/SKILL.md'), '---\ninteractive: false\n---\nBody');
    await writeFile(join(skillsDir, 'array/SKILL.md'), '---\ninteractive: [true]\n---\nBody');
    await writeFile(join(skillsDir, 'yes/SKILL.md'), '---\ninteractive: yes\n---\nBody');
    await writeFile(join(skillsDir, 'missing/SKILL.md'), 'Body');

    const skills = (await discoverSkills(repoRoot)).filter((skill) => skill.source === 'project');
    expect(skills.find((skill) => skill.name === 'true')).toMatchObject({
      interactive: true,
      body: 'Body',
    });
    for (const name of ['false', 'array', 'yes', 'missing']) {
      expect(skills.find((skill) => skill.name === name)?.interactive).toBeUndefined();
    }
  });

  it('reads SKILL.md and ignores loose Markdown and Cezar-only directories', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'cezar-skills-'));
    tempDirs.push(repoRoot);
    const skillsDir = join(repoRoot, '.future/skills');
    await mkdir(join(skillsDir, 'om-example/references'), { recursive: true });
    await mkdir(join(skillsDir, 'legacy/nested'), { recursive: true });
    await mkdir(join(repoRoot, '.ai/skills/old-dir'), { recursive: true });
    await mkdir(join(repoRoot, '.ai/cezar/skills'), { recursive: true });
    await writeFile(join(skillsDir, 'flat.md'), '# Flat skill');
    await writeFile(join(skillsDir, 'legacy/nested/legacy.md'), '# Legacy skill');
    await writeFile(join(skillsDir, 'om-example/SKILL.md'), '# Example skill');
    await writeFile(join(skillsDir, 'om-example/references/agentic-setup.md'), '# Supporting doc');
    await writeFile(join(repoRoot, '.ai/skills/old-dir/SKILL.md'), '# Old location');
    await writeFile(join(repoRoot, '.ai/cezar/skills/old.md'), '# Old file');

    const skills = (await discoverSkills(repoRoot)).filter((skill) => skill.path.startsWith(repoRoot));

    expect(skills.map((skill) => skill.name)).toEqual(['om-example']);
  });

  it('follows linked skill directories and deduplicates them by skill name', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'cezar-skills-'));
    tempDirs.push(repoRoot);
    const canonicalDir = join(repoRoot, '.agents/skills/om-example');
    const mirrorRoot = join(repoRoot, '.claude/skills');
    await mkdir(canonicalDir, { recursive: true });
    await mkdir(mirrorRoot, { recursive: true });
    await writeFile(join(canonicalDir, 'SKILL.md'), '# Example skill');
    await symlink('../../.agents/skills/om-example', join(mirrorRoot, 'om-example'), 'dir');

    const skills = (await discoverSkills(repoRoot)).filter((skill) => skill.name === 'om-example');

    expect(skills).toHaveLength(1);
    expect(skills[0]?.source).toBe('project');
  });

  it('discovers installed skills without knowing the agent name', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'cezar-skills-'));
    tempDirs.push(repoRoot);
    const skillsDir = join(repoRoot, '.future-agent/skills/my-skill');
    await mkdir(skillsDir, { recursive: true });
    await writeFile(join(skillsDir, 'SKILL.md'), '# Any agent');

    const skills = await discoverSkills(repoRoot);
    expect(skills.find((skill) => skill.name === 'my-skill')).toMatchObject({
      source: 'project',
      path: join(skillsDir, 'SKILL.md'),
    });
  });

  it('discovers skills in an arbitrary configured global home', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'cezar-skills-'));
    tempDirs.push(repoRoot);
    const configDir = await mkdtemp(join(tmpdir(), 'cezar-agent-home-'));
    tempDirs.push(configDir);
    const skillDir = join(configDir, 'skills', 'my-global-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# Global agent skill');
    const previous = process.env.FUTURE_AGENT_CONFIG_DIR;
    process.env.FUTURE_AGENT_CONFIG_DIR = configDir;
    try {
      const skills = await discoverSkills(repoRoot);
      expect(skills.find((skill) => skill.name === 'my-global-skill')).toMatchObject({
        source: 'global',
        path: join(skillDir, 'SKILL.md'),
      });
    } finally {
      if (previous === undefined) delete process.env.FUTURE_AGENT_CONFIG_DIR;
      else process.env.FUTURE_AGENT_CONFIG_DIR = previous;
    }
  });

  it('finds direct and nested project and global skill roots without agent names', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'cezar-skills-'));
    const home = await mkdtemp(join(tmpdir(), 'cezar-home-'));
    tempDirs.push(repoRoot, home);
    const locations = [
      [join(repoRoot, 'skills/root-skill'), 'root-skill', 'project'],
      [join(repoRoot, 'agent/subagents/future/skills/sub-skill'), 'sub-skill', 'project'],
      [join(home, '.odd/assistant/skills/home-skill'), 'home-skill', 'global'],
      [join(home, '.config/future/harness/skills/config-skill'), 'config-skill', 'global'],
      [join(home, 'custom-config/future/skills/xdg-skill'), 'xdg-skill', 'global'],
    ] as const;
    for (const [dir] of locations) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), '# Skill');
    }
    const previous = process.env.HOME;
    const previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = join(home, 'custom-config');
    try {
      const skills = await discoverSkills(repoRoot);
      for (const [dir, name, source] of locations) {
        expect(skills.find((skill) => skill.name === name)).toMatchObject({
          path: join(dir, 'SKILL.md'), source,
        });
      }
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
    }
  });
});

/**
 * The one skill cezar ships itself (spec 2026-09-13-automations-from-prompt): listed only on a
 * cockpit that has automations on AND publishes a transport, and shadowed by a repo skill of the
 * same name — the same "user's repo is the source of truth" rule every other source follows.
 */
describe('the built-in create-cezar-automation skill', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved.CEZ_AUTOMATIONS = process.env.CEZ_AUTOMATIONS;
    saved.CEZ_API_URL = process.env.CEZ_API_URL;
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function emptyRepo(): Promise<string> {
    const repoRoot = await mkdtemp(join(tmpdir(), 'cezar-skills-'));
    tempDirs.push(repoRoot);
    // A repo that names its own skills repos gates nothing and clones nothing here — the
    // team cache is empty in a fresh process, so the catalog is exactly the local + built-in set.
    await mkdir(join(repoRoot, '.ai/cezar'), { recursive: true });
    return repoRoot;
  }

  it('is absent with automations opted out, and absent by default with no cockpit to reach', async () => {
    const repoRoot = await emptyRepo();
    process.env.CEZ_AUTOMATIONS = '0';
    process.env.CEZ_API_URL = 'http://127.0.0.1:4321';
    expect((await discoverSkills(repoRoot)).some((s) => s.name === 'create-cezar-automation')).toBe(false);
    delete process.env.CEZ_AUTOMATIONS;
    delete process.env.CEZ_API_URL;
    expect((await discoverSkills(repoRoot)).some((s) => s.name === 'create-cezar-automation')).toBe(false);
  });

  it('lists as a builtin, interactive skill when automations are on (the default) and reachable', async () => {
    const repoRoot = await emptyRepo();
    delete process.env.CEZ_AUTOMATIONS;
    process.env.CEZ_API_URL = 'http://127.0.0.1:4321';
    const skill = (await discoverSkills(repoRoot)).find((s) => s.name === 'create-cezar-automation');
    expect(skill).toMatchObject({ source: 'builtin', interactive: true, path: 'builtin:create-cezar-automation' });
    expect(skill?.body).toContain('cez automation');
  });

  it('is shadowed by a repo skill of the same name', async () => {
    const repoRoot = await emptyRepo();
    process.env.CEZ_AUTOMATIONS = '1';
    process.env.CEZ_API_URL = 'http://127.0.0.1:4321';
    await mkdir(join(repoRoot, '.future/skills/create-cezar-automation'), { recursive: true });
    await writeFile(join(repoRoot, '.future/skills/create-cezar-automation/SKILL.md'), '---\nname: create-cezar-automation\n---\nHouse version');
    const matches = (await discoverSkills(repoRoot)).filter((s) => s.name === 'create-cezar-automation');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ source: 'project', body: 'House version' });
  });
});
