import assert from 'node:assert/strict';
import test from 'node:test';
import { executeWorkflowMutation } from '@connectingmatrix/workflow-driver/services/workflow/runtime/service';
import { workflowValidationErrors } from '@connectingmatrix/workflow-driver/services/workflow/runtime/validation';
import { WorkflowExecutionModeEnum, WorkflowNodeStatusEnum } from '@connectingmatrix/workflow-driver/services/workflow/contracts/types';
import type { WorkflowDefinition } from '@giga/shared/types/contracts/workflow.types';

const emptyWorkflow: WorkflowDefinition = {
  metadata: { id: 'workflow-empty', name: 'Workflow' },
  nodes: [],
  connections: [],
};

const disconnectedWorkflow: WorkflowDefinition = {
  metadata: { id: 'workflow-disconnected', name: 'Workflow' },
  nodes: [
    {
      id: 'start-1',
      gigaId: 'start-1',
      modelId: 'start',
      type: 'workflowStep',
      name: 'Start',
      description: '',
      kind: 'process',
      status: WorkflowNodeStatusEnum.Stopped,
      position: { x: 0, y: 0 },
      runtime: {},
      ports: { in: {}, out: {} },
    },
    {
      id: 'end-1',
      gigaId: 'end-1',
      modelId: 'respond-end',
      type: 'workflowStep',
      name: 'End',
      description: '',
      kind: 'output',
      status: WorkflowNodeStatusEnum.Stopped,
      position: { x: 200, y: 0 },
      runtime: {},
      ports: { in: {}, out: {} },
    },
  ],
  connections: [],
};

test('workflow execution rejects empty workflows before accepting a run', async () => {
  await assert.rejects(
    executeWorkflowMutation({
      input: {
        workflow: emptyWorkflow,
        settings: { graphqlUrl: '', authMode: 'none', manualHeaders: {} },
        mode: WorkflowExecutionModeEnum.Wait,
        request_id: 'run-empty',
      },
      requestContext: { request: { headers: {} } as any, supabase: {} as any, userId: 'user-1' },
    }),
    /Workflow must contain executable nodes/,
  );
});

test('workflow validation requires start to reach respond end', () => {
  const errors = workflowValidationErrors(disconnectedWorkflow);
  assert.equal(errors.includes('Workflow must contain node connections.'), true);
  assert.equal(errors.includes('At least one Respond End node must be reachable from Start.'), true);
});
