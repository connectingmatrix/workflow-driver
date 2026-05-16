import assert from 'node:assert/strict';
import test from 'node:test';
import { clearChatSocketServer, setChatSocketServer } from '@connectingmatrix/sockets/chat/telemetry/event-bus';
import { registerChatWorkflowDebugExecution } from '@connectingmatrix/chat/services/chat/workflow/integration/chat-debug-bridge';
import { createSupabaseStub } from '@giga/shared/test/supabase-stub';
import { createWorkflowQueueEventApplier } from '../../../../src/services/workflow/queue/write/applyWorkflowQueueEvent';

test('started queue event transitions execution to running and preserves queue timing metadata', async () => {
  const transitions: any[] = [];
  const applyEvent = createWorkflowQueueEventApplier({
    appendLog: async () => undefined,
    emitLogEvent: () => undefined,
    finalizeRecord: async () => undefined,
    resolveCompletion: () => undefined,
    transitionRecord: async (params) => {
      transitions.push(params);
    },
  });

  const supabase = createSupabaseStub({
    ai_workflow_executions: [
      {
        id: 'execution-1',
        response_payload: {
          __workflowQueue: {
            queued_at: '2026-03-28T00:00:00.000Z',
          },
        },
      },
    ],
  });

  await applyEvent(supabase, {
    type: 'started',
    timestamp: '2026-03-28T00:00:05.000Z',
    executionId: 'execution-1',
    runId: 'run-1',
    workflowId: 'workflow-1',
    userId: 'user-1',
    broadcastId: 'user-1',
    broadcastChannelName: 'workflow-socket',
    triggerType: 'webhook',
    workflowReference: {
      workflowId: 'workflow-1',
      scope: 'user',
      ownerUserId: 'user-1',
    },
  });

  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].status, 'running');
  assert.deepEqual(transitions[0].expectedStatuses, ['queued', 'running']);
  assert.equal(transitions[0].broadcastId, 'user-1');
  assert.equal(transitions[0].broadcastChannelName, 'workflow-socket');
  assert.equal(transitions[0].extraFields.response_payload.__workflowQueue.queued_at, '2026-03-28T00:00:00.000Z');
  assert.equal(transitions[0].extraFields.response_payload.__workflowQueue.execution_started_at, '2026-03-28T00:00:05.000Z');
});

test('log queue event emits workflow log event', async () => {
  const logEvents: any[] = [];
  const applyEvent = createWorkflowQueueEventApplier({
    appendLog: async () => undefined,
    emitLogEvent: (payload) => {
      logEvents.push(payload);
    },
    finalizeRecord: async () => undefined,
    resolveCompletion: () => undefined,
    transitionRecord: async () => undefined,
  });

  const supabase = createSupabaseStub({});
  await applyEvent(supabase as any, {
    type: 'log',
    timestamp: '2026-03-28T00:00:05.000Z',
    executionId: 'execution-1',
    runId: 'run-1',
    workflowId: 'workflow-1',
    userId: 'user-1',
    broadcastId: 'user-1',
    broadcastChannelName: 'workflow-socket',
    triggerType: 'chat',
    workflowReference: {
      workflowId: 'workflow-1',
      scope: 'user',
      ownerUserId: 'user-1',
    },
    log: {
      timestamp: '2026-03-28T00:00:05.000Z',
      runId: 'run-1',
      workflowId: 'workflow-1',
      level: 'info',
      message: 'started',
    } as any,
  });

  assert.equal(logEvents.length, 1);
  assert.equal(logEvents[0].workflowId, 'workflow-1');
  assert.equal(logEvents[0].broadcastId, 'user-1');
  assert.equal(logEvents[0].broadcastChannelName, 'workflow-socket');
});

