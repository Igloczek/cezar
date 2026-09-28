import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createWorktree } from './git-worktree.ts';
import { ensureDataGitignore } from './data-gitignore.ts';
import { discoverSkills } from './skills.ts';
import { installSkills } from './skills-install.ts';
import { ensureBareClone } from './skills-remote.ts';
import type { Skill } from './skills.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('installs every skill with assets into both native harness directories and leaves a clean worktree', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'cez-native-skills-'));
  roots.push(repo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  mkdirSync(join(repo, '.ai/skills/first/references'), { recursive: true });
  mkdirSync(join(repo, '.ai/skills/first/scripts'), { recursive: true });
  mkdirSync(join(repo, '.ai/cezar'), { recursive: true });
  writeFileSync(join(repo, '.ai/cezar/config.json'), '{"skillsRepos":[]}');
  writeFileSync(join(repo, '.ai/skills/first/SKILL.md'), '---\nname: first\ndescription: First skill.\n---\nUse the second skill. Read references/rules.md.\n');
  writeFileSync(join(repo, '.ai/skills/first/references/rules.md'), 'rules-marker\n');
  writeFileSync(join(repo, '.ai/skills/first/scripts/do.sh'), '#!/bin/sh\necho done\n');
  chmodSync(join(repo, '.ai/skills/first/scripts/do.sh'), 0o755);
  writeFileSync(join(repo, '.ai/skills/second.md'), 'Second skill marker.\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base'], { cwd: repo });

  ensureDataGitignore(repo);
  const wt = (await createWorktree(repo, '11111111-1111-4111-8111-111111111111', 'main')).path;
  const skills = await discoverSkills(repo);
  expect(await installSkills(wt, skills)).toEqual([]);
  for (const mirror of ['.agents/skills', '.claude/skills']) {
    expect(readFileSync(join(wt, mirror, 'first/SKILL.md'), 'utf8')).toContain('Use the second skill');
    expect(readFileSync(join(wt, mirror, 'first/references/rules.md'), 'utf8')).toBe('rules-marker\n');
    expect(statSync(join(wt, mirror, 'first/scripts/do.sh')).mode & 0o111).toBeTruthy();
    expect(readFileSync(join(wt, mirror, 'second/SKILL.md'), 'utf8')).toContain('Second skill marker');
  }
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' })).toBe('');
  expect(execFileSync('git', ['status', '--porcelain', '--', '.agents', '.claude'], { cwd: repo, encoding: 'utf8' })).toBe('');
  expect(await installSkills(wt, skills.filter((skill) => skill.name === 'first'))).toEqual([]);
  expect(existsSync(join(wt, '.agents/skills/second'))).toBe(false);
  expect(existsSync(join(wt, '.claude/skills/second'))).toBe(false);
  rmSync(join(wt, '.ai/cezar/tmp/native-skills/first'), { recursive: true, force: true });
  expect(await installSkills(wt, skills.filter((skill) => skill.name === 'first'))).toEqual([]);
  expect(readFileSync(join(wt, '.agents/skills/first/references/rules.md'), 'utf8')).toBe('rules-marker\n');
  expect(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' })).toBe('');
});

it('copies a team skill directory with binary assets and executable modes from its pinned cache', async () => {
  const source = mkdtempSync(join(tmpdir(), 'cez-team-skills-'));
  const target = mkdtempSync(join(tmpdir(), 'cez-team-target-'));
  const home = mkdtempSync(join(tmpdir(), 'cez-team-home-'));
  roots.push(source, target, home);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: source });
  mkdirSync(join(source, 'remote/assets'), { recursive: true });
  writeFileSync(join(source, 'remote/SKILL.md'), '---\nname: remote\ndescription: Team skill.\n---\nRead assets/data.bin.\n');
  writeFileSync(join(source, 'remote/assets/data.bin'), Buffer.from([0, 1, 255]));
  writeFileSync(join(source, 'remote/run.sh'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(source, 'remote/run.sh'), 0o755);
  execFileSync('git', ['add', '-A'], { cwd: source });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'base'], { cwd: source });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: target });
  const priorHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await ensureBareClone(source);
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
    const skill: Skill = { name: 'remote', description: 'Team skill.', body: 'Read assets/data.bin.', path: `${source}@main:remote/SKILL.md`, source: 'team', team: { repo: source, ref: 'main', path: 'remote/SKILL.md', dir: true, commit } };
    expect(await installSkills(target, [skill])).toEqual([]);
    expect(readFileSync(join(target, '.agents/skills/remote/assets/data.bin'))).toEqual(Buffer.from([0, 1, 255]));
    expect(statSync(join(target, '.claude/skills/remote/run.sh')).mode & 0o111).toBeTruthy();
  } finally {
    if (priorHome === undefined) delete process.env.HOME;
    else process.env.HOME = priorHome;
  }
});

it('does not install through a user-owned mirror symlink', async () => {
  const target = mkdtempSync(join(tmpdir(), 'cez-mirror-target-'));
  const external = mkdtempSync(join(tmpdir(), 'cez-mirror-external-'));
  roots.push(target, external);
  symlinkSync(external, join(target, '.agents'));
  const skill: Skill = { name: 'first', description: 'First.', body: 'Do first.\n', path: join(target, 'first.md'), source: 'ai' };
  expect(await installSkills(target, [skill])).toContain('skill installation skipped for .agents/skills: directory path contains a symlink');
  expect(existsSync(join(external, 'skills'))).toBe(false);
  expect(readFileSync(join(target, '.claude/skills/first/SKILL.md'), 'utf8')).toContain('Do first.');
});
