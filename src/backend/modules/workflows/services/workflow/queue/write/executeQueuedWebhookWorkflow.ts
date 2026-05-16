import { Executor, type WorkflowQueueCompletedEvent } from '@workflow/executor';
import { GigaORM } from '@connectingmatrix/orm/orm';
import { WorkflowExecutionEntity } from '@connectingmatrix/orm/repositories/entities';
import { normalizeWorkflowSnapshotIdentity } from '@connectingmatrix/workflow-driver/services/workflow/runtime/workflow-identity';
import { extractWorkflowTerminalPayload } from '@connectingmatrix/workflow-driver/services/workflow/runtime/webhook';
import { queueWebhookWorkflowExecution } from './queueWebhookWorkflowExecution';
import type { Request, Response } from 'express';
import type { PersistedWorkflowRecord, WorkflowWebhookRequestPayload } from '@connectingmatrix/workflow-driver/services/workflow/runtime/webhook';

const createAbortSignal = (request: Request, response: Response): AbortSignal => {
  const controller = new AbortController();
  request.once('aborted', () => controller.abort());
  response.once('close', () => {
    if (!response.writableEnded) {
      controller.abort();
    }
  });
  return controller.signal;
};

export const createQueuedWebhookWorkflowExecution = async (params: {
  adminSupabase: any;
  preparedWorkflow: any;
  record: PersistedWorkflowRecord;
  request: Request;
  routeType: 'published';
  runtimeLimits?: { maxConcurrentExecutionsPerUser?: number; maxExecutionSeconds?: number };
  webhookRequest: WorkflowWebhookRequestPayload;
}): Promise<{ executionId: string; runId: string }> => {
  const result = await queueWebhookWorkflowExecution(params);
  return {
    executionId: result.executionId,
    runId: result.runId,
  };
};

export const executeQueuedWebhookWorkflow = async (params: {
  request: Request;
  response: Response;
  routeType: 'published';
  adminSupabase: any;
  record: PersistedWorkflowRecord;
  webhookRequest: WorkflowWebhookRequestPayload;
  preparedWorkflow: any;
  runtimeLimits?: { maxConcurrentExecutionsPerUser?: number; maxExecutionSeconds?: number };
}): Promise<{
  logs: unknown[];
  output: unknown;
  runId: string;
  stopped: boolean;
  workflow: any;
}> => {
  const runWithStore = <T>(callback: () => Promise<T>): Promise<T> => {
    const runtime = GigaORM.current();
    const meta = (runtime.meta as Record<string, unknown> | undefined) || {};
    return Promise.resolve(GigaORM.run({ ...runtime, meta: { ...meta, supabase: params.adminSupabase as Record<string, unknown> } }, callback));
  };
  const queuedExecution = await queueWebhookWorkflowExecution(params);
  const terminalEvent = await Executor.waitForWorkflowQueueCompletion(
    queuedExecution.executionId,
    createAbortSignal(params.request, params.response),
  );
  if (terminalEvent.type !== 'completed') {
    throw new Error(terminalEvent.errorMessage || 'Workflow webhook execution failed.');
  }

  const completedEvent = terminalEvent as WorkflowQueueCompletedEvent;
  const output = extractWorkflowTerminalPayload(completedEvent.result.workflow as any);
  const currentRecord = await runWithStore(() => WorkflowExecutionEntity.readResponsePayloadRowById(queuedExecution.executionId));
  await runWithStore(() =>
    WorkflowExecutionEntity.updateRecord({
      id: queuedExecution.executionId,
      patch: {
        response_payload: Executor.mergeWorkflowQueueTimingPayload(
          {
            route_type: params.routeType,
            output,
          },
          currentRecord?.response_payload || null,
          queuedExecution.queuedAt,
        ) as Record<string, unknown>,
        workflow_snapshot: normalizeWorkflowSnapshotIdentity({
          workflow: completedEvent.result.workflow as any,
          workflowId: params.record.id,
          workflowName: params.record.name,
          workflowDescription: params.record.description,
          workflowScope: params.record.scope === 'default' ? 'global' : params.record.scope,
        }) as unknown as Record<string, unknown>,
      },
    }),
  );

  return {
    runId: completedEvent.result.runId,
    stopped: completedEvent.result.stopped,
    workflow: completedEvent.result.workflow,
    output,
    logs: completedEvent.result.logs,
  };
};
