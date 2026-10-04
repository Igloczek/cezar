import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import type { RunStore } from '../runs/store.ts';

/** Shipped stdio MCP entrypoint, independent of whether this module runs from src or dist. */
export function taskReportMcpPath(): string {
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '../../scripts/task-report-mcp.mjs');
}

export interface TaskReportGrant {
  env: Record<string, string>;
  revoke(): void;
}

/** A socket belongs to this RunManager process, so CEZ_API_URL can never select another cockpit. */
export class TaskReportToolReceiver {
  private server: Server | undefined;
  private ready: Promise<void> | undefined;
  private readonly socketPath = reportSocketPath();
  private readonly grants = new Map<string, { runId: string; stepId: string; attempt: number }>();
  private readonly cleanupSocket = () => { if (process.platform !== 'win32') rmSync(this.socketPath, { force: true }); };

  constructor(private readonly store: RunStore) {}

  async grant(runId: string, stepId: string, attempt: number): Promise<TaskReportGrant> {
    await this.start();
    const capability = randomBytes(32).toString('hex');
    this.grants.set(capability, { runId, stepId, attempt });
    return {
      env: { CEZ_REPORT_SOCKET: this.socketPath, CEZ_REPORT_CAPABILITY: capability },
      revoke: () => { this.grants.delete(capability); },
    };
  }

  close(): void {
    this.grants.clear();
    if (this.server?.listening) this.server.close();
    this.cleanupSocket();
    process.off('exit', this.cleanupSocket);
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.server = createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/report') {
        res.writeHead(404).end();
        return;
      }
      const token = req.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
      const binding = token ? this.grants.get(token) : undefined;
      if (!binding) {
        res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Invalid or expired task report capability.' }));
        return;
      }
      let body = '';
      let tooLarge = false;
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        if (!tooLarge) body += chunk;
        if (body.length > 16_384) { tooLarge = true; body = ''; }
      });
      req.on('end', () => {
        try {
          if (tooLarge) {
            res.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Report exceeds 16384 bytes.' }));
            return;
          }
          const accepted = this.store.acceptTaskReport(binding.runId, binding.stepId, binding.attempt, JSON.parse(body));
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(accepted));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Report rejected.';
          // Never echo Zod's potentially sensitive input in a tool error.
          const safe = error instanceof SyntaxError || error instanceof ZodError
            ? 'Invalid report JSON or schema. Check required fields and size limits.'
            : message;
          const status = error instanceof SyntaxError || error instanceof ZodError ? 400 : 409;
          res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: safe }));
        }
      });
    });
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.server!.once('error', rejectReady);
      this.server!.listen(this.socketPath, () => {
        if (process.platform !== 'win32') chmodSync(this.socketPath, 0o600);
        // Headless `cezar run` has no long-lived HTTP server. Its completed
        // workflow must be allowed to exit even if RunManager was not disposed.
        this.server!.unref();
        process.once('exit', this.cleanupSocket);
        resolveReady();
      });
    });
    return this.ready;
  }
}

function reportSocketPath(): string {
  const name = `cr-${process.pid}-${randomBytes(8).toString('hex')}`;
  if (process.platform === 'win32') return `\\\\.\\pipe\\${name}`;
  // Unix sockets have a short path limit (~108 bytes). An agent's task-local
  // TMPDIR can already be deeper than that, so use the system temp root then.
  const root = tmpdir().length > 70 ? '/tmp' : tmpdir();
  return join(root, `${name}.sock`);
}
