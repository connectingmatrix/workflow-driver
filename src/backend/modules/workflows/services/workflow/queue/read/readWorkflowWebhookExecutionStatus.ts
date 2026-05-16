import { Executor } from '@workflow/executor';
import { GigaORM } from '@connectingmatrix/orm/orm';
import { WorkflowExecutionEntity } from '@connectingmatrix/orm/repositories/entities';

const toSafeStatus = (value: unknown): 'queued' | 'running' | 'completed' | 'failed' | null => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'queued' || normalized === 'running' || normalized === 'completed' || normalized === 'failed') {
    return normalized;
  }
  return null;
};

export interface WorkflowWebhookExecutionStatusResponse {
  error?: string;
  executionTime: number;
  output?: unknown;
  status: 'queued' | 'running' | 'completed' | 'failed';
  timeElapsed: number;
}

export const buildWorkflowWebhookExecutionStatusResponse = (row: {
  completed_at?: string | null;
  created_at?: string | null;
  error_message?: string | null;
  response_payload?: unknown;
  status?: unknown;
}) => {
  const status = toSafeStatus(row.status);
  if (!status) {
    return null;
  }

  const timing = Executor.resolveWorkflowQueueTiming({
    createdAt: row.created_at || null,
    completedAt: row.completed_at || null,
    responsePayload: row.response_payload,
  });
  const responsePayload =
    row.response_payload && typeof row.response_payload === 'object' && !Array.isArray(row.response_payload)
      ? (row.response_payload as Record<string, unknown>)
      : {};

  const base: WorkflowWebhookExecutionStatusResponse = {
    status,
    timeElapsed: timing.timeElapsed,
    executionTime: status === 'queued' ? 0 : timing.executionTime,
  };

  if (status === 'completed') {
    return {
      ...base,
      output: responsePayload.output,
    };
  }

  if (status === 'failed') {
    return {
      ...base,
      error: typeof row.error_message === 'string' && row.error_message.trim() ? row.error_message : 'Workflow execution failed.',
    };
  }

  return base;
};

export const loadWorkflowWebhookExecutionStatus = async (params: { executionId: string; supabase: any; workflowId: string }) => {
  const runtime = GigaORM.current();
  const meta = (runtime.meta as Record<string, unknown> | undefined) || {};
  const data = await GigaORM.run({ ...runtime, meta: { ...meta, supabase: params.supabase as Record<string, unknown> } }, () =>
    WorkflowExecutionEntity.findByWorkflowExecution({
      workflowId: params.workflowId,
      executionId: params.executionId,
    }),
  );
  if (!data?.id || String(data.workflow_id || '').trim() !== params.workflowId) {
    return null;
  }
  return buildWorkflowWebhookExecutionStatusResponse(data);
};
