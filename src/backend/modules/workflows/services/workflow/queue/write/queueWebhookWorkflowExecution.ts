import { createRunId } from 'giga-ai-helper/workflow';
import { Executor, type WorkflowQueueRequest } from '@workflow/executor';
import { GigaORM } from '@connectingmatrix/orm/orm';
import { logger } from '@connectingmatrix/logger/lifecycle-jsonl';
import { isCurrentUserRootUser } from '@giga/shared/lib/helper';
import { OrganisationEntity, WorkflowExecutionEntity, WorkflowVersionEntity } from '@connectingmatrix/orm/repositories/entities';
import { resolveWorkflowRuntimeSettings } from '@connectingmatrix/workflow-driver/services/workflow/runtime/webhook';
import '@connectingmatrix/workflow-driver/services/workflow/runtime/setupWorkflowExecutor';
import type { Request } from 'express';
import type { PersistedWorkflowRecord, WorkflowWebhookRequestPayload } from '@connectingmatrix/workflow-driver/services/workflow/runtime/webhook';
import type { WorkflowDefinition, WorkflowReference } from '@giga/shared/types/contracts/workflow.types';

export interface EnqueueWebhookWorkflowExecutionResult {
  executionId: string;
  preparedWorkflow: any;
  queuedAt: string;
  runId: string;
  workflowReference: WorkflowReference;
}

export const queueWebhookWorkflowExecution = async (params: {
  adminSupabase: any;
  preparedWorkflow: any;
  record: PersistedWorkflowRecord;
  request: Request;
  routeType: 'published';
  runtimeLimits?: { maxConcurrentExecutionsPerUser?: number; maxExecutionSeconds?: number };
  webhookRequest: WorkflowWebhookRequestPayload;
}): Promise<EnqueueWebhookWorkflowExecutionResult> => {
  const runWithStore = <T>(callback: () => Promise<T>): Promise<T> => {
    const runtime = GigaORM.current();
    const meta = (runtime.meta as Record<string, unknown> | undefined) || {};
    return Promise.resolve(GigaORM.run({ ...runtime, meta: { ...meta, supabase: params.adminSupabase as Record<string, unknown> } }, callback));
  };
  const startedAt = Date.now();
  const requestId = (params.webhookRequest as any)?.request_id || null;
  // prettier-ignore
  logger.debug({ layer: 'workflow.queue', event: 'workflow.enqueue.webhook', phase: 'start', transport: 'workflow_queue', request_id: requestId, status: 'running', duration_ms: 0, since_prev_ms: 0, meta: {}, });
  const workflowReference: WorkflowReference = {
    workflowId: params.record.id,
    scope: params.record.scope === 'default' ? 'global' : params.record.scope === 'organization' ? 'organization' : 'user',
    organizationId: params.record.organizationId || null,
    ownerUserId: params.record.scope === 'user' ? params.record.userId : null,
  };
  const runId = createRunId('run');
  const workflowVersionId = await runWithStore(() => WorkflowVersionEntity.resolveCurrentId({ workflowId: workflowReference.workflowId })).catch(
    () => null,
  );
  const queuedAt = new Date().toISOString();
  const tracker = await runWithStore(() =>
    WorkflowExecutionEntity.createTracker({
      workflowId: workflowReference.workflowId,
      workflowVersionId,
      workflowSource: workflowReference.scope === 'organization' ? 'organization' : workflowReference.scope === 'user' ? 'user' : 'default',
      triggerType: 'webhook',
      runId,
      userId: params.record.userId || null,
      scopeType: null,
      scopeId: null,
      status: 'queued',
      requestPayload: {
        method: params.webhookRequest.method,
        headers: params.webhookRequest.headers,
        query: params.webhookRequest.query,
        body: params.webhookRequest.body,
        path: params.webhookRequest.path,
        routeType: params.webhookRequest.routeType,
      },
      responsePayload: Executor.createWorkflowQueueTimingPayload(queuedAt) as Record<string, unknown>,
      workflowSnapshot: params.preparedWorkflow as WorkflowDefinition,
      startedAt: queuedAt,
      inputPayload: {
        run_id: runId,
        trigger_type: 'webhook',
        user_id: params.record.userId || null,
        request_payload: params.webhookRequest,
        response_payload: Executor.createWorkflowQueueTimingPayload(queuedAt),
        workflow_snapshot: params.preparedWorkflow,
      } as Record<string, unknown>,
    }),
  );
  const trackerId = String(tracker.id || '');

  const requestContext = Executor.createWorkflowQueueRequestContextSnapshot({
    mode: 'admin',
    request: params.request,
    userId: params.record.userId || 'workflow-webhook',
  });
  const baseSettings = resolveWorkflowRuntimeSettings(params.request, params.preparedWorkflow, params.runtimeLimits);
  const effectiveRoot = await isCurrentUserRootUser(params.adminSupabase).catch(() => false);
  const organization = workflowReference.organizationId ? (OrganisationEntity.load(workflowReference.organizationId) as OrganisationEntity) : null;
  const sharedDrive = organization
    ? await organization.sharedSpace.workflowDrive({
        request: params.request,
        supabase: params.adminSupabase,
        userId: params.record.userId || 'workflow-webhook',
        effectiveRoot,
      })
    : null;
  const settings = { ...(baseSettings as any), sharedDrive };
  const queueRequest: WorkflowQueueRequest = {
    executionId: trackerId,
    runId,
    queueKey: params.record.userId || `workflow:${params.record.id}`,
    userId: params.record.userId || 'workflow-webhook',
    broadcastId: params.record.userId || 'workflow-webhook',
    broadcastChannelName: 'workflow-socket',
    triggerType: 'webhook',
    workflowReference,
    workflowVersionId,
    workflow: params.preparedWorkflow,
    settings,
    requestContext,
    metadata: {
      routeType: params.routeType,
      webhookRequest: params.webhookRequest,
    },
  };

  try {
    await Executor.enqueue(queueRequest.queueKey, { request: queueRequest }, params.preparedWorkflow);
  } catch (error: any) {
    // prettier-ignore
    logger.error({ layer: 'workflow.queue', event: 'workflow.enqueue.webhook', phase: 'error', transport: 'workflow_queue', request_id: requestId, run_id: runId, status: 'failed', duration_ms: Date.now() - startedAt, since_prev_ms: 0, meta: {}, });
    await runWithStore(() =>
      WorkflowExecutionEntity.finalize({
        id: trackerId,
        status: 'failed',
        error: { message: error?.message || 'Failed to enqueue webhook workflow execution.' },
        output: Executor.createWorkflowQueueTimingPayload(queuedAt) as unknown as Record<string, unknown>,
        finishedAt: new Date().toISOString(),
      }),
    );
    throw error;
  }
  // prettier-ignore
  logger.info({ layer: 'workflow.queue', event: 'workflow.enqueue.webhook', phase: 'end', transport: 'workflow_queue', request_id: requestId, run_id: runId, status: 'queued', duration_ms: Date.now() - startedAt, since_prev_ms: 0, meta: { execution_id: tracker.id }, });

  return {
    executionId: trackerId,
    preparedWorkflow: params.preparedWorkflow,
    queuedAt,
    runId,
    workflowReference,
  };
};