test('log queue event persists the log before emitting realtime updates', async () => {
  const calls: string[] = [];
  const applyEvent = createWorkflowQueueEventApplier({
    appendLog: async () => {
      calls.push('append');
    },
    emitLogEvent: () => {
      calls.push('emit');
    },
    finalizeRecord: async () => undefined,
    resolveCompletion: () => undefined,
    transitionRecord: async () => undefined,
  });

  const supabase = createSupabaseStub({});
  await applyEvent(supabase as any, {
    type: 'log',
    timestamp: '2026-03-28T00:00:05.000Z',
    executionId: 'execution-1',
    runId: 'run-1',
    workflowId: 'workflow-1',
    userId: 'user-1',
    broadcastId: 'user-1',
    broadcastChannelName: 'workflow-socket',
    triggerType: 'chat',
    workflowReference: {
      workflowId: 'workflow-1',
      scope: 'user',
      ownerUserId: 'user-1',
    },
    log: {
      timestamp: '2026-03-28T00:00:05.000Z',
      runId: 'run-1',
      workflowId: 'workflow-1',
      level: 'info',
      message: 'started',
    } as any,
  });

  assert.deepEqual(calls, ['append', 'emit']);
});

test('log queue event forwards workflow node.delta details into chat debug', async () => {
  const listenerEvents: any[] = [];
  const roomEvents: any[] = [];
  setChatSocketServer({
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        roomEvents.push({ room, event, payload });
      },
    }),
  } as any);
  const release = registerChatWorkflowDebugExecution({
    chatId: 'chat-1',
    emit: (event) => {
      listenerEvents.push(event);
    },
    executionId: 'execution-1',
    requestId: 'request-1',
    workflowSource: 'organization',
  });
  const applyEvent = createWorkflowQueueEventApplier({
    appendLog: async () => undefined,
    emitLogEvent: () => undefined,
    finalizeRecord: async () => undefined,
    resolveCompletion: () => undefined,
    transitionRecord: async () => undefined,
  });
  const supabase = createSupabaseStub({});

  try {
    await applyEvent(
      supabase as any,
      {
        type: 'log',
        timestamp: '2026-03-28T00:00:05.000Z',
        executionId: 'execution-1',
        runId: 'run-1',
        workflowId: 'workflow-1',
        userId: 'user-1',
        broadcastId: 'user-1',
        broadcastChannelName: 'workflow-socket',
        triggerType: 'chat',
        workflowReference: {
          workflowId: 'workflow-1',
          scope: 'organization',
          organizationId: 'org-1',
        },
        log: {
          timestamp: '2026-03-28T00:00:05.000Z',
          event: 'node.delta',
          workflowId: 'workflow-1',
          runId: 'run-1',
          nodeId: 'node-1',
          data: {
            node: {
              id: 'node-1',
              name: 'Current Chat',
              modelId: 'current-chat',
              status: 'passed',
              input: { message: 'hello' },
              output: { text: 'done' },
              ports: { in: { input: { message: 'hello' } }, out: { output: { text: 'done' } } },
            },
          },
        },
      } as any,
    );
  } finally {
    release();
    clearChatSocketServer();
  }

  assert.equal(listenerEvents.length, 1);
  assert.equal(listenerEvents[0].request_id, 'request-1');
  assert.equal(listenerEvents[0].meta.execution_id, 'execution-1');
  assert.equal(listenerEvents[0].meta.run_id, 'run-1');
  assert.equal(listenerEvents[0].meta.workflow_id, 'workflow-1');
  assert.equal(listenerEvents[0].meta.workflow_source, 'organization');
  assert.deepEqual(listenerEvents[0].meta.current_node_input, { message: 'hello' });
  assert.deepEqual(listenerEvents[0].meta.current_node_output, { text: 'done' });
  assert.equal(roomEvents.length, 1);
  assert.equal(roomEvents[0].room, 'chat:chat-1');
  assert.equal(roomEvents[0].event, 'chat:debug');
});

