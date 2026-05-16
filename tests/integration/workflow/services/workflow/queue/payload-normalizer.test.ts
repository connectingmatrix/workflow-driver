import assert from 'node:assert/strict';
import test from 'node:test';
import { Executor } from '@workflow/executor';

test('normalizeWorkflowQueueDefinition strips compile-time artifacts from queued workflow payloads', () => {
  const workflow = Executor.normalizeWorkflowQueueDefinition({
    metadata: { id: 'wf_1' },
    nodes: [{ id: 'start-1', modelId: 'start', kind: 'process', name: 'Start', properties: {}, runtime: {}, ports: {} }],
    connections: [],
    nodeModels: { start: { documentation: { summary: 'Start node.' } } },
    NODE_EXECUTORS: { start: 'encoded-worker' },
    NODE_EXECUTOR_SIGNATURES: { start: 'sig' },
  } as any) as any;

  assert.deepEqual(workflow.nodeModels, { start: { documentation: { summary: 'Start node.' } } });
  assert.equal(workflow.NODE_EXECUTORS, undefined);
  assert.equal(workflow.NODE_EXECUTOR_SIGNATURES, undefined);
  assert.equal(workflow.nodes[0].kind, 'process');
});
