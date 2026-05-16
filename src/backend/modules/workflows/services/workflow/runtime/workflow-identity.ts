import { cloneJson, toSafeString } from 'giga-ai-helper';
import { WorkflowDefinition } from '@connectingmatrix/workflow-driver/services/workflow/contracts/types';

const readMetadata = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const normalizeWorkflowSnapshotIdentity = (params: {
  workflow: WorkflowDefinition | null | undefined;
  workflowDescription?: string | null;
  workflowId: string;
  workflowName?: string | null;
  workflowScope?: string | null;
}): WorkflowDefinition | null => {
  const workflowId = toSafeString(params.workflowId);
  if (!workflowId || !params.workflow) {
    return null;
  }

  const workflow = cloneJson(params.workflow) as WorkflowDefinition;
  const metadata = readMetadata(workflow.metadata);
  const workflowName = toSafeString(metadata.name) || toSafeString(params.workflowName);
  const workflowDescription = toSafeString(metadata.description) || toSafeString(params.workflowDescription);
  const workflowScope = toSafeString(params.workflowScope);

  workflow.metadata = {
    ...metadata,
    id: workflowId,
    workflowRecordId: workflowId,
    ...(workflowName ? { name: workflowName } : {}),
    ...(workflowDescription || typeof metadata.description === 'string' || typeof params.workflowDescription === 'string'
      ? { description: workflowDescription }
      : {}),
    ...(workflowScope ? { workflowScope } : {}),
  } as WorkflowDefinition['metadata'];

  return workflow;
};
