import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunStore } from '../runs/store.ts';
import { TaskReportToolReceiver, taskReportMcpPath } from './task-report-tool.ts';
import { buildClaudeArgs } from './claude-cli-runner.ts';
import { buildCodexAppServerArgs } from './codex-app-server-transport.ts';
import { opencodeReportConfig } from './opencode-server-runner.ts';
import { buildChildEnv } from './agent-env.ts';

const dirs: string[] = [];
const receivers: TaskReportToolReceiver[] = [];
const stores: RunStore[] = [];
afterEach(() => {
  for (const receiver of receivers) receiver.close();
  for (const store of stores) clearTimeout((store as unknown as { saveTimer: NodeJS.Timeout | null }).saveTimer ?? undefined);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  receivers.length = 0;
  stores.length = 0;
  dirs.length = 0;
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cez-report-test-'));
  dirs.push(dir);
  const store = RunStore.open(dir);
  stores.push(store);
  const run = store.createRun({ title: 'test', workflow: 'quick-task', task: 'test', steps: [{ id: 'agent', name: 'Agent', kind: 'agent' }] });
  store.updateRun(run.id, { status: 'running', currentStepId: 'agent' });
  store.updateStep(run.id, 'agent', { status: 'running', iterations: 1 });
  const receiver = new TaskReportToolReceiver(store);
  receivers.push(receiver);
  return { dir, store, run, receiver };
}

const payload = { schemaVersion: 1, idempotencyKey: 'attempt-1', outcome: 'completed', summary: 'Implemented the change.', data: { tests: 4 }, evidence: [{ ref: 'commit:abc123' }] };

function post(socketPath: string, capability: string, body: unknown): Promise<{ status: number; value: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/report', method: 'POST', headers: { authorization: `Bearer ${capability}` } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, value: JSON.parse(text) as Record<string, unknown> }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

describe('owner-bound task report tool', () => {
  it('registers the same MCP server on Claude, Codex and OpenCode without overriding unrelated config', () => {
    const env = { CEZ_REPORT_SOCKET: '/tmp/owner.sock', CEZ_REPORT_CAPABILITY: 'a'.repeat(64) };
    const claude = buildClaudeArgs({ cwd: '/tmp', userPrompt: 'test', env, allowedTools: ['Read'] });
    expect(claude).toContain('--mcp-config');
    expect(JSON.parse(claude[claude.indexOf('--mcp-config') + 1]!)).toMatchObject({ mcpServers: { cezar: { command: process.execPath, args: [taskReportMcpPath()] } } });
    expect(claude[claude.indexOf('--allowedTools') + 1]).toContain('mcp__cezar__report_task_result');
    const codex = buildCodexAppServerArgs(env).join(' ');
    expect(codex).toContain('mcp_servers.cezar.command');
    expect(codex).toContain(taskReportMcpPath());
    const opencode = JSON.parse(opencodeReportConfig(JSON.stringify({ model: 'provider/model', mcp: { servers: { other: { type: 'remote', url: 'https://example.com' } } } })));
    expect(opencode.model).toBe('provider/model');
    expect(opencode.mcp.servers.other).toMatchObject({ type: 'remote' });
    expect(opencode.mcp.servers.cezar.command).toEqual([process.execPath, taskReportMcpPath()]);
    expect(buildCodexAppServerArgs()).toEqual(['app-server']);
    expect(buildClaudeArgs({ cwd: '/tmp', userPrompt: 'test' })).not.toContain('--mcp-config');
  });

  it('does not leak a parent attempt capability into nested agent processes', () => {
    const source = { CEZ_REPORT_SOCKET: '/tmp/parent.sock', CEZ_REPORT_CAPABILITY: 'parent-token', CEZ_TASK_ID: 'parent' };
    expect(buildChildEnv({ backend: 'claude', source })).toMatchObject({ CEZ_TASK_ID: 'parent' });
    expect(buildChildEnv({ backend: 'claude', source })).not.toHaveProperty('CEZ_REPORT_CAPABILITY');
    expect(buildChildEnv({ backend: 'claude', source: { ...source, CEZ_AGENT_ENV_FULL: '1' } })).not.toHaveProperty('CEZ_REPORT_CAPABILITY');
    expect(buildChildEnv({ backend: 'claude', source, extraEnv: { CEZ_REPORT_CAPABILITY: 'child-token' } }).CEZ_REPORT_CAPABILITY).toBe('child-token');
  });
  it('accepts a real MCP tool call, persists it, and reads it after restart', async () => {
    const { dir, run, receiver } = fixture();
    const grant = await receiver.grant(run.id, 'agent', 1);
    const child = spawn(process.execPath, [taskReportMcpPath()], { env: { ...process.env, ...grant.env }, stdio: 'pipe' });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; });
    child.stdin.end([
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'report_task_result', arguments: payload } }),
      '',
    ].join('\n'));
    await once(child, 'close');
    const messages = output.trim().split('\n').map((line) => JSON.parse(line) as { id: number; result: Record<string, unknown> });
    expect(messages.find((message) => message.id === 2)?.result).toMatchObject({ tools: [{ name: 'report_task_result' }] });
    expect(messages.find((message) => message.id === 3)?.result).toMatchObject({ isError: false });
    expect(RunStore.open(dir, { keepLive: true }).getRun(run.id)?.taskReports).toMatchObject([{ runId: run.id, stepId: 'agent', attempt: 1 }]);
    expect(readFileSync(join(dir, 'runs.json'), 'utf8')).not.toContain(grant.env.CEZ_REPORT_CAPABILITY);
  });

  it('rejects invalid, replay-conflicting, stale, foreign and settled submissions without changing reports', async () => {
    const { run, store, receiver } = fixture();
    const grant = await receiver.grant(run.id, 'agent', 1);
    const foreign = await receiver.grant('different-run', 'agent', 1);
    expect((await post(grant.env.CEZ_REPORT_SOCKET!, grant.env.CEZ_REPORT_CAPABILITY!, { ...payload, outcome: 'invalid' })).status).toBe(400);
    expect((await post(grant.env.CEZ_REPORT_SOCKET!, grant.env.CEZ_REPORT_CAPABILITY!, { ...payload, runId: 'some-other-run' })).status).toBe(400);
    expect((await post(grant.env.CEZ_REPORT_SOCKET!, foreign.env.CEZ_REPORT_CAPABILITY!, payload)).status).toBe(409);
    const accepted = await post(grant.env.CEZ_REPORT_SOCKET!, grant.env.CEZ_REPORT_CAPABILITY!, payload);
    expect(accepted.status).toBe(200);
    expect(JSON.stringify(accepted.value)).not.toContain(payload.idempotencyKey);
    expect((await post(grant.env.CEZ_REPORT_SOCKET!, grant.env.CEZ_REPORT_CAPABILITY!, payload)).value).toEqual(accepted.value);
    expect((await post(grant.env.CEZ_REPORT_SOCKET!, grant.env.CEZ_REPORT_CAPABILITY!, { ...payload, summary: 'different' })).status).toBe(409);
    expect((await post(grant.env.CEZ_REPORT_SOCKET!, '0'.repeat(64), payload)).status).toBe(403);
    store.updateStep(run.id, 'agent', { iterations: 2 });
    expect((await post(grant.env.CEZ_REPORT_SOCKET!, grant.env.CEZ_REPORT_CAPABILITY!, payload)).status).toBe(409);
    store.updateRun(run.id, { status: 'done' });
    expect((await post(grant.env.CEZ_REPORT_SOCKET!, grant.env.CEZ_REPORT_CAPABILITY!, payload)).status).toBe(409);
    expect(store.getRun(run.id)?.taskReports).toHaveLength(1);
  });

  it('binds a capability to its own run even when another run is active', async () => {
    const { run, store, receiver } = fixture();
    const second = store.createRun({ title: 'second', workflow: 'quick-task', task: 'second', steps: [{ id: 'agent', name: 'Agent', kind: 'agent' }] });
    store.updateRun(second.id, { status: 'running', currentStepId: 'agent' });
    store.updateStep(second.id, 'agent', { status: 'running', iterations: 1 });
    const grant = await receiver.grant(second.id, 'agent', 1);
    expect((await post(grant.env.CEZ_REPORT_SOCKET!, grant.env.CEZ_REPORT_CAPABILITY!, payload)).status).toBe(200);
    expect(store.getRun(run.id)?.taskReports).toBeUndefined();
    expect(store.getRun(second.id)?.taskReports).toHaveLength(1);
  });

  it('rejects oversized data and rolls back a failed durable commit', async () => {
    const { dir, run, store, receiver } = fixture();
    const grant = await receiver.grant(run.id, 'agent', 1);
    expect((await post(grant.env.CEZ_REPORT_SOCKET!, grant.env.CEZ_REPORT_CAPABILITY!, { ...payload, data: { huge: 'x'.repeat(10_000) } })).status).toBe(400);
    expect((await post(grant.env.CEZ_REPORT_SOCKET!, grant.env.CEZ_REPORT_CAPABILITY!, { ...payload, data: { huge: 'x'.repeat(20_000) } })).status).toBe(413);
    expect(store.getRun(run.id)?.taskReports).toBeUndefined();
    store.flush();
    rmSync(dir, { recursive: true, force: true });
    const failed = await post(grant.env.CEZ_REPORT_SOCKET!, grant.env.CEZ_REPORT_CAPABILITY!, payload);
    expect(failed.status).toBe(409);
    expect(failed.value.error).toMatch(/could not be saved/i);
    expect(store.getRun(run.id)?.taskReports).toBeUndefined();
  });

  it('redacts known secrets from every user-controlled report field', async () => {
    const { run, store, receiver } = fixture();
    store.registerRunSecrets(run.id, ['secret-credential-value']);
    const grant = await receiver.grant(run.id, 'agent', 1);
    const result = await post(grant.env.CEZ_REPORT_SOCKET!, grant.env.CEZ_REPORT_CAPABILITY!, {
      ...payload,
      summary: 'Observed secret-credential-value',
      data: { message: 'secret-credential-value' },
      evidence: [{ ref: 'secret-credential-value' }],
    });
    expect(result.status).toBe(200);
    expect(JSON.stringify(result.value)).not.toContain('secret-credential-value');
    expect(JSON.stringify(store.getRun(run.id)?.taskReports)).not.toContain('secret-credential-value');
  });
});
