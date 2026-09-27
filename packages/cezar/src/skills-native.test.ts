import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { discoverSkills, type Skill } from './skills.ts';
import { exposeNativeSkills } from './skills-native.ts';

it('exposes complete installed skills to native harness directories in a worktree', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'cezar-native-skills-'));
  const worktree = `${repo}-worktree`;
  const outside = `${repo}-outside`;
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com',
      'commit', '--allow-empty', '-qm', 'init']);
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'task', worktree]);
    const source = join(repo, '.future/skills/alpha');
    await mkdir(join(source, 'references'), { recursive: true });
    await mkdir(join(repo, '.empty/skills'), { recursive: true });
    await mkdir(join(repo, '.escape/skills'), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(worktree, '.escape'), 'dir');
    await writeFile(join(source, 'SKILL.md'), '---\nname: alpha\ndescription: Uses beta\n---\nUse beta and read references/rules.md');
    await writeFile(join(source, 'references/rules.md'), 'Full reference');
    const skill: Skill = {
      name: 'alpha', body: 'Use beta and read references/rules.md',
      path: join(source, 'SKILL.md'), source: 'project',
    };

    await exposeNativeSkills(repo, worktree, [skill]);

    for (const root of ['.agents/skills', '.claude/skills', '.pi/skills', '.future/skills', '.empty/skills']) {
      expect(await readFile(join(worktree, root, 'alpha/SKILL.md'), 'utf8')).toContain('Use beta');
      expect(await readFile(join(worktree, root, 'alpha/references/rules.md'), 'utf8')).toBe('Full reference');
    }
    expect(existsSync(join(worktree, '.future/skills/alpha'))).toBe(true);
    expect(existsSync(join(outside, 'skills/alpha'))).toBe(false);
    await rm(join(worktree, '.escape'));
    expect(execFileSync('git', ['-C', worktree, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('');
    expect(execFileSync('git', ['-C', repo, 'status', '--porcelain', '--', '.future/skills/alpha'], { encoding: 'utf8' }))
      .toContain('.future/skills/alpha/');
    expect((await discoverSkills(worktree)).filter((entry) => entry.path.startsWith(worktree))).toEqual([]);
  } finally {
    await rm(worktree, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
