import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflows } from './index.js';
test('workflow execution queues through executor pub/sub and consumes real status events', async () => {
    const published = [];
    const Runtime = Workflows;
    Runtime.bindExecutorPubSub({
        queueWorkflowForExecution: () => ({ publish: async (request) => { published.push(request); } }),
        consumeWorkflowExecutionEvents: () => ({ start: async () => { }, stop: async () => { } }),
        getRunning: () => [],
    });
    const wf = Workflows.create({ name: 'Queue workflow', definition: { nodes: [], edges: [] } }, { root: true });
    const execution = await Workflows.execute(wf.id, { hello: 'world' }, { root: true, userId: 'user-1' });
    assert.equal(execution.status, 'queued');
    assert.equal(published.length, 1);
    const req = published[0];
    Runtime.applyExecutorQueueEvent({ type: 'completed', runId: req.runId, executionId: req.executionId, workflowId: wf.id, message: 'done' });
    assert.equal(Runtime.queueStatus(wf.id)[0].status, 'completed');
});
