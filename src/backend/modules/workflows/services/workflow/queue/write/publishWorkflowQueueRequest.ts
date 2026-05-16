import { Executor } from '@workflow/executor';
import '@connectingmatrix/workflows/services/workflow/runtime/setupWorkflowExecutor';
import type { WorkflowQueueRequest } from '@workflow/executor';

export const getWorkflowQueueRequestProducer = async () => ({
  connect: async () => Executor.start(),
  disconnect: async () => Executor.stop(),
  publish: async (request: WorkflowQueueRequest) => {
    await Executor.enqueue(request.queueKey, { request }, request.workflow as any);
  },
});

export const closeWorkflowQueueRequestProducer = async (): Promise<void> => {
  await Executor.stop();
};

export const enqueueWorkflowExecutionRequest = async (request: WorkflowQueueRequest): Promise<void> => {
  await Executor.enqueue(request.queueKey, { request }, request.workflow as any);
};
