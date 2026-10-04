# Structured in-task reports

Source: [Igloczek/cezar#10](https://github.com/Igloczek/cezar/issues/10).

## Goal

An agent inside a Cezar task can submit one validated, durable report for its current
run, workflow step and attempt. A report is a claim. It does not decide workflow
routing or change completion behavior; issue #11 owns that later step.

## Contract and lifecycle

- `report_task_result` accepts schema version 1, an idempotency key, outcome,
  summary, bounded JSON data and evidence references. Data is a flat map of
  scalars, lists of at most 32 scalars, or one-level scalar maps. Limits apply
  before persistence, including list length and 8192-byte total size. Secret redaction
  runs before anything reaches disk or the run API.
- Cezar grants a random capability for each agent invocation. A local MCP server
  passes the capability to a process-owned Unix socket; the caller cannot supply
  a run ID, step ID or attempt. The parent validates the capability against its
  current invocation, then commits the report to the run store synchronously.
- An exact retry with the same idempotency key and payload returns the stored
  result. A different submission for the same attempt fails as a conflict.
  A stale capability, settled run, or invalid payload fails without mutation.
  The stored idempotency key is a SHA-256 digest of the caller's key.
  A second digest of the validated, unredacted submission distinguishes
  conflicting calls whose secret values redact to the same display text.
- The accepted report belongs to the run record and appears in its versioned
  API representation for later Cezar workflow routing. It is not rendered in
  the task cockpit. A restart reads it from `runs.json`.
- The capability is never written to a run record, event, log, or error message.
  Session teardown invalidates it. Resume creates a new capability and attempt.

## Backend support

Claude Code, Codex and OpenCode inject the local MCP server into each fresh and
resumed session. Cursor, pi, Junie and Copilot expose the unsupported limitation
until they can register the same tool. A printed marker and a UI tool-call event
are never accepted as a report.

## Implementation Plan

1. Define and export the versioned payload, accepted record and size bounds in
   `packages/contract`; add persistence to the run store and contract parity.
2. Add the owner-bound local report receiver and MCP stdio tool. Test validation,
   idempotency, stale attempts, settlement, restart and transaction failure.
3. Inject the MCP configuration at both runner construction paths for Claude,
   Codex and OpenCode. Test the generated wire configurations and a real MCP
   invocation through a mock backend. Document every selectable runner.
4. Keep accepted reports in run history without a task-view panel, update `AGENT_PROTOCOL.md` and
   `BACKWARD_COMPATIBILITY.md`, and verify the default workflow path still works.
