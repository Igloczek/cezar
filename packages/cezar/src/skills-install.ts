import { cp, lstat, mkdir, readdir, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { ensureDataGitignore } from './data-gitignore.ts';
import { excludeFromGit, materializeSkillDir } from './skills-remote.ts';
import { parseFrontmatter, type Skill } from './skills.ts';

const MIRRORS = ['.agents/skills', '.claude/skills'] as const;
const MANAGED = '.cezar-managed';

async function hasSymlinkAncestor(root: string, path: string): Promise<boolean> {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if ((await lstat(current).catch(() => null))?.isSymbolicLink()) return true;
  }
  return false;
}

async function isManagedLink(dest: string, canonicalRoot: string): Promise<boolean> {
  const link = await readlink(dest).catch(() => null);
  return link !== null && resolve(dirname(dest), link).startsWith(resolve(canonicalRoot) + '/');
}

/** Make the catalog available to native harness loaders before a task starts. */
export async function installSkills(targetRoot: string, skills: readonly Skill[]): Promise<string[]> {
  const warnings: string[] = [];
  const canonicalRoot = join(targetRoot, '.ai/cezar/tmp/native-skills');
  if (await hasSymlinkAncestor(targetRoot, '.ai/cezar/tmp/native-skills')) {
    return ['skill installation skipped: Cezar data path contains a symlink'];
  }
  const mirrors: (typeof MIRRORS)[number][] = [];
  for (const mirror of MIRRORS) {
    if (await hasSymlinkAncestor(targetRoot, mirror)) warnings.push(`skill installation skipped for ${mirror}: directory path contains a symlink`);
    else mirrors.push(mirror);
  }
  ensureDataGitignore(targetRoot);
  await excludeFromGit(targetRoot, '.ai/cezar/.gitignore');
  await mkdir(canonicalRoot, { recursive: true });
  const wanted = new Set(skills.map((skill) => skill.name));
  for (const mirror of mirrors) {
    const dir = join(targetRoot, mirror);
    for (const name of await readdir(dir).catch(() => [])) {
      if (wanted.has(name) || name === '.gitignore') continue;
      const dest = join(dir, name);
      const info = await lstat(dest).catch(() => null);
      const managedLink = info?.isSymbolicLink() && await isManagedLink(dest, canonicalRoot);
      const managedCopy = info?.isDirectory() && await lstat(join(dest, MANAGED)).then(() => true, () => false);
      if (managedLink || managedCopy) await rm(dest, { recursive: true, force: true });
    }
  }
  for (const name of await readdir(canonicalRoot)) {
    if (!wanted.has(name)) await rm(join(canonicalRoot, name), { recursive: true, force: true });
  }

  for (const skill of skills) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(skill.name)) {
      warnings.push(`skill ${JSON.stringify(skill.name)} has no safe native directory name`);
      continue;
    }
    const canonical = join(canonicalRoot, skill.name);
    await rm(canonical, { recursive: true, force: true });
    try {
      if (skill.team?.dir) {
        if (!await materializeSkillDir(targetRoot, skill)) throw new Error('team cache unavailable');
      } else if (skill.source !== 'team' && skill.source !== 'builtin' && skill.path.endsWith('/SKILL.md')) {
        await cp(dirname(skill.path), canonical, { recursive: true });
      } else {
        await mkdir(canonical, { recursive: true });
        await writeFile(join(canonical, 'SKILL.md'), skill.body);
      }
      const skillFile = join(canonical, 'SKILL.md');
      const raw = await readFile(skillFile, 'utf8');
      const { frontmatter } = parseFrontmatter(raw);
      const missing = [
        ...(!frontmatter.name ? [`name: ${JSON.stringify(skill.name)}`] : []),
        ...(!frontmatter.description ? [`description: ${JSON.stringify(skill.description ?? skill.name)}`] : []),
      ];
      if (missing.length) {
        const normalized = raw.startsWith('---\n') && raw.includes('\n---\n', 4)
          ? raw.replace('---\n', `---\n${missing.join('\n')}\n`)
          : `---\n${missing.join('\n')}\n---\n\n${raw}`;
        await writeFile(skillFile, normalized);
      }
    } catch (error) {
      warnings.push(`skill ${skill.name} could not be installed: ${String(error)}`);
      await rm(canonical, { recursive: true, force: true });
      continue;
    }

    for (const mirror of mirrors) {
      const dir = join(targetRoot, mirror);
      const dest = join(dir, skill.name);
      await mkdir(dir, { recursive: true });
      const existing = await lstat(dest).catch(() => null);
      if (existing) {
        const linked = existing.isSymbolicLink() && await isManagedLink(dest, canonicalRoot);
        const copied = existing.isDirectory() && await lstat(join(dest, MANAGED)).then(() => true, () => false);
        if (linked || copied) await rm(dest, { recursive: true, force: true });
        else {
          if (await realpath(dest).catch(() => '') !== await realpath(dirname(skill.path)).catch(() => '')) {
            warnings.push(`skill ${skill.name}: ${mirror} has a user-owned installation with the same name`);
          }
          continue; // Never overwrite a user-owned installation.
        }
      }
      try {
        await symlink(relative(dir, canonical), dest, 'dir');
      } catch {
        await cp(canonical, dest, { recursive: true });
        await writeFile(join(dest, MANAGED), 'Generated by Cezar.\n');
      }
      const ignore = join(dir, '.gitignore');
      const prior = await readFile(ignore, 'utf8').catch(() => null);
      if (prior === null) {
        await writeFile(ignore, `# Generated by Cezar; task skill mirrors\n/${skill.name}\n`);
        await excludeFromGit(targetRoot, `${mirror}/.gitignore`);
      } else if (prior.startsWith('# Generated by Cezar; task skill mirrors\n') && !prior.split('\n').includes(`/${skill.name}`)) {
        await writeFile(ignore, `${prior.trimEnd()}\n/${skill.name}\n`);
      }
    }
  }
  for (const mirror of mirrors) {
    const dir = join(targetRoot, mirror);
    const ignore = join(dir, '.gitignore');
    const prior = await readFile(ignore, 'utf8').catch(() => '');
    if (!prior.startsWith('# Generated by Cezar; task skill mirrors\n')) continue;
    const managed: string[] = [];
    for (const name of await readdir(dir)) {
      const dest = join(dir, name);
      const info = await lstat(dest).catch(() => null);
      if (info?.isSymbolicLink() && await isManagedLink(dest, canonicalRoot)) managed.push(name);
      else if (info?.isDirectory() && await lstat(join(dest, MANAGED)).then(() => true, () => false)) managed.push(name);
    }
    await writeFile(ignore, `# Generated by Cezar; task skill mirrors\n${managed.map((name) => `/${name}`).join('\n')}\n`);
  }
  return warnings;
}
