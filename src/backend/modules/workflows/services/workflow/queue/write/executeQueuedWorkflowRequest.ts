import { Executor } from '@workflow/executor';
import { executeWorkflow } from '@connectingmatrix/nodes/services/workflow/executor';
import { createWorkflowReferenceHostContext } from '@connectingmatrix/workflows/services/workflow/contracts/execution-reference';
import { extractWorkflowTerminalPayload } from '@connectingmatrix/workflows/services/workflow/runtime/webhook';
import { restoreWorkflowExecutionRequestContext } from '../runtime/restoreWorkflowRequestContext';
import type { WorkflowQueueEvent, WorkflowQueueRequest } from '@workflow/executor';

export const createQueuedWorkflowRequestExecutor = (overrides: Record<string, unknown> = {}) =>
  Executor.createQueuedWorkflowRequestExecutor({
    createHostContext: createWorkflowReferenceHostContext,
    executeWorkflowImpl: executeWorkflow as any,
    extractTerminalPayload: extractWorkflowTerminalPayload as any,
    restoreRequestContext: restoreWorkflowExecutionRequestContext as any,
    ...overrides,
  });

const queuedWorkflowRequestExecutor = createQueuedWorkflowRequestExecutor();

const queueExecutionErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.stack || error.message || error.name : 'Queued workflow execution failed before startup.';

export const executeQueuedWorkflowRequest = async (
  request: WorkflowQueueRequest,
  helpers: { publishEvent: (event: WorkflowQueueEvent) => Promise<void>; signal: AbortSignal },
): Promise<void> => {
  try {
    await queuedWorkflowRequestExecutor(request, helpers);
  } catch (error) {
    await helpers.publishEvent({
      type: 'failed',
      timestamp: new Date().toISOString(),
      executionId: request.executionId,
      runId: request.runId,
      workflowId: request.workflowReference.workflowId,
      userId: request.userId,
      broadcastId: request.broadcastId,
      broadcastChannelName: request.broadcastChannelName,
      triggerType: request.triggerType,
      workflowReference: request.workflowReference,
      errorMessage: queueExecutionErrorMessage(error),
      workflow: request.workflow,
    });
  }
};
