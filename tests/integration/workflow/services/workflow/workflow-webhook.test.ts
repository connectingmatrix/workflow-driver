import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSupabaseStub } from '@giga/shared/test/supabase-stub';
import {
  applyWebhookRequestToWorkflow,
  extractWorkflowTerminalPayload,
  loadPersistedWorkflowRecord,
  requiresWorkflowWebhookSecret,
  validateWorkflowWebhookInvocation,
  WorkflowWebhookRequestPayload,
} from '@connectingmatrix/workflow-driver/services/workflow/runtime/webhook';
import { WorkflowDefinition } from '@connectingmatrix/workflow-driver/services/workflow/contracts/types';

function buildWorkflow(): WorkflowDefinition {
  return {
    metadata: {
      id: 'workflow-1',
      name: 'Workflow 1',
    },
    nodes: [
      {
        id: 'node-start',
        gigaId: 'StartNode',
        modelId: 'start',
        type: 'workflowStep',
        name: 'Start',
        description: 'Entry',
        kind: 'process',
        status: 'stopped',
        position: { x: 0, y: 0 },
        runtime: {
          triggerSource: 'webhook',
          webhookMethod: 'POST',
        },
        ports: {
          in: {},
          out: { output: {} },
        },
      },
      {
        id: 'node-end',
        gigaId: 'RespondEndNode',
        modelId: 'respond-end',
        type: 'workflowStep',
        name: 'Respond',
        description: 'End',
        kind: 'output',
        status: 'stopped',
        position: { x: 200, y: 0 },
        runtime: {},
        ports: {
          in: {},
          out: {
            output: {
              input: {
                ok: true,
              },
            },
          },
        },
      },
    ],
    connections: [],
  } as WorkflowDefinition;
}

const webhookRequest: WorkflowWebhookRequestPayload = {
  method: 'POST',
  headers: {
    'x-test': '1',
  },
  query: {
    hello: 'world',
  },
  body: {
    ok: true,
  },
  path: '/api/v2/workflows/workflow-1/webhook/test',
  routeType: 'test',
};

test('validateWorkflowWebhookInvocation rejects the wrong HTTP method', () => {
  const workflow = buildWorkflow();
  const result = validateWorkflowWebhookInvocation(workflow, 'GET');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 405);
  }
});

test('applyWebhookRequestToWorkflow injects request payload into the start node', () => {
  const workflow = buildWorkflow();
  const nextWorkflow = applyWebhookRequestToWorkflow(workflow, webhookRequest);
  const startNode = nextWorkflow.nodes.find((node) => node.modelId === 'start');
  assert.deepEqual(nextWorkflow.input, webhookRequest);
  assert.deepEqual(startNode?.ports?.in?.input, webhookRequest);
});

test('requiresWorkflowWebhookSecret keeps designer test URLs session-gated instead of secret-gated', () => {
  assert.equal(requiresWorkflowWebhookSecret('test'), false);
  assert.equal(requiresWorkflowWebhookSecret('published'), true);
});

test('extractWorkflowTerminalPayload unwraps respond-end input payloads', () => {
  const workflow = buildWorkflow();
  assert.deepEqual(extractWorkflowTerminalPayload(workflow), { ok: true });
});

test('extractWorkflowTerminalPayload preserves structured start payloads', () => {
  const workflow = buildWorkflow();
  const endNode = workflow.nodes.find((node) => node.modelId === 'respond-end');

  if (!endNode) {
    throw new Error('Respond / End node is required for this test.');
  }

  endNode.ports = {
    ...(endNode.ports || { in: {}, out: {} }),
    out: {
      ...(endNode.ports?.out || {}),
      output: {
        input: {
          input: {
            body: {
              ok: true,
            },
          },
        },
        request: {
          routeType: 'published',
          body: {
            ok: true,
          },
        },
      },
    },
  };

  assert.deepEqual(extractWorkflowTerminalPayload(workflow), {
    input: {
      input: {
        body: {
          ok: true,
        },
      },
    },
    request: {
      routeType: 'published',
      body: {
        ok: true,
      },
    },
  });
});

test('extractWorkflowTerminalPayload flattens nested start envelopes when terminal payload keeps sibling node outputs', () => {
  const workflow = buildWorkflow();
  const endNode = workflow.nodes.find((node) => node.modelId === 'respond-end');

  if (!endNode) {
    throw new Error('Respond / End node is required for this test.');
  }

  endNode.ports = {
    ...(endNode.ports || { in: {}, out: {} }),
    out: {
      ...(endNode.ports?.out || {}),
      output: {
        'start-1': {
          request: {
            routeType: 'published',
            body: {
              ok: true,
            },
          },
          input: {
            input: {
              body: {
                ok: true,
              },
            },
          },
        },
        wait: {
          applied: {
            elapsedMilliseconds: 1000,
          },
        },
      },
    },
  };

  assert.deepEqual(extractWorkflowTerminalPayload(workflow), {
    'start-1': {
      request: {
        routeType: 'published',
        body: {
          ok: true,
        },
      },
      input: {
        input: {
          body: {
            ok: true,
          },
        },
      },
    },
    wait: {
      applied: {
        elapsedMilliseconds: 1000,
      },
    },
    request: {
      routeType: 'published',
      body: {
        ok: true,
      },
    },
    input: {
      input: {
        body: {
          ok: true,
        },
      },
    },
  });
});

test('loadPersistedWorkflowRecord returns null for organization workflows belonging to inactive organizations', async () => {
  const workflow = buildWorkflow();
  const supabase = createSupabaseStub({
    ai_workflows: [
      {
        id: 'workflow-1',
        user_id: null,
        organization_id: 'org-1',
        is_global: false,
        name: 'Workflow 1',
        description: null,
        workflow,
        published_workflow: null,
        status: 'draft',
        webhook_secret: 'secret',
        is_active: true,
      },
    ],
    organizations: [{ id: 'org-1', is_active: false }],
  });

  const record = await loadPersistedWorkflowRecord(supabase as any, 'workflow-1');

  assert.equal(record, null);
});

test('loadPersistedWorkflowRecord normalizes workflow snapshot identity to the workflow row id', async () => {
  const workflow = buildWorkflow();
  workflow.metadata.id = 'legacy-snapshot-id';
  delete (workflow.metadata as Record<string, unknown>).workflowRecordId;
  const publishedWorkflow = structuredClone(workflow);
  publishedWorkflow.metadata.id = 'legacy-published-id';

  const supabase = createSupabaseStub({
    ai_workflows: [
      {
        id: 'workflow-1',
        user_id: 'user-1',
        organization_id: null,
        is_global: false,
        name: 'Workflow 1',
        description: 'Stored workflow',
        workflow,
        published_workflow: publishedWorkflow,
        status: 'published',
        webhook_secret: 'secret',
        is_active: true,
      },
    ],
  });

  const record = await loadPersistedWorkflowRecord(supabase as any, 'workflow-1');

  assert.equal(record?.workflow.metadata.id, 'workflow-1');
  assert.equal((record?.workflow.metadata as Record<string, unknown>).workflowRecordId, 'workflow-1');
  assert.equal(record?.publishedWorkflow?.metadata.id, 'workflow-1');
});
