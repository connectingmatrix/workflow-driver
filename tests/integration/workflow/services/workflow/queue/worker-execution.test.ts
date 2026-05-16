import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueuedWorkflowRequestExecutor } from '../../../../src/services/workflow/queue/write/executeQueuedWorkflowRequest';
import type { WorkflowQueueEvent, WorkflowQueueRequest } from '@workflow/executor';

const createRequest = (): WorkflowQueueRequest => ({
  executionId: 'execution-1',
  runId: 'run-1',
  queueKey: 'user-1',
  userId: 'user-1',
  broadcastId: 'user-1',
  broadcastChannelName: 'workflow-socket',
  triggerType: 'webhook',
  workflowReference: {
    workflowId: 'workflow-1',
    scope: 'user',
    ownerUserId: 'user-1',
  },
  workflowVersionId: null,
  workflow: {
    metadata: { id: 'workflow-1', name: 'Workflow 1' },
    nodes: [],
    connections: [],
  },
  settings: {
    graphqlUrl: 'http://localhost:3001/api/v2/graphql',
    authMode: 'auto-from-current-session',
  },
  requestContext: {
    mode: 'admin',
    userId: 'user-1',
    headers: {},
  },
  metadata: null,
});

const createChatRequest = (): WorkflowQueueRequest => ({
  ...createRequest(),
  triggerType: 'chat',
  workflow: {
    metadata: { id: 'workflow-1', name: 'Workflow 1' },
    nodes: [
      {
        id: 'respond-end-1',
        gigaId: 'respond-end-1',
        modelId: 'respond-end',
        type: 'workflowStep',
        name: 'Respond End',
        description: '',
        kind: 'output',
        status: 'stopped',
        position: { x: 0, y: 0 },
        runtime: {},
        ports: { in: {}, out: {} },
      },
    ],
    connections: [],
  },
});

const { signal } = new AbortController();

test('queued worker execution publishes started, log, and completed events in order', async () => {
  const publishedEvents: WorkflowQueueEvent[] = [];
  const executeRequest = createQueuedWorkflowRequestExecutor({
    executeWorkflowImpl: async (_workflow, options) => {
      options.logger.push({
        level: 'info',
        event: 'workflow.local.log',
        workflowId: 'workflow-1',
        runId: 'run-1',
        message: 'running',
      });
      return {
        workflow: {
          metadata: { id: 'workflow-1', name: 'Workflow 1' },
          nodes: [],
          connections: [],
        },
        stopped: false,
        runId: 'run-1',
      } as any;
    },
  });

  await executeRequest(createRequest(), {
    publishEvent: async (event) => {
      publishedEvents.push(event);
    },
    signal,
  });

  assert.deepEqual(
    publishedEvents.map((event) => event.type),
    ['started', 'log', 'completed'],
  );
  assert.equal(publishedEvents[1]?.type, 'log');
  assert.equal((publishedEvents[1] as any)?.log?.message, 'running');
  assert.equal((publishedEvents[0] as any)?.broadcastId, 'user-1');
  assert.equal((publishedEvents[0] as any)?.broadcastChannelName, 'workflow-socket');
  assert.equal((publishedEvents[2] as any)?.result?.runId, 'run-1');
  assert.equal((publishedEvents[2] as any)?.result?.workflow?.metadata?.id, 'workflow-1');
  assert.equal(Array.isArray((publishedEvents[2] as any)?.result?.logs), true);
  assert.equal((publishedEvents[2] as any)?.result?.logs?.[0]?.message, 'running');
  assert.deepEqual((publishedEvents[2] as any)?.result?.responsePayload, {
    route_type: 'published',
    output: undefined,
  });
});

test('queued worker execution publishes failed event with normalized logs when execution throws', async () => {
  const publishedEvents: WorkflowQueueEvent[] = [];
  const executeRequest = createQueuedWorkflowRequestExecutor({
    executeWorkflowImpl: async (_workflow, options) => {
      options.logger.push({
        level: 'info',
        event: 'workflow.local.log',
        workflowId: 'workflow-1',
        runId: 'run-1',
        message: 'before-failure',
      });
      throw new Error('boom');
    },
  });

  await executeRequest(createRequest(), {
    publishEvent: async (event) => {
      publishedEvents.push(event);
    },
    signal,
  });

  assert.deepEqual(
    publishedEvents.map((event) => event.type),
    ['started', 'log', 'failed'],
  );
  assert.equal((publishedEvents[2] as any)?.errorMessage, 'boom');
  assert.equal(Array.isArray((publishedEvents[2] as any)?.logs), true);
  assert.equal((publishedEvents[2] as any)?.logs?.[0]?.message, 'before-failure');
});

