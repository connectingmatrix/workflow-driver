import util from 'node:util';
import { Executor } from '@workflow/executor';
import { SupabaseClientAdmin } from '@giga/general/decorators/integration/supabase-admin-client';
import { applyWorkflowQueueEvent } from './applyWorkflowQueueEvent';
import { executeQueuedWorkflowRequest } from './executeQueuedWorkflowRequest';

export const runBackendWorkflowExecutionQueue = () =>
  Executor.runWorkflowExecutionQueue({
    runExecutionRequest: executeQueuedWorkflowRequest,
  });

export const consumeBackendWorkflowExecutionEvents = () =>
  Executor.consumeWorkflowExecutionEvents({
    applyExecutionEvent: (event) => applyWorkflowQueueEvent(SupabaseClientAdmin(), event),
    handleExecutionEventError: async ({ error, event }) => {
      const message = error instanceof Error ? error.stack || error.message : util.inspect(error, { depth: 10, breakLength: 120 });
      console.error('[workflow-queue-result-consumer] failed to apply event', {
        eventType: event.type,
        executionId: event.executionId,
        runId: event.runId,
        workflowId: event.workflowId,
        message,
      });
    },
  });

const services = Executor.startWorkflowExecutionPubsub({
  createRequestRunner: runBackendWorkflowExecutionQueue,
  createEventConsumer: consumeBackendWorkflowExecutionEvents,
});

export const startWorkflowQueueServices = () => services.start();
export const stopWorkflowQueueServices = () => services.stop();
