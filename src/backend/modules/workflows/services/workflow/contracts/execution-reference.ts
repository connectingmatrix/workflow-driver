import { BadRequestError } from 'routing-controllers';
import { createJsonlWorkflowLogger } from 'giga-ai-helper/workflow';
import { isCurrentUserRootUser } from '@giga/shared/lib/helper';
import { readUserMatrixState } from '@giga/permissions/manifest/user-matrix';
import { OrganisationEntity } from '@connectingmatrix/orm/repositories/entities';
import { WorkflowEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowEntity';
import { buildPermissionContext } from '@giga/permissions/services/auth/permission-context';
import { executeWorkflow } from '@connectingmatrix/nodes/services/workflow/executor';
import {
  createWorkflowExecutorHostContext,
  getWorkflowExecutionRequestContext,
} from '@connectingmatrix/workflow-driver/services/workflow/runtime/credential-host-context';
// eslint-disable-next-line import/no-cycle
import {
  extractWorkflowTerminalPayload,
  loadPersistedWorkflowRecord,
  resolveExecutionWorkflow,
} from '@connectingmatrix/workflow-driver/services/workflow/runtime/webhook';
import { WorkflowNodeStatusEnum } from '@connectingmatrix/workflow-driver/services/workflow/contracts/types';
import type {
  WorkflowExecutionRequestContext,
  WorkflowNodeHandlerResult,
  WorkflowRuntimeSettings,
  WorkflowDefinition,
} from '@connectingmatrix/workflow-driver/services/workflow/contracts/types';
import type { WorkflowBackendRequest } from '@giga/shared/types/contracts/workflow.types';

type WorkflowExecutionScope = 'user' | 'organization';
type WorkflowExecutionOption = {
  workflowId: string;
  workflowName: string;
  scope: WorkflowExecutionScope;
  scopeTag: 'User' | 'Org';
  status: string | null;
};

const toSafeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const isPublished = (value: unknown): boolean => toSafeString(value).toLowerCase() === 'published';
const toScopeTag = (scope: WorkflowExecutionScope): 'User' | 'Org' => (scope === 'organization' ? 'Org' : 'User');
const canExecuteOrganizationWorkflow = (permissions: ReturnType<typeof buildPermissionContext>) =>
  permissions.CAN_READ_WORKFLOW || permissions.CAN_EXECUTE_ORG_WORKFLOWS;
const workflowEditorUrl = (workflowId: string) => `/workflows/${workflowId}/edit`;

const applyStartInput = (workflow: WorkflowDefinition, parameters: unknown): WorkflowDefinition => ({
  ...workflow,
  nodes: (workflow.nodes || []).map((node) =>
    node.modelId !== 'start'
      ? node
      : {
          ...node,
          input: { input: parameters },
          ports: { in: { ...(node.ports?.in || {}), input: { input: parameters } }, out: node.ports?.out || {} },
          inspector: node.inspector ? { ...node.inspector, input: { input: parameters } } : node.inspector,
        },
  ),
});

const requireWorkflowExecutionRecord = async (requestContext: WorkflowExecutionRequestContext, workflowId: string, effectiveRoot: boolean) => {
  const record = await loadPersistedWorkflowRecord(requestContext.supabase, workflowId);
  if (!record?.id || record.isActive === false) throw new BadRequestError('Workflow not found.');
  if (record.scope === 'default') throw new BadRequestError('Global workflows cannot be executed from this node.');
  if (record.scope === 'user' && !effectiveRoot && record.userId !== requestContext.userId)
    throw new BadRequestError('You do not have access to execute this workflow.');
  if (record.scope === 'organization' && !effectiveRoot) {
    const accessContext = await OrganisationEntity.accessContext({
      supabase: requestContext.supabase,
      userId: requestContext.userId,
      organizationId: record.organizationId || null,
    });
    const permissions = buildPermissionContext(
      await readUserMatrixState(requestContext.supabase, { organizationId: record.organizationId || null, userId: requestContext.userId }),
      false,
    );
    if (!record.organizationId || !accessContext.hasMembership || !canExecuteOrganizationWorkflow(permissions))
      throw new BadRequestError('You do not have access to execute this workflow.');
  }
  const workflow = resolveExecutionWorkflow(record, 'published');
  if (!workflow) throw new BadRequestError('Only published workflows can be executed.');
  return { record, workflow, scope: record.scope as WorkflowExecutionScope };
};

const createWorkflowReferenceRunner = (requestContext: WorkflowExecutionRequestContext) => {
  let effectiveRootPromise: Promise<boolean> | null = null;
  const getEffectiveRoot = (): Promise<boolean> => {
    if (!effectiveRootPromise) {
      effectiveRootPromise = isCurrentUserRootUser(requestContext.supabase);
    }
    return effectiveRootPromise;
  };

  return async (input: { workflowId: string; parameters: unknown; settings?: WorkflowRuntimeSettings }) =>
    executeWorkflowReference({
      workflowId: input.workflowId,
      parameters: input.parameters,
      requestContext,
      effectiveRoot: await getEffectiveRoot(),
      settings: input.settings,
    });
};

export const createWorkflowReferenceHostContext = (requestContext: WorkflowExecutionRequestContext) =>
  createWorkflowExecutorHostContext(requestContext, {
    workflows: {
      executeWorkflowReference: createWorkflowReferenceRunner(requestContext),
    },
  });

export const listWorkflowExecutionOptions = async (params: {
  organizationId?: string | null;
  requestContext: WorkflowExecutionRequestContext;
  effectiveRoot: boolean;
}): Promise<WorkflowExecutionOption[]> => {
  const userRows = await WorkflowEntity.listActiveRowsByUserId(params.requestContext.userId, 'id,name,status');
  const options: WorkflowExecutionOption[] = userRows
    .filter((row: any) => row?.id && isPublished(row?.status))
    .map((row: any) => ({
      workflowId: String(row.id),
      workflowName: toSafeString(row.name) || 'Workflow',
      scope: 'user' as const,
      scopeTag: 'User',
      status: toSafeString(row.status) || 'published',
    }));

  const organizationIds = params.organizationId
    ? [params.organizationId]
    : (
        await OrganisationEntity.accessContext({
          supabase: params.requestContext.supabase,
          userId: params.requestContext.userId,
        })
      ).organizationIds;
  for (const organizationId of organizationIds) {
    if (!organizationId) continue;
    const accessContext = await OrganisationEntity.accessContext({
      supabase: params.requestContext.supabase,
      userId: params.requestContext.userId,
      organizationId,
    });
    if (!params.effectiveRoot) {
      const permissions = buildPermissionContext(
        await readUserMatrixState(params.requestContext.supabase, { organizationId, userId: params.requestContext.userId }),
        false,
      );
      if (!accessContext.hasMembership || !canExecuteOrganizationWorkflow(permissions)) continue;
    }
    const orgRows = await WorkflowEntity.listActiveRowsByOrganizationId(organizationId, 'id,name,status');
    options.push(
      ...orgRows
        .filter((row: any) => row?.id && isPublished(row?.status))
        .map((row: any) => ({
          workflowId: String(row.id),
          workflowName: toSafeString(row.name) || 'Workflow',
          scope: 'organization' as const,
          scopeTag: toScopeTag('organization'),
          status: toSafeString(row.status) || 'published',
        })),
    );
  }

  return options.sort((left, right) =>
    left.scope === right.scope ? left.workflowName.localeCompare(right.workflowName) : left.scope === 'user' ? -1 : 1,
  );
};

export const executeWorkflowReference = async (params: {
  workflowId: string;
  parameters: unknown;
  requestContext: WorkflowExecutionRequestContext;
  effectiveRoot: boolean;
  settings?: WorkflowRuntimeSettings;
}) => {
  const resolved = await requireWorkflowExecutionRecord(params.requestContext, params.workflowId, params.effectiveRoot);
  if (!params.settings?.graphqlUrl || !params.settings?.authMode) throw new BadRequestError('Workflow runtime settings are missing.');
  const execution = await executeWorkflow(applyStartInput(resolved.workflow, params.parameters), {
    requestContext: params.requestContext,
    settings: params.settings,
    hostContext: createWorkflowReferenceHostContext(params.requestContext),
    logger: createJsonlWorkflowLogger(() => undefined),
  });

  return {
    result: extractWorkflowTerminalPayload(execution.workflow),
    runId: execution.runId,
    workflowId: resolved.record.id,
    workflowName: resolved.record.name,
    workflowScope: resolved.scope,
    stopped: execution.stopped,
    logs: execution.logs.map((event) => [event.event, event.message].filter(Boolean).join(': ')),
    editorUrl: workflowEditorUrl(resolved.record.id),
  };
};

const backendPayload = (request: WorkflowBackendRequest) => {
  const root =
    request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload) ? (request.payload as Record<string, unknown>) : {};
  const input = root.request && typeof root.request === 'object' && !Array.isArray(root.request) ? (root.request as Record<string, unknown>) : root;
  return input;
};
const resolveBackendWorkflowId = async (params: {
  effectiveRoot: boolean;
  input: Record<string, unknown>;
  requestContext: WorkflowExecutionRequestContext;
}) => {
  const workflowId = toSafeString(params.input.workflowId);
  if (workflowId) return workflowId;
  const workflowName = toSafeString(params.input.workflowName || params.input.workflow_name);
  if (!workflowName) throw new BadRequestError('Workflow ID or Workflow Name is required.');
  const options = await listWorkflowExecutionOptions({
    organizationId: toSafeString(params.input.organizationId || params.input.organization_id) || null,
    requestContext: params.requestContext,
    effectiveRoot: params.effectiveRoot,
  });
  const matches = options.filter((option) => option.workflowName === workflowName);
  if (matches.length === 1) return matches[0].workflowId;
  if (matches.length > 1) throw new BadRequestError(`Multiple published workflows matched "${workflowName}". Use workflowId.`);
  throw new BadRequestError(`Published workflow "${workflowName}" was not found.`);
};

