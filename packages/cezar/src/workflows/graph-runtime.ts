import type { WorkflowGraph } from './types.ts';

export interface GraphRouteDecision {
  from: string;
  to: string;
  when?: string;
}

/** Return every matching labeled route plus every unconditional route. */
export function graphRoutesForResult(
  graph: WorkflowGraph,
  nodeId: string,
  result: string | undefined,
): GraphRouteDecision[] {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`graph node "${nodeId}" does not exist`);
  if (graph.terminals.includes(nodeId)) {
    if (node.kind === 'check' && result === 'failed') throw new Error(`terminal check node "${nodeId}" failed`);
    return [];
  }
  if (node.kind === 'agent' && node.results?.length) {
    if (!result) throw new Error(`graph node "${nodeId}" did not return a declared result (${node.results.join(', ')})`);
    if (!node.results.includes(result)) throw new Error(`graph node "${nodeId}" returned undeclared result "${result}"`);
  }
  const candidates = graph.edges.filter((edge) => edge.from === nodeId);
  const matches = candidates.filter((edge) => edge.when === undefined || edge.when === result);
  if (!matches.length) {
    const declared = node.kind === 'agent' ? node.results ?? [] : ['passed', 'failed'];
    throw new Error(`graph node "${nodeId}" returned ${result ? `undeclared or unrouted result "${result}"` : 'no result'}; expected a route for ${declared.join(', ') || 'an unconditional edge'}`);
  }
  return matches.map(({ from, to, when }) => ({ from, to, ...(when ? { when } : {}) }));
}

/** A graph execution has no transition cap: every activation receives a new visit id. */
export function graphVisitId(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('graph visit sequence must be a positive safe integer');
  return `visit-${sequence}`;
}
