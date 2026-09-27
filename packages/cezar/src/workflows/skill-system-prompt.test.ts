import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '../core/agent-runner.ts';
import { nativeSkillRequest, requestNativeSkill, requestNativeSkillText } from './run.ts';

const skill = {
  name: 'om-code-review',
  description: 'Review a diff.',
  body: 'Do the review.',
  path: '/home/u/.agents/skills/om-code-review/SKILL.md',
  source: 'global' as const,
};

describe('native skill selection', () => {
  it('passes only the skill name and user request to the harness', () => {
    const prompt = requestNativeSkillText('/om-code-review PR 42', [skill]);
    expect(prompt).toBe(nativeSkillRequest('om-code-review', 'PR 42'));
    expect(prompt).not.toContain(skill.body);
    expect(prompt).not.toContain(skill.path);
  });

  it('uses the same request for opening and live messages', () => {
    const text = '/om-code-review PR 42';
    const content: ContentBlock[] = [{ type: 'text', text }];
    const delivered = requestNativeSkill(content, [skill]);
    expect(delivered).not.toBe(content);
    expect(delivered[0]).toEqual({ type: 'text', text: requestNativeSkillText(text, [skill]) });
    expect(content[0]).toEqual({ type: 'text', text });
  });

  it('preserves attachments and leaves unknown backend commands untouched', () => {
    const image: ContentBlock = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAA' },
    };
    expect(requestNativeSkill([image, { type: 'text', text: '/om-code-review' }], [skill])[0]).toBe(image);
    for (const text of ['/unknown PR 42', ' /om-code-review PR 42', '/om-code-reviewer PR 42']) {
      expect(requestNativeSkillText(text, [skill])).toBe(text);
    }
    expect(requestNativeSkillText('/om-code-review PR 42', [])).toBe('/om-code-review PR 42');
  });
});
