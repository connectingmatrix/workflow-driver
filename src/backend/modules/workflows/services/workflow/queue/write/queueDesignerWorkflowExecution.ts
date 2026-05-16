import { createRunId } from 'giga-ai-helper/workflow';
import { Executor } from '@workflow/executor';
import { GigaORM } from '@connectingmatrix/orm/orm';
import { logger } from '@connectingmatrix/logger/lifecycle-jsonl';
import { isCurrentUserRootUser } from '@giga/shared/lib/helper';
import { OrganisationEntity, WorkflowEntity, WorkflowExecutionEntity, WorkflowVersionEntity } from '@connectingmatrix/orm/repositories/entities';
import { WorkflowDefinition, WorkflowRuntimeSettings } from '@connectingmatrix/workflow-driver/services/workflow/contracts/types';
import '@connectingmatrix/workflow-driver/services/workflow/runtime/setupWorkflowExecutor';
import type { Request } from 'express';
import type { WorkflowQueueRequest } from '@workflow/executor';
import type { WorkflowReference } from '@giga/shared/types/contracts/workflow.types';

const loadWorkflowReference = async (params: {
  currentUserId: string;
  organizationId?: string | null;
  supabase: any;
  workflowId: string;
}): Promise<WorkflowReference> => {
  if (params.organizationId) {
    const organizationReference = await WorkflowEntity.resolveReference({
      workflowId: params.workflowId,
      currentUserId: params.currentUserId,
      organizationId: params.organizationId,
      scope: 'organization',
    });
    if (organizationReference) {
      return organizationReference;
    }
  }
  const userReference = await WorkflowEntity.resolveReference({
    workflowId: params.workflowId,
    currentUserId: params.currentUserId,
    organizationId: params.organizationId || null,
    scope: 'user',
  });
  if (userReference) {
    return userReference;
  }
  const globalReference = await WorkflowEntity.resolveReference({
    workflowId: params.workflowId,
    currentUserId: params.currentUserId,
    organizationId: params.organizationId || null,
    scope: 'global',
  });
  if (globalReference) {
    return globalReference;
  }
  throw new Error('Workflow record was not found for execution.');
};

export const queueDesignerWorkflowExecution = async (params: {
  broadcastId: string;
  broadcastChannelName: string;
  currentUserId: string;
  organizationId?: string | null;
  request: Request;
  requestId?: string | null;
  settings: WorkflowRuntimeSettings;
  supabase: any;
  workflow: WorkflowDefinition;
}): Promise<{ executionId: string; runId: string }> => {
  const runWithStore = <T>(callback: () => Promise<T>): Promise<T> => {
    const runtime = GigaORM.current();
    const meta = (runtime.meta as Record<string, unknown> | undefined) || {};
    return Promise.resolve(GigaORM.run({ ...runtime, meta: { ...meta, supabase: params.supabase as Record<string, unknown> } }, callback));
  };
  const startedAt = Date.now();
  // prettier-ignore
  logger.debug({ layer: 'workflow.queue', event: 'workflow.enqueue.designer', phase: 'start', transport: 'workflow_queue', request_id: params.requestId || null, status: 'running', duration_ms: 0, since_prev_ms: 0, meta: {}, });
  const workflowId = String(params.workflow?.metadata?.id || '').trim();
  if (!workflowId) {
    throw new Error('workflow.metadata.id is required for workflow execution.');
  }
  const workflowReference = await loadWorkflowReference({
    currentUserId: params.currentUserId,
    organizationId: params.organizationId || null,
    supabase: params.supabase,
    workflowId,
  });
  const preparedWorkflow = Executor.normalizeWorkflowQueueDefinition(params.workflow as any);
  const runId = String(params.requestId || '').trim() || createRunId('run');
  const workflowVersionId = await runWithStore(() => WorkflowVersionEntity.resolveCurrentId({ workflowId: workflowReference.workflowId })).catch(
    () => null,
  );
  const queuedAt = new Date().toISOString();
  const effectiveRoot = await isCurrentUserRootUser(params.supabase).catch(() => false);
  const organization = workflowReference.organizationId ? (OrganisationEntity.load(workflowReference.organizationId) as OrganisationEntity) : null;
  const sharedDrive = organization
    ? await organization.sharedSpace.workflowDrive({
        request: params.request,
        supabase: params.supabase,
        userId: params.currentUserId,
        effectiveRoot,
      })
    : null;
  const settings = { ...params.settings, sharedDrive };
  const tracker = await runWithStore(() =>
    WorkflowExecutionEntity.createTracker({
      workflowId: workflowReference.workflowId,
      workflowVersionId,
      workflowSource: workflowReference.scope === 'organization' ? 'organization' : workflowReference.scope === 'user' ? 'user' : 'default',
      triggerType: 'designer',
      runId,
      userId: params.currentUserId,
      scopeType: null,
      scopeId: null,
      status: 'queued',
      requestPayload: { request_id: params.requestId || null, settings },
      responsePayload: Executor.createWorkflowQueueTimingPayload(queuedAt) as Record<string, unknown>,
      workflowSnapshot: params.workflow,
      startedAt: queuedAt,
      inputPayload: {
        run_id: runId,
        trigger_type: 'designer',
        user_id: params.currentUserId,
        request_payload: { request_id: params.requestId || null, settings },
        response_payload: Executor.createWorkflowQueueTimingPayload(queuedAt),
        workflow_snapshot: params.workflow,
      } as Record<string, unknown>,
    }),
  );
  const trackerId = String(tracker.id || '');
  const queueRequest: WorkflowQueueRequest = {
    executionId: trackerId,
    runId,
    queueKey: params.currentUserId,
    userId: params.currentUserId,
    broadcastId: params.broadcastId,
    broadcastChannelName: params.broadcastChannelName,
    triggerType: 'designer',
    workflowReference,
    workflowVersionId,
    workflow: preparedWorkflow as any,
    settings,
    requestContext: Executor.createWorkflowQueueRequestContextSnapshot({ mode: 'user', request: params.request, userId: params.currentUserId }),
    metadata: { requestId: params.requestId || null },
  };
  try {
    await Executor.enqueue(params.currentUserId, { request: queueRequest }, preparedWorkflow as any);
  } catch (error: any) {
    // prettier-ignore
    logger.error({ layer: 'workflow.queue', event: 'workflow.enqueue.designer', phase: 'error', transport: 'workflow_queue', request_id: params.requestId || null, run_id: runId, status: 'failed', duration_ms: Date.now() - startedAt, since_prev_ms: 0, meta: {}, });
    await runWithStore(() =>
      WorkflowExecutionEntity.finalize({
        id: trackerId,
        status: 'failed',
        error: { message: error?.message || 'Failed to enqueue designer workflow execution.' },
        output: Executor.createWorkflowQueueTimingPayload(queuedAt) as unknown as Record<string, unknown>,
        finishedAt: new Date().toISOString(),
      }),
    );
    throw error;
  }
  // prettier-ignore
  logger.info({ layer: 'workflow.queue', event: 'workflow.enqueue.designer', phase: 'end', transport: 'workflow_queue', request_id: params.requestId || null, run_id: runId, status: 'queued', duration_ms: Date.now() - startedAt, since_prev_ms: 0, meta: { execution_id: tracker.id }, });
  return { executionId: trackerId, runId };
};
