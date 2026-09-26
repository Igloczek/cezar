import { z } from 'zod';
import { runnerSchema } from './health.ts';

/**
 * The WORKFLOWS family: the chain catalog, the save/parse routes, and the planner.
 *
 * This file must NOT import `./runs.ts`: the run record embeds a workflow definition
 * (`RunRecord.workflowDef`), so `runs.ts` imports the two definition schemas below, and a second
 * edge back would be a module cycle — one whose top-level `z.object(…)` calls would hit a TDZ at
 * import time, not a type error. The parallel-variant shapes (`/groups/:groupId/*`), which DO
 * embed the record, live with the run family for the same reason.
 */

// ---- workflows (`GET/POST /workflows`, `DELETE /workflows/:name`, `POST /workflows/parse`) ----

/**
 * One step of a chain: either an agent step (`prompt`/`skill`) or a check step (`command`).
 *
 * `onFail.max` carries a `.default(2)`, exactly as `src/workflows/types.ts` declares it, so the
 * OUTPUT shape the routes serve has `max` present whenever `onFail` is.
 */
export const workflowStepDefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    // agent step
    prompt: z.string().optional(),
    skill: z.string().optional(),
    model: z.string().optional(),
    /** Per-step agent backend override (falls back to the task / config default). */
    runner: runnerSchema.optional(),
    allowedTools: z.array(z.string()).optional(),
    bashAllowlist: z.array(z.string()).optional(),
    results: z.array(z.string().min(1)).optional(),
    // check step
    command: z.string().optional(),
    onFail: z
      .object({
        retry: z.string().min(1),
        max: z.number().int().positive().default(2),
      })
      .optional(),
  })
  .refine((s) => Boolean(s.command) !== Boolean(s.prompt ?? s.skill), {
    message: 'a step is either an agent step (prompt/skill) or a check step (command), not both',
  });
export type WorkflowStepDef = z.infer<typeof workflowStepDefSchema>;

export const workflowGraphNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  kind: z.enum(['agent', 'check']),
  prompt: z.string().optional(),
  skill: z.string().optional(),
  model: z.string().optional(),
  runner: runnerSchema.optional(),
  allowedTools: z.array(z.string()).optional(),
  bashAllowlist: z.array(z.string()).optional(),
  command: z.string().optional(),
  results: z.array(z.string().min(1)).optional(),
  join: z.literal('all').optional(),
}).superRefine((node, ctx) => {
  const valid = node.kind === 'agent'
    ? Boolean(node.prompt ?? node.skill) && !node.command
    : Boolean(node.command) && !node.prompt && !node.skill;
  if (!valid) ctx.addIssue({ code: 'custom', message: 'agent nodes need a prompt or skill; check nodes need a command' });
});
export const workflowGraphEdgeSchema = z.object({
  from: z.string().min(1), to: z.string().min(1), when: z.string().min(1).optional(),
});
export const workflowGraphSchema = z.object({
  entry: z.string().min(1),
  nodes: z.array(workflowGraphNodeSchema).min(1),
  edges: z.array(workflowGraphEdgeSchema),
  terminals: z.array(z.string().min(1)).min(1),
}).superRefine((graph, ctx) => {
  const ids = graph.nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'graph node ids must be unique' });
  if (!ids.includes(graph.entry)) ctx.addIssue({ code: 'custom', message: `graph entry "${graph.entry}" is not a node` });
  for (const terminal of graph.terminals) if (!ids.includes(terminal)) ctx.addIssue({ code: 'custom', message: `graph terminal "${terminal}" is not a node` });
  for (const edge of graph.edges) {
    if (!ids.includes(edge.from) || !ids.includes(edge.to)) ctx.addIssue({ code: 'custom', message: `graph edge "${edge.from}" → "${edge.to}" references an unknown node` });
    const source = graph.nodes.find((node) => node.id === edge.from);
    if (edge.when && source?.kind === 'agent' && !source.results?.includes(edge.when)) ctx.addIssue({ code: 'custom', message: `graph edge result "${edge.when}" is not declared by node "${edge.from}"` });
    if (source?.kind === 'check' && edge.when && edge.when !== 'passed' && edge.when !== 'failed') ctx.addIssue({ code: 'custom', message: `check node "${edge.from}" routes only on "passed" or "failed"` });
  }
  for (const node of graph.nodes) {
    if (node.results && new Set(node.results).size !== node.results.length) ctx.addIssue({ code: 'custom', message: `graph node "${node.id}" has duplicate result labels` });
    if (node.join === 'all' && !graph.edges.some((edge) => edge.to === node.id)) ctx.addIssue({ code: 'custom', message: `join node "${node.id}" has no incoming edges` });
    if (graph.terminals.includes(node.id) && graph.edges.some((edge) => edge.from === node.id)) ctx.addIssue({ code: 'custom', message: `terminal node "${node.id}" cannot have outgoing edges` });
  }
});
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

