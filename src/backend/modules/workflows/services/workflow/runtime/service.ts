import { createRunId } from 'giga-ai-helper/workflow';
import { Executor } from '@workflow/executor';
import { logger, markLifecycle } from '@connectingmatrix/logger/lifecycle-jsonl';
import { queueDesignerWorkflowExecution } from '@connectingmatrix/workflows/services/workflow/queue';
import {
  WorkflowExecuteMutationInput,
  WorkflowExecuteMutationPayload,
  WorkflowExecutionModeEnum,
  WorkflowExecutionRequestContext,
} from '@connectingmatrix/workflows/services/workflow/contracts/types';
import './setupWorkflowExecutor';
import { assertExecutableWorkflow } from './validation';

export const executeWorkflowMutation = async (params: {
  input: WorkflowExecuteMutationInput;
  requestContext: WorkflowExecutionRequestContext;
}): Promise<WorkflowExecuteMutationPayload> => {
  const lifecycleState = (params.requestContext.request as any)?.lifecycleState;
  const requestId = String(params.input.request_id || '').trim() || null;
  if (lifecycleState) {
    markLifecycle(lifecycleState, {
      layer: 'workflow.service',
      event: 'workflow.execute.mutation',
      phase: 'start',
      transport: 'workflow_queue',
      runId: requestId,
    });
  }
  try {
    assertExecutableWorkflow(params.input.workflow);
    const broadcastId = String(params.input.broadcast_id || '').trim();
    const broadcastChannelName = String(params.input.broadcast_channel_name || '').trim();
    const workflowMetadata = (params.input.workflow?.metadata || {}) as Record<string, any>;
    const workflowScope = (workflowMetadata.scope || {}) as Record<string, any>;
    if (!broadcastId || !broadcastChannelName) {
      throw new Error('broadcast_id and broadcast_channel_name are required for workflow execution.');
    }

    if (params.input.mode !== WorkflowExecutionModeEnum.Async) {
      const runId = String(params.input.request_id || '').trim() || createRunId('run');
      const result = await Executor.execute(
        params.requestContext.userId,
        {
          requestContext: params.requestContext,
          runId,
          settings: params.input.settings,
        },
        params.input.workflow as any,
      );
      const payload = {
        accepted: true,
        execution_id: null,
        run_id: runId,
        stopped: result.stopped,
        workflow: result.workflow as any,
        logs: result.events as any,
      };
      if (lifecycleState) {
        markLifecycle(lifecycleState, {
          layer: 'workflow.service',
          event: 'workflow.execute.mutation',
          phase: 'end',
          transport: 'workflow_queue',
          status: 'passed',
          runId,
        });
      }
      return payload;
    }

    const queuedExecution = await queueDesignerWorkflowExecution({
      supabase: params.requestContext.supabase,
      currentUserId: params.requestContext.userId,
      organizationId: String(workflowScope.organizationId || workflowMetadata.organizationId || '').trim() || null,
      request: params.requestContext.request,
      workflow: params.input.workflow,
      settings: params.input.settings,
      requestId: params.input.request_id || null,
      broadcastId,
      broadcastChannelName,
    });

    const payload = {
      accepted: true,
      execution_id: queuedExecution.executionId,
      run_id: queuedExecution.runId,
      stopped: false,
      workflow: params.input.workflow,
      logs: [],
    };
    if (lifecycleState) {
      markLifecycle(lifecycleState, {
        layer: 'workflow.service',
        event: 'workflow.execute.mutation',
        phase: 'end',
        transport: 'workflow_queue',
        status: 'passed',
        runId: queuedExecution.runId,
      });
    }
    // prettier-ignore
    logger.info({ layer: 'workflow.service', event: 'workflow.enqueue', phase: 'end', transport: 'workflow_queue', request_id: requestId, run_id: queuedExecution.runId, status: 'queued', duration_ms: 0, since_prev_ms: 0, meta: {}, });
    return payload;
  } catch (error) {
    if (lifecycleState) {
      markLifecycle(lifecycleState, {
        layer: 'workflow.service',
        event: 'workflow.execute.mutation',
        phase: 'error',
        transport: 'workflow_queue',
        status: 'failed',
        runId: requestId,
      });
    }
    throw error;
  }
};