test('queued worker execution publishes compact chat completion payloads', async () => {
  const publishedEvents: WorkflowQueueEvent[] = [];
  const executeRequest = createQueuedWorkflowRequestExecutor({
    executeWorkflowImpl: async () =>
      ({
        workflow: {
          metadata: { id: 'workflow-1', name: 'Workflow 1' },
          nodes: [
            {
              id: 'respond-end-1',
              modelId: 'respond-end',
              ports: { out: { output: { markdown: 'Hello Rich', agent: { ok: true }, sources: [{ id: 1 }] } } },
            },
          ],
          connections: [],
        },
        stopped: false,
        runId: 'run-1',
      } as any),
  });

  await executeRequest(createChatRequest(), {
    publishEvent: async (event) => {
      publishedEvents.push(event);
    },
    signal,
  });

  assert.equal((publishedEvents[1] as any)?.type, 'completed');
  assert.equal((publishedEvents[1] as any)?.result?.responsePayload?.text, 'Hello Rich');
  assert.deepEqual((publishedEvents[1] as any)?.result?.responsePayload?.source_refs, [{ id: 1 }]);
  assert.equal(Array.isArray((publishedEvents[1] as any)?.result?.workflow?.nodes), true);
  assert.equal((publishedEvents[1] as any)?.result?.workflow?.nodes?.[0]?.modelId, 'respond-end');
});

test('queued worker execution publishes node.delta snapshots with runtime data and the persisted workflow id', async () => {
  const publishedEvents: WorkflowQueueEvent[] = [];
  const executeRequest = createQueuedWorkflowRequestExecutor({
    executeWorkflowImpl: async (_workflow, options) => {
      options.onNodeFinish?.({
        id: 'node-1',
        gigaId: 'node-1',
        modelId: 'code',
        type: 'workflowStep',
        name: 'Code',
        description: '',
        kind: 'process',
        status: 'passed',
        position: { x: 0, y: 0 },
        runtime: { output: 'done' },
        ports: { in: {}, out: { output: { output: 'done' } } },
      } as any);
      return {
        workflow: {
          metadata: { id: 'snapshot-workflow-id', name: 'Workflow 1' },
          nodes: [],
          connections: [],
        },
        stopped: false,
        runId: 'run-1',
      } as any;
    },
  });

  await executeRequest(createRequest(), {
    publishEvent: async (event) => {
      publishedEvents.push(event);
    },
    signal,
  });

  assert.deepEqual(
    publishedEvents.map((event) => event.type),
    ['started', 'log', 'completed'],
  );
  assert.equal((publishedEvents[1] as any)?.log?.event, 'node.delta');
  assert.equal((publishedEvents[1] as any)?.log?.workflowId, 'workflow-1');
  assert.equal((publishedEvents[1] as any)?.log?.data?.node?.id, 'node-1');
  assert.equal((publishedEvents[1] as any)?.log?.data?.node?.runtime?.output, 'done');
  assert.equal((publishedEvents[1] as any)?.log?.data?.node?.ports?.out?.output?.output, 'done');
});

test('queued worker execution publishes failed when logs contain node.failed', async () => {
  const publishedEvents: WorkflowQueueEvent[] = [];
  const executeRequest = createQueuedWorkflowRequestExecutor({
    executeWorkflowImpl: async (_workflow, options) => {
      options.logger.push({
        level: 'error',
        event: 'node.failed',
        workflowId: 'workflow-1',
        runId: 'run-1',
        nodeId: 'node-1',
        message: 'Current Chat failed.',
      });
      return {
        workflow: {
          metadata: { id: 'snapshot-workflow-id', name: 'Workflow 1' },
          nodes: [{ id: 'node-1', name: 'Current Chat', status: 'failed' }],
          connections: [],
        },
        stopped: false,
        runId: 'run-1',
      } as any;
    },
  });

  await executeRequest(createChatRequest(), {
    publishEvent: async (event) => {
      publishedEvents.push(event);
    },
    signal,
  });

  assert.deepEqual(
    publishedEvents.map((event) => event.type),
    ['started', 'log', 'failed'],
  );
  assert.equal((publishedEvents[2] as any)?.errorMessage, 'Current Chat failed.');
  assert.equal((publishedEvents[2] as any)?.workflow?.nodes?.[0]?.status, 'failed');
  assert.equal(Object.prototype.hasOwnProperty.call((publishedEvents[2] as any) || {}, 'responsePayload'), true);
});
