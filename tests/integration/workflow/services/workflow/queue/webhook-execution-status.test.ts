import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkflowWebhookExecutionStatusResponse } from '../../../../src/services/workflow/queue/read/readWorkflowWebhookExecutionStatus';

test('buildWorkflowWebhookExecutionStatusResponse returns queued payload with zero execution time', () => {
  const response = buildWorkflowWebhookExecutionStatusResponse({
    status: 'queued',
    created_at: '2026-03-28T00:00:00.000Z',
    response_payload: {
      __workflowQueue: {
        queued_at: '2026-03-28T00:00:00.000Z',
      },
    },
  });

  assert.equal(response?.status, 'queued');
  assert.equal(response?.executionTime, 0);
});

test('buildWorkflowWebhookExecutionStatusResponse returns completed output', () => {
  const response = buildWorkflowWebhookExecutionStatusResponse({
    status: 'completed',
    created_at: '2026-03-28T00:00:00.000Z',
    completed_at: '2026-03-28T00:00:12.000Z',
    response_payload: {
      output: { ok: true },
      __workflowQueue: {
        queued_at: '2026-03-28T00:00:01.000Z',
        execution_started_at: '2026-03-28T00:00:04.000Z',
      },
    },
  });

  assert.deepEqual(response, {
    status: 'completed',
    timeElapsed: 11,
    executionTime: 8,
    output: { ok: true },
  });
});

test('buildWorkflowWebhookExecutionStatusResponse returns failed payload with error', () => {
  const response = buildWorkflowWebhookExecutionStatusResponse({
    status: 'failed',
    created_at: '2026-03-28T00:00:00.000Z',
    completed_at: '2026-03-28T00:00:09.000Z',
    error_message: 'boom',
    response_payload: {
      __workflowQueue: {
        queued_at: '2026-03-28T00:00:01.000Z',
        execution_started_at: '2026-03-28T00:00:03.000Z',
      },
    },
  });

  assert.deepEqual(response, {
    status: 'failed',
    timeElapsed: 8,
    executionTime: 6,
    error: 'boom',
  });
});
