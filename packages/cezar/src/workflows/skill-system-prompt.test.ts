import { describe, expect, it } from 'vitest';
import { skillSystemPrompt } from './run.ts';

describe('legacy workflow skill step', () => {
  it('keeps the saved workflow behavior during migration', () => {
    const out = skillSystemPrompt({
      name: 'review', description: 'Review a diff.', body: 'Do the review.',
      source: 'agents', path: '/repo/.agents/skills/review/SKILL.md',
    });
    expect(out).toContain('Selected skill: /review');
    expect(out).toContain('Skill instructions:\nDo the review.');
  });
});
