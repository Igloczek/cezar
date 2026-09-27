import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bareDirFor, isPinnedSha, materializeSkillDir, shouldPassiveFetch } from './skills-remote.ts';

const TTL = 6 * 60 * 60 * 1_000;

describe('shouldPassiveFetch', () => {
  it('fetches on the first passive touch this process', () => {
    // A clone left by an earlier run must be refreshed on first read, else a
    // long-running server serves whatever ref that old clone happened to have.
    expect(shouldPassiveFetch({ attempted: false, fetchedAt: 0, now: 1_000, ttlMs: TTL })).toBe(true);
  });

  it('does not re-fetch within the TTL once touched', () => {
    const now = 10 * 60 * 60 * 1_000;
    expect(shouldPassiveFetch({ attempted: true, fetchedAt: now - 60_000, now, ttlMs: TTL })).toBe(false);
  });

  it('re-fetches once the last fetch is older than the TTL', () => {
    const now = 10 * 60 * 60 * 1_000;
    expect(shouldPassiveFetch({ attempted: true, fetchedAt: now - TTL - 1, now, ttlMs: TTL })).toBe(true);
  });

  it('treats exactly-TTL as still fresh (strictly greater re-fetches)', () => {
    const now = 10 * 60 * 60 * 1_000;
    expect(shouldPassiveFetch({ attempted: true, fetchedAt: now - TTL, now, ttlMs: TTL })).toBe(false);
  });
});

describe('bareDirFor', () => {
  it('keys the global cache on owner__name regardless of URL shape', () => {
    const expected = bareDirFor('open-mercato/skills');
    expect(bareDirFor('https://github.com/open-mercato/skills.git')).toBe(expected);
    expect(bareDirFor('git@github.com:open-mercato/skills')).toBe(expected);
    expect(expected.endsWith('open-mercato__skills')).toBe(true);
  });
});

describe('isPinnedSha', () => {
  it('accepts 40- and 64-hex, rejects branch names', () => {
    expect(isPinnedSha('a'.repeat(40))).toBe(true);
    expect(isPinnedSha('b'.repeat(64))).toBe(true);
    expect(isPinnedSha('main')).toBe(false);
  });
});

it('passes a team skill and its references through Cezar-owned files, without an agent directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cezar-team-skill-'));
  const previousHome = process.env.HOME;
  process.env.HOME = join(root, 'home');
  const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim();
  try {
    const source = join(root, 'source');
    const checkout = join(root, 'checkout');
    await mkdir(join(source, 'review', 'references'), { recursive: true });
    await mkdir(checkout);
    await writeFile(join(source, 'review', 'SKILL.md'), '# Review');
    await writeFile(join(source, 'review', 'references', 'rules.md'), '# Rules');
    git('init', '-q', '-b', 'main', source);
    git('-C', source, 'add', '.');
    git('-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'skill');
    git('init', '-q', '-b', 'main', checkout);
    const bare = bareDirFor(source);
    expect(bare.startsWith(process.env.HOME)).toBe(true);
    await mkdir(dirname(bare), { recursive: true });
    git('clone', '-q', '--bare', source, bare);

    const dir = await materializeSkillDir(checkout, {
      name: 'review', body: '# Review', path: `${source}@main:review/SKILL.md`, source: 'team',
      team: { repo: source, ref: 'main', path: 'review/SKILL.md', dir: true },
    });
    expect(dir).toBe(join(checkout, '.ai/cezar/tmp/skills/review'));
    expect(await readFile(join(dir!, 'references/rules.md'), 'utf8')).toBe('# Rules');
    expect(git('-C', checkout, 'status', '--short', '--untracked-files=all')).toBe('');
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});
