import { z } from 'zod';

/** A report is an agent claim, never a verified completion signal. */
const scalarSchema = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);
const dataValueSchema = z.union([
  scalarSchema,
  z.array(scalarSchema).max(32),
  z.record(z.string().max(80), scalarSchema),
]);
export const taskReportPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  idempotencyKey: z.string().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/),
  outcome: z.enum(['completed', 'blocked', 'failed', 'inconclusive']),
  summary: z.string().min(1).max(500),
  data: z.record(z.string().max(80), dataValueSchema).default({}),
  evidence: z.array(z.object({
    ref: z.string().min(1).max(300),
    note: z.string().max(200).optional(),
  }).strict()).max(16).default([]),
}).strict().superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 8192) {
    ctx.addIssue({ code: 'custom', message: 'report exceeds 8192 bytes' });
  }
});
export type TaskReportPayload = z.infer<typeof taskReportPayloadSchema>;

export const acceptedTaskReportSchema = z.object({
  runId: z.string(),
  stepId: z.string(),
  attempt: z.number().int().positive(),
  acceptedAt: z.string().datetime(),
  payload: taskReportPayloadSchema,
});
export type AcceptedTaskReport = z.infer<typeof acceptedTaskReportSchema>;