test('completed chat queue events stay structured when no chat socket server is available', async () => {
  const release = registerChatWorkflowDebugExecution({
    chatId: 'chat-1',
    executionId: 'execution-1',
    requestId: 'request-1',
    workflowSource: 'user',
  });
  const applyEvent = createWorkflowQueueEventApplier({
    appendLog: async () => undefined,
    emitLogEvent: () => undefined,
    finalizeRecord: async () => undefined,
    resolveCompletion: () => undefined,
    transitionRecord: async () => undefined,
  });
  const supabase = createSupabaseStub({});

  try {
    clearChatSocketServer();
    await applyEvent(
      supabase as any,
      {
        type: 'completed',
        timestamp: '2026-03-28T00:00:05.000Z',
        executionId: 'execution-1',
        runId: 'run-1',
        workflowId: 'workflow-1',
        userId: 'user-1',
        broadcastId: 'user-1',
        broadcastChannelName: 'workflow-socket',
        triggerType: 'chat',
        workflowReference: {
          workflowId: 'workflow-1',
          scope: 'user',
          ownerUserId: 'user-1',
        },
        result: {
          runId: 'run-1',
          stopped: false,
          logs: [],
          workflow: { metadata: { id: 'workflow-1', name: 'Workflow 1' }, nodes: [], connections: [] },
          responsePayload: { terminal_payload: { ok: true } },
        },
      } as any,
    );
  } finally {
    release();
    clearChatSocketServer();
  }

  assert.ok(true);
});

test('failed queue event persists failed snapshot payload and logs', async () => {
  const finalized: any[] = [];
  const applyEvent = createWorkflowQueueEventApplier({
    appendLog: async () => undefined,
    emitLogEvent: () => undefined,
    finalizeRecord: async (params) => {
      finalized.push(params);
    },
    resolveCompletion: () => undefined,
    transitionRecord: async () => undefined,
  });
  const supabase = createSupabaseStub({});

  await applyEvent(
    supabase as any,
    {
      type: 'failed',
      timestamp: '2026-03-28T00:00:05.000Z',
      executionId: 'execution-1',
      runId: 'run-1',
      workflowId: 'workflow-1',
      userId: 'user-1',
      broadcastId: 'user-1',
      broadcastChannelName: 'workflow-socket',
      triggerType: 'chat',
      workflowReference: {
        workflowId: 'workflow-1',
        scope: 'user',
        ownerUserId: 'user-1',
      },
      errorMessage: 'Current Chat failed.',
      logs: [{ message: 'Current Chat failed.', event: 'node.failed' }] as any,
      workflow: { metadata: { id: 'workflow-1', name: 'Workflow 1' }, nodes: [{ id: 'node-1', status: 'failed' }], connections: [] },
      responsePayload: { terminal_payload: null },
    } as any,
  );

  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].status, 'failed');
  assert.equal(finalized[0].workflowSnapshot.nodes[0].status, 'failed');
  assert.deepEqual(finalized[0].responsePayload, { terminal_payload: null });
});

test('completed queue event persists completed snapshot payload and logs', async () => {
  const finalized: any[] = [];
  const applyEvent = createWorkflowQueueEventApplier({
    appendLog: async () => undefined,
    emitLogEvent: () => undefined,
    finalizeRecord: async (params) => {
      finalized.push(params);
    },
    resolveCompletion: () => undefined,
    transitionRecord: async () => undefined,
  });
  const supabase = createSupabaseStub({});

  await applyEvent(
    supabase as any,
    {
      type: 'completed',
      timestamp: '2026-03-28T00:00:05.000Z',
      executionId: 'execution-1',
      runId: 'run-1',
      workflowId: 'workflow-1',
      userId: 'user-1',
      broadcastId: 'user-1',
      broadcastChannelName: 'workflow-socket',
      triggerType: 'chat',
      workflowReference: {
        workflowId: 'workflow-1',
        scope: 'user',
        ownerUserId: 'user-1',
      },
      result: {
        runId: 'run-1',
        stopped: false,
        logs: [{ message: 'Current Chat passed.', event: 'node.finished' }],
        workflow: { metadata: { id: 'workflow-1', name: 'Workflow 1' }, nodes: [{ id: 'node-1', status: 'passed' }], connections: [] },
        responsePayload: { terminal_payload: { ok: true } },
      },
    } as any,
  );

  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].status, 'completed');
  assert.equal(finalized[0].workflowSnapshot.nodes[0].status, 'passed');
  assert.deepEqual(finalized[0].logs, [{ message: 'Current Chat passed.', event: 'node.finished' }]);
  assert.deepEqual(finalized[0].responsePayload, { terminal_payload: { ok: true } });
});
