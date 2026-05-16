import assert from 'node:assert/strict';
import test from 'node:test';
import { Executor } from '@workflow/executor';

test('createWorkflowQueueTimingPayload stores queued timestamp metadata', () => {
  const payload = Executor.createWorkflowQueueTimingPayload('2026-03-28T00:00:00.000Z') as any;
  assert.equal(payload.__workflowQueue.queued_at, '2026-03-28T00:00:00.000Z');
  assert.equal(payload.__workflowQueue.execution_started_at, null);
});

test('withWorkflowQueueExecutionStarted preserves queued time and writes execution start', () => {
  const payload = Executor.withWorkflowQueueExecutionStarted(
    Executor.createWorkflowQueueTimingPayload('2026-03-28T00:00:00.000Z'),
    '2026-03-28T00:00:05.000Z',
  ) as any;
  assert.equal(payload.__workflowQueue.queued_at, '2026-03-28T00:00:00.000Z');
  assert.equal(payload.__workflowQueue.execution_started_at, '2026-03-28T00:00:05.000Z');
});

test('mergeWorkflowQueueTimingPayload keeps existing timing metadata when payload content changes', () => {
  const merged = Executor.mergeWorkflowQueueTimingPayload(
    {
      output: { ok: true },
    },
    {
      __workflowQueue: {
        queued_at: '2026-03-28T00:00:00.000Z',
        execution_started_at: '2026-03-28T00:00:05.000Z',
      },
    },
  ) as any;

  assert.deepEqual(merged.output, { ok: true });
  assert.equal(merged.__workflowQueue.queued_at, '2026-03-28T00:00:00.000Z');
  assert.equal(merged.__workflowQueue.execution_started_at, '2026-03-28T00:00:05.000Z');
});

test('resolveWorkflowQueueTiming returns elapsed and execution seconds from metadata', () => {
  const timing = Executor.resolveWorkflowQueueTiming({
    createdAt: '2026-03-28T00:00:00.000Z',
    responsePayload: {
      __workflowQueue: {
        queued_at: '2026-03-28T00:00:01.000Z',
        execution_started_at: '2026-03-28T00:00:04.000Z',
      },
    },
    now: new Date('2026-03-28T00:00:11.000Z'),
  });

  assert.equal(timing.timeElapsed, 10);
  assert.equal(timing.executionTime, 7);
});

test('isWorkflowQueueExecutionStalled respects workflow runtime timeout metadata', () => {
  const stalled = Executor.isWorkflowQueueExecutionStalled({
    createdAt: '2026-03-28T00:00:00.000Z',
    responsePayload: {
      __workflowQueue: {
        queued_at: '2026-03-28T00:00:00.000Z',
        execution_started_at: '2026-03-28T00:00:05.000Z',
      },
    },
    workflowSnapshot: {
      metadata: {
        runtime: {
          settings: {
            maxExecutionSeconds: 30,
          },
        },
      },
    },
    now: new Date('2026-03-28T00:00:51.000Z'),
  });

  assert.equal(stalled, true);
});

test('isWorkflowQueueExecutionStalled keeps recent executions active', () => {
  const stalled = Executor.isWorkflowQueueExecutionStalled({
    createdAt: '2026-03-28T00:00:00.000Z',
    responsePayload: {
      __workflowQueue: {
        queued_at: '2026-03-28T00:00:00.000Z',
        execution_started_at: '2026-03-28T00:00:05.000Z',
      },
    },
    workflowSnapshot: {
      metadata: {
        runtime: {
          settings: {
            maxExecutionSeconds: 60,
          },
        },
      },
    },
    now: new Date('2026-03-28T00:00:50.000Z'),
  });

  assert.equal(stalled, false);
});
