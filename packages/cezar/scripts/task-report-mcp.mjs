#!/usr/bin/env node
// Minimal stdio MCP bridge. The owning Cezar process alone validates and stores reports.
import { request } from 'node:http';
import { createInterface } from 'node:readline';

const tool = {
  name: 'report_task_result',
  description: 'Submit one structured claim for this Cezar task step. Data may contain scalars, arrays of up to 32 scalars, or flat scalar objects; the whole report is at most 8192 bytes. Acceptance does not complete or route the task.',
  inputSchema: {
    type: 'object',
    required: ['schemaVersion', 'idempotencyKey', 'outcome', 'summary'],
    properties: {
      schemaVersion: { type: 'integer', const: 1 },
      idempotencyKey: { type: 'string', minLength: 1, maxLength: 80 },
      outcome: { type: 'string', enum: ['completed', 'blocked', 'failed', 'inconclusive'] },
      summary: { type: 'string', minLength: 1, maxLength: 500 },
      data: { type: 'object', additionalProperties: true },
      evidence: { type: 'array', maxItems: 16, items: { type: 'object', required: ['ref'], properties: { ref: { type: 'string' }, note: { type: 'string' } } } },
    },
  },
};

function submit(args) {
  return new Promise((resolve) => {
    if (!process.env.CEZ_REPORT_SOCKET || !process.env.CEZ_REPORT_CAPABILITY) {
      resolve({ isError: true, content: [{ type: 'text', text: 'Task report tool is not bound to an active Cezar session.' }] });
      return;
    }
    const req = request({
      socketPath: process.env.CEZ_REPORT_SOCKET,
      path: '/report', method: 'POST',
      headers: { authorization: `Bearer ${process.env.CEZ_REPORT_CAPABILITY}`, 'content-type': 'application/json' },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; if (body.length > 20_000) req.destroy(); });
      res.on('end', () => {
        try {
          const value = JSON.parse(body);
          resolve({ isError: res.statusCode !== 200, content: [{ type: 'text', text: res.statusCode === 200
            ? `Report accepted for step ${value.stepId}, attempt ${value.attempt}.`
            : (value.error ?? 'Report rejected.') }] });
        } catch { resolve({ isError: true, content: [{ type: 'text', text: 'Report receiver returned an invalid response.' }] }); }
      });
    });
    req.on('error', () => resolve({ isError: true, content: [{ type: 'text', text: 'The owning Cezar process is unavailable. Retry while this session is active.' }] }));
    req.end(JSON.stringify(args));
  });
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (line.length > 20_000) continue;
  let message;
  try { message = JSON.parse(line); } catch { continue; }
  if (message.id === undefined) continue;
  let result;
  switch (message.method) {
    case 'initialize': result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cezar-task-report', version: '1' } }; break;
    case 'tools/list': result = { tools: [tool] }; break;
    case 'tools/call': result = message.params?.name === tool.name
      ? await submit(message.params?.arguments ?? {})
      : { isError: true, content: [{ type: 'text', text: 'Unknown tool.' }] }; break;
    default: process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })}\n`); continue;
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
}