export const executeWorkflowReferenceBackendRequest = async (request: WorkflowBackendRequest): Promise<WorkflowNodeHandlerResult> => {
  const requestContext = getWorkflowExecutionRequestContext(request.context.hostContext);
  if (!requestContext)
    return {
      output: { error: 'Workflow backend execution requires a backend request context.' },
      status: WorkflowNodeStatusEnum.Failed,
      logs: ['Workflow backend execution requires a backend request context.'],
    };
  try {
    const input = backendPayload(request);
    const effectiveRoot = await isCurrentUserRootUser(requestContext.supabase);
    const workflowId = await resolveBackendWorkflowId({ input, requestContext, effectiveRoot });
    const result = await executeWorkflowReference({
      workflowId,
      parameters: input.parameters || {},
      requestContext,
      effectiveRoot,
      settings: request.context.settings,
    });
    const text =
      typeof result.result === 'string'
        ? result.result.trim()
        : toSafeString(
            (result.result as Record<string, unknown>)?.text ||
              (result.result as Record<string, unknown>)?.output ||
              (result.result as Record<string, unknown>)?.result,
          );
    const action_result = {
      id: 'execute-workflow',
      name: 'Execute Workflow',
      status: 'completed',
      reason: toSafeString(input.reason) || 'Execute the selected workflow.',
      summary: `Executed workflow "${result.workflowName}".`,
      error: null,
      data: {
        output: result.result,
        text,
        run_id: result.runId,
        workflow_id: result.workflowId,
        workflow_name: result.workflowName,
        editor_url: result.editorUrl || null,
      },
    };
    return {
      output: {
        output: result.result,
        text,
        runId: result.runId,
        workflowId: result.workflowId,
        workflowName: result.workflowName,
        workflowScope: result.workflowScope,
        editorUrl: result.editorUrl || null,
        stopped: result.stopped,
        logs: result.logs,
        action_result,
        action_results: [action_result],
        __activeOutputs: ['output'],
      },
      status: WorkflowNodeStatusEnum.Passed,
      logs: result.logs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workflow execution failed.';
    return { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs: [message] };
  }
};