/** One catalog entry: the built-in `quick-task`, or a `.ai/cezar/workflows/*.yaml` file. */
export const workflowDefSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(workflowStepDefSchema),
  graph: workflowGraphSchema.optional(),
  source: z.enum(['built-in', 'file']),
  /** Absent on built-ins — which is exactly what makes them undeletable. */
  path: z.string().optional(),
});
export type WorkflowDef = z.infer<typeof workflowDefSchema>;

/** A workflow file that failed to load. Reported, never fatal — the catalog still answers. */
export const workflowLoadIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type WorkflowLoadIssue = z.infer<typeof workflowLoadIssueSchema>;

/** `GET /workflows` — the catalog plus the files that could not be read. */
export const workflowsResponseSchema = z.object({
  workflows: z.array(workflowDefSchema),
  issues: z.array(workflowLoadIssueSchema),
});
export type WorkflowsResponse = z.infer<typeof workflowsResponseSchema>;

/**
 * `POST /workflows` body: save a chain as `.ai/cezar/workflows/<slug>.yaml`.
 *
 * Exactly one of `steps` / the portable `skills` shorthand — the refinement below is the same
 * XOR the server enforces. Without `overwrite` an existing file answers 409 (`exists: true`).
 */
export const saveWorkflowInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(2_000, 'must be at most 2000 characters').optional(),
    steps: z.array(workflowStepDefSchema).min(1).max(8).optional(),
    skills: z.array(z.string().trim().min(1)).min(1).max(8).optional(),
    graph: workflowGraphSchema.optional(),
    overwrite: z.boolean().optional(),
  })
  .refine((b) => [b.steps, b.skills, b.graph].filter(Boolean).length === 1, {
    message: 'provide exactly one of "steps", "skills" or "graph"',
  });
export type SaveWorkflowInput = z.infer<typeof saveWorkflowInputSchema>;

/** `POST /workflows` — 201 with where the YAML landed. */
export const saveWorkflowResponseSchema = z.object({
  path: z.string(),
  name: z.string(),
});
export type SaveWorkflowResponse = z.infer<typeof saveWorkflowResponseSchema>;

/** `POST /workflows/parse` (spec 012) — pasted YAML, normalized to plain steps. */
export const parsedWorkflowSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(workflowStepDefSchema),
  graph: workflowGraphSchema.optional(),
});
export type ParsedWorkflow = z.infer<typeof parsedWorkflowSchema>;

/**
 * `DELETE /workflows/:name` — file workflows only; built-ins answer 400.
 *
 * `ok` is the LITERAL `true`, not a boolean: the only body carrying it is the success one, and
 * every failure is an `{ error }` status instead. The hand-written DTO said `boolean`, which
 * was wider than the route has ever been.
 */
export const deleteWorkflowResponseSchema = z.object({
  ok: z.literal(true),
  path: z.string(),
});
export type DeleteWorkflowResponse = z.infer<typeof deleteWorkflowResponseSchema>;

// ---- plan (`POST /plan`, spec 008) -------------------------------------------------------

/**
 * The proposed chain for a task. Never a hard failure: a missing CLI, a timeout or an
 * unparseable answer degrade to the one-step quick-task plan with `fallback: true`.
 */
export const planResponseSchema = z.object({
  /** The kebab-case workflow title the planner proposed. Absent on the degraded fallback. */
  name: z.string().optional(),
  steps: z.array(workflowStepDefSchema),
  rationale: z.string(),
  fallback: z.boolean(),
});
export type PlanResponse = z.infer<typeof planResponseSchema>;
