import { describe, expect, it } from 'vitest';
import { graphRoutesForResult, graphVisitId } from './graph-runtime.ts';
import { workflowGraphSchema } from './types.ts';

const graph = workflowGraphSchema.parse({
  entry: 'review',
  nodes: [
    { id: 'review', kind: 'agent', prompt: 'review', results: ['clean', 'changes'] },
    { id: 'test', kind: 'check', command: 'npm test' },
    { id: 'done', kind: 'agent', prompt: 'finish' },
  ],
  edges: [
    { from: 'review', to: 'test', when: 'clean' },
    { from: 'review', to: 'done', when: 'changes' },
    { from: 'review', to: 'done' },
    { from: 'test', to: 'done', when: 'passed' },
    { from: 'test', to: 'review', when: 'failed' },
  ],
  terminals: ['done'],
});

describe('graph workflow routing', () => {
  it('fires every matching labeled edge and every unconditional edge', () => {
    expect(graphRoutesForResult(graph, 'review', 'clean').map((edge) => edge.to)).toEqual(['test', 'done']);
  });

  it('routes check outcomes and permits a loop to exceed forty visits', () => {
    expect(graphRoutesForResult(graph, 'test', 'failed')).toEqual([{ from: 'test', to: 'review', when: 'failed' }]);
    expect(graphVisitId(41)).toBe('visit-41');
  });

  it('fails visibly when a nonterminal result has no route', () => {
    expect(() => graphRoutesForResult(graph, 'test', 'unknown')).toThrow(/unrouted result/i);
  });

  it('rejects an undeclared agent result even when an unconditional edge exists', () => {
    expect(() => graphRoutesForResult(graph, 'review', 'surprise')).toThrow(/undeclared result/i);
  });

  it('does not route out of a terminal node', () => {
    expect(graphRoutesForResult(graph, 'done', undefined)).toEqual([]);
  });

  it('fails when a terminal check reports failure', () => {
    const checkGraph = workflowGraphSchema.parse({
      entry: 'check', nodes: [{ id: 'check', kind: 'check', command: 'false' }], edges: [], terminals: ['check'],
    });
    expect(() => graphRoutesForResult(checkGraph, 'check', 'failed')).toThrow(/terminal check node.*failed/i);
  });
});
