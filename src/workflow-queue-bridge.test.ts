import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflows, type WorkflowQueueStatus } from './index.js';

type RuntimeWorkflows = typeof Workflows & {
  bindExecutorPubSub(executor: unknown, config?: unknown): typeof Workflows;
  queueStatus(workflowId?: string): WorkflowQueueStatus[];
  applyExecutorQueueEvent(event: Record<string, unknown>): WorkflowQueueStatus;
};

test('workflow execution queues through executor pub/sub and consumes real status events', async () => {
  const published: Record<string, unknown>[] = [];
  const Runtime = Workflows as RuntimeWorkflows;
  Runtime.bindExecutorPubSub({
    queueWorkflowForExecution: () => ({ publish: async (request: Record<string, unknown>) => { published.push(request); } }),
    consumeWorkflowExecutionEvents: () => ({ start: async () => {}, stop: async () => {} }),
    getRunning: () => [],
  });
  const wf = Workflows.create({ name: 'Queue workflow', definition: { nodes: [], edges: [] } }, { root: true });
  const execution = await Workflows.execute(wf.id, { hello: 'world' }, { root: true, userId: 'user-1' });
  assert.equal(execution.status, 'queued');
  assert.equal(published.length, 1);
  const req = published[0] as { runId: string; executionId: string; workflowReference: { workflowId: string } };
  Runtime.applyExecutorQueueEvent({ type: 'completed', runId: req.runId, executionId: req.executionId, workflowId: wf.id, message: 'done' });
  assert.equal(Runtime.queueStatus(wf.id)[0].status, 'completed');
});
