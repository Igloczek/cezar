# Decision workflow builder in Workflows

> Status: proposed design and implementation spec · [Issue #12](https://github.com/Igloczek/cezar/issues/12) · Project: `Igloczek/cezar` only · Depends on [#10](https://github.com/Igloczek/cezar/issues/10) and [#11](https://github.com/Igloczek/cezar/issues/11). Implement after their report and routing contracts are settled.

## Summary

Give workflow authors a way to configure and inspect the decision graphs introduced by #11 without hand-editing YAML. Keep today's ordered chain builder and `quick-task` behavior intact. A separate **Decision workflow** editor combines a searchable step palette, a connected flow, and a contextual inspector. Authors can define a conditional branch, its fallback, a bounded backward route, and terminal outcomes; save-time validation prevents an incomplete graph from becoming runnable. A read-only route trace in run history explains what Cezar chose using accepted reports from #10.

The attached design reference suggests the three-panel layout and visible validation. Its version publishing, production statistics, and dry-run results are **not** part of this spec: the current workflow product saves YAML files, and #10/#11 do not supply those capabilities.

## Visual designs

These are proposed screens for implementation, with illustrative workflow and run data. They show layout, hierarchy, labels, route visibility, selection, and validation; the final #10/#11 contracts remain authoritative for data fields and terminal states. The editable HTML sources are [`mockups.html`](https://github.com/Igloczek/cezar/blob/cez/e62871cb/.ai/specs/assets/decision-workflow-builder/mockups.html) and [`mobile.html`](https://github.com/Igloczek/cezar/blob/cez/e62871cb/.ai/specs/assets/decision-workflow-builder/mobile.html). Desktop canvases are 1600 × 1000; the narrow layout is 430 × 900.

**Decision editor —** palette, connected flow, text route list, decision inspector, and save checks:

![Decision workflow editor](https://raw.githubusercontent.com/Igloczek/cezar/cez/e62871cb/.ai/specs/assets/decision-workflow-builder/mockup-02-editor.png)

<details>
<summary>See the other five screens: library, bounded retry, validation, run trace, and narrow layout</summary>

**Library and workflow-type choice**

![Workflow library and new-workflow choice](https://raw.githubusercontent.com/Igloczek/cezar/cez/e62871cb/.ai/specs/assets/decision-workflow-builder/mockup-01-library.png)

**Bounded retry selected** — the inspector names the return target, visit limit, and exhaustion destination.

![Bounded retry route inspector](https://raw.githubusercontent.com/Igloczek/cezar/cez/e62871cb/.ai/specs/assets/decision-workflow-builder/mockup-03-bounded-loop.png)

**Blocking validation** — the canvas, route list, inspector, and problem bar agree on the missing fallback.

![Missing fallback validation state](https://raw.githubusercontent.com/Igloczek/cezar/cez/e62871cb/.ai/specs/assets/decision-workflow-builder/mockup-04-validation.png)

**Run route trace** — persisted report and edge choice explain the route after a run.

![Read-only run route trace](https://raw.githubusercontent.com/Igloczek/cezar/cez/e62871cb/.ai/specs/assets/decision-workflow-builder/mockup-05-route-trace.png)

**Narrow layout** — the route list stays readable while the selected node opens in a sheet.

![Narrow route list and inspector sheet](https://raw.githubusercontent.com/Igloczek/cezar/cez/e62871cb/.ai/specs/assets/decision-workflow-builder/mockup-06-mobile-route-list.png)

</details>

## Problem and user outcome

Today `packages/web/src/routes/workflows/workflows.tsx` offers an ordered canvas, skill palette, YAML preview/import/export, and an AI-assisted chain planner. `packages/cezar/src/workflows/types.ts` accepts `steps` or `skills`; a check can retry an earlier step through `onFail`. It does not author arbitrary conditional edges. #11 adds an opt-in graph format so Cezar can route from a validated report instead of agent prose. Without an editor, a user must understand node IDs, report paths, predicates, fallback edges, and visit limits in YAML before they can safely use it.

**Primary job:** A developer can create and save a reusable workflow with one report-driven branch and one bounded retry, then explain a run's chosen route. Success means authors can identify the fallback and maximum number of visits before saving. A plausible project effect is fewer misconfigured runs; the guardrail is no change to existing chain workflow behavior. The need for a visual graph, as opposed to a structured form, is an assumption to validate with a prototype.

## Dependencies and source of truth

1. **#10 first:** only a validated, persisted report from the Cezar-owned tool is eligible for routing. A transcript marker or displayed tool call is not an accepted report. The UI shows the accepted report's reference and bounded, redacted details only.
2. **#11 second:** the engine owns graph format, predicate operators, field-path validation, runner eligibility, visit bounds, selected-edge persistence, and recovery. The editor serializes that format; it must not invent a parallel interpretation of a graph. The current issue explicitly defers a visual graph editor, making this a follow-up.
3. **Existing chains:** `steps` and `skills` files, their `onFail` behavior, and built-in `quick-task` continue to load and run unchanged. No automatic conversion to the new format.
4. **API contract:** any new request/response shape lives in `packages/contract` with inferred types. Workflow routes stay chained and versioned under `/api/v1`, use middleware validation, and keep project-scoped route parity.

The #10 report schema does not yet define how an author discovers routable `data` fields and their types. Resolve that with the final #10/#11 contracts before implementing the rule inspector. The editor must never suggest arbitrary paths as valid merely because they appeared in one sample report.

## Product decisions

| Decision | Behavior | Reason |
|---|---|---|
| Two editors | **Chain** retains the ordered builder; **Decision workflow** opens the graph builder. | Authors can keep simple workflows simple and avoid an implicit format migration. |
| Explicit routes | Each conditional decision has ordered predicates and one **Otherwise** route. | A visible fallback matches #11's validation requirement and explains what happens when no predicate matches. |
| Bounded backward routes | An edge to an earlier node displays the per-node visit limit and its exhaustion destination. | A loop cannot be mistaken for an unlimited retry. |
| Save, no publish | **Save workflow** writes the file after server validation; overwrite requires confirmation. | Matches current file-backed workflow semantics. |
| Inspect real runs | **View route** shows persisted decisions and report references. | Provides evidence without simulated success counts. |
| No new AI in authoring | Keep the existing chain planner scoped to chains. Routing uses deterministic predicates. | A generated graph would require a separate quality bar and explicit review. |

## Screens and interaction

### 1. Workflow library (`/p/:projectId/workflows`)

- Heading **Workflows**; actions **New workflow** and **Import YAML**; search field **Search workflows**.
- Each entry shows name, description, **Chain** or **Decision**, **Built in** where applicable, and **Edit**. The built-in `quick-task` cannot be deleted.
- Empty state: **No saved workflows yet. Create a workflow to reuse a sequence of agent steps.** Action: **New workflow**.
- Loading: **Loading workflows…**. Load error: **Could not load workflows.** Action: **Retry**; show the server detail below without losing local edits.
- An invalid workflow file remains visible as **Could not load** with its path and parser reason, consistent with the existing workflow catalog's `issues` response; it must not disappear from the library.

### 2. New workflow choice

**New workflow** opens two choices:

- **Chain** — **Run agent and check steps in order.** Opens the current builder.
- **Decision workflow** — **Choose the next step from a structured report or check result.** Opens the new builder.

Import detects the server-parsed format and opens the matching editor. An existing chain is never silently converted. If a user intentionally requests conversion later, that is separate work.

### 3. Decision workflow editor (`/p/:projectId/workflows/:name` for saved workflows)

At desktop width, use three regions: a left step palette, a central connected flow, and a right inspector. At narrow widths, the palette and inspector open as labeled sheets; the flow has an always-available **Route list** that presents the same connections in reading order. Reuse the existing `Button`, `Input`, `Textarea`, `AlertDialog`, and loading/error primitives. Preserve the established project scope and route patterns.

**Header:** editable workflow name, **Unsaved changes** or **Saved**, **Export YAML**, **Save workflow**. An unsaved navigation attempt asks **Discard unsaved changes?** with **Keep editing** and **Discard changes**.

**Palette:** searchable **Add a step** list with **Agent step**, **Check**, **Decision**, and **End**. An explicit **Add next step** action on each node supports keyboard and touch use; pointer dragging is an enhancement, not the only way to build.

**Canvas:** each node card shows a type, name, concise configuration summary, and an error count when invalid. Each connection shows its condition or **Otherwise**; backward routes show **Repeat · at most N visits**. Selection opens the relevant inspector. The selected route is also described in text, so color and line shape never carry meaning alone. Canvas zoom/pan must retain keyboard access to every node and route. A simple ordered **Route list** is required even if a visual canvas library is used.

**Agent inspector:** **Step name**, **Instructions**, optional **Skill** and **Runner**, and **Report required** with the explanatory text **This step must submit a structured report before Cezar chooses a route.** For a graph agent node this is a fixed requirement from #11, not a user toggle. Unsupported runners are disabled with **This runner cannot submit workflow reports. Choose a supported runner.**

**Check inspector:** **Step name** and **Command**. Check routing offers only results allowed by the final #11 contract. The UI must not imply that arbitrary command output is a validated report field.

**Decision/route inspector:** fields **Report field**, **Operator**, **Value**, and **Next step** for each ordered condition. Supported operators are the small declarative set delivered by #11, such as **is**, **is one of**, and **is present**. Final row: **Otherwise → [step]**. A route with no fallback is a blocking error. For a backward route, show **Visit limit**, **When limit is reached**, and the destination. The exact field picker depends on the final typed-report contract; manual paths, if supported, must pass server validation before save. No free-form expression editor.

**End inspector:** **Outcome** with **Complete**, **Needs review**, or **Fail**, only where those outcomes map to #11's actual terminal states. Do not promise a new lifecycle state from UI copy alone.

**Problems to fix:** persistent list of server-authoritative validation errors, each focusing the node or route. Examples: **“Check migration” has no Otherwise route. Add one before saving.**; **The route back to “Implement” needs a visit limit.**; **No terminal path is reachable from “Start”.** A warning that is not blocking must say so explicitly. Do not display invented run counts or a “safe to publish” claim.

**Save:** submit through the versioned workflow route using the #11 graph schema. Validate client-side for timely feedback, then trust the server result. Keep the draft in memory on request failure. Show **Workflow wasn’t saved: [server reason]. Fix the highlighted item and try again.** Existing-file collision retains the current overwrite confirmation; its cancel action leaves the draft intact. After save, show **Saved workflow** and make the file available in the task workflow picker. Saving a changed definition must not mutate a running task's persisted definition; confirm this engine assumption during implementation.

### 4. Run route trace

From a run created with a decision workflow, **View route** opens a read-only ordered trace. For each visit show node name, attempt, accepted report reference or check result, predicates considered, selected edge, and visit count. A route to a prior node includes the remaining limit or exhaustion reason. Link to the run's existing event detail where available. Redact secrets and cap displayed report data as #10 requires.

Missing or rejected report: **No accepted report was received for this attempt. Routing stopped.** Action **Open run**. A blocked report that has no matching or fallback route shows the recorded unresolved reason. Canceled runs and human review keep their authoritative status. Never reconstruct route decisions from final prose.

## State and recovery requirements

| State | What the user sees | Recovery |
|---|---|---|
| Empty decision draft | **Add an agent step to start this workflow.** | **Add agent step** |
| Partial graph | Node and route errors in **Problems to fix**; **Save workflow** disabled until valid. | Focus each error and edit it. |
| Unknown report field or type | **This report field is not available for routing. Choose a validated field.** | Choose a field or revise the reporting contract. |
| Unsupported runner | **This runner cannot submit workflow reports. Choose a supported runner.** | Select a supported runner. |
| Save in progress | **Saving…** on the action; preserve the draft. | Wait or retry after failure. |
| Save conflict | Existing workflow confirmation names the file and says overwrite has no undo. | **Keep the file** or **Overwrite**. |
| Load or import error | Exact file/parse reason; no partial replacement of the current draft. | Correct YAML and retry; return to the draft. |
| No accepted report in a run | **No accepted report was received for this attempt. Routing stopped.** | **Open run** to inspect and continue through existing controls. |

Keyboard users must be able to add, select, reorder where meaningful, connect, edit, and remove nodes without drag gestures. Visible focus, readable route labels, and non-color status cues are required. Confirm accessible graph interaction with a prototype before choosing a canvas library.

## Engineering boundaries

- Extend the workflow definition/contract only with the final #11 versioned graph format; do not widen the legacy schema to treat graph data as an ordered chain. `packages/cezar/src/workflows/types.ts`, `packages/contract/src/workflows.ts`, loader, save/parse routes, run persistence, and client need the same discriminant and bounds.
- Keep workflow response parity and typed-body coverage. A project-scoped route needs its boot alias. Route validation belongs in middleware. Catalog load failures remain nonfatal.
- The current builder's eight-step cap applies to current chains. Graph limits must come from #11's documented node and visit bounds; do not reuse eight without a reason.
- Preserve file-based workflows under `.ai/cezar/workflows/`; no required config, background process, network request, or environment variable.
- Route-history UI reads persisted #11 transitions. It must show exactly what the engine recorded after crash recovery; no client-side predicate replay.
- Do not change `CEZ:DONE`, `CEZ:ASK`, `CEZ:MONITORING`, or `onFail` behavior for legacy workflows. In the new graph format, final-report completion follows #11.

## Delivery and acceptance

1. With #10 and #11 implemented, a user can create a decision workflow containing an agent report condition, an **Otherwise** path, a bounded backward route, and a reachable terminal node through the UI; saving writes valid graph YAML and the workflow appears in the task picker.
2. Given invalid edges, unknown targets or fields, missing fallback, unbounded cycle, unsupported runner, or unreachable terminal path, the UI identifies the offending control, and server save/start validation rejects the graph without discarding the draft.
3. Given a legacy `steps` or `skills` workflow, opening, editing, importing, exporting, saving, and running it retain current behavior. `quick-task` is unchanged. No automatic conversion occurs.
4. Given a completed graph run, **View route** shows the persisted accepted report reference, conditions considered, chosen edge, visit counts, and stop reason. A refresh or restart yields the same trace.
5. Given missing or invalid report and exhausted nudge attempts, the trace shows an unresolved stop, never a success edge. Cancel and human review still take precedence.
6. Keyboard and touch users can complete the example graph without pointer drag. The route list exposes all conditions and limits in text.

Verification: meaningful route/UI tests for save validation, branch/fallback/loop authoring, import of both formats, unsaved-change recovery, unsupported runner, and persisted run trace; server contract parity, route parity, typed bodies, and legacy-workflow regression tests. Run the repository's required typecheck, test, build, and package checks for the implementation PR.

## Decision-changing test and open dependency

Prototype one branch plus one bounded retry with the canvas and route list. Ask developers to create it and explain the fallback and maximum visits without coaching. If they cannot, simplify the inspector and route list before building the canvas. This is a proposed test, not completed research.

The final #10/#11 contracts must settle discoverable report-field paths/types, terminal outcome names, graph size limits, and the run-history response before UI implementation. The editor must follow those contracts rather than define a second routing model.
