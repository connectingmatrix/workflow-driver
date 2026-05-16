import { randomUUID } from 'node:crypto';
import { BadRequestError } from 'routing-controllers';
import { createWorkflowMcpRuntimeManager, WorkflowMcpRuntimeManager } from '@workflow/executor';
import { isCurrentUserRootUser } from '@giga/shared/lib/helper';
import { readUserMatrixState } from '@giga/permissions/manifest/user-matrix';
import { buildPermissionContext } from '@giga/permissions/services/auth/permission-context';
import { resolveRuntimeCredentialAccess } from '@giga/general/services/credentials/auth/access';
import { recordCredentialExecutionResult } from '@giga/general/services/credentials/telemetry/execution-telemetry';
import { resolveCredentialForExecution } from '@giga/general/services/credentials/runtime/service';
import { getOrganizationAccessContext } from '@giga/general/services/organization/access';
import { buildWorkflowSearchText, createWorkflowSecret, requireWorkflowScopeType } from '@giga/general/services/graphql/resolvers/integration/base';
import { runCreateWorkflow, runDeleteWorkflow, runUpdateWorkflow } from '@connectingmatrix/chat/services/chat/actions/runtime/workflow';
import { runCreateWorkflowFromCypher } from '@connectingmatrix/chat/services/chat/actions/runtime/workflow-cypher';
import { runUpdateWorkflowFromCypher } from '@connectingmatrix/chat/services/chat/actions/write/workflow-cypher-update';
import { resolvePostId, resolveTreeNodeId } from '@connectingmatrix/chat/services/chat/actions/runtime/helpers';
import { WorkflowEntity, WorkflowVersionEntity } from '@connectingmatrix/orm/repositories/entities';
import { RESOURCE_TYPES } from '@giga/shared/types/contracts/graph.types';
import { bindWorkflowCredentials } from '@connectingmatrix/workflows/services/workflow/runtime/bindWorkflowCredentials';
import { normalizeWorkflowSnapshotIdentity } from '@connectingmatrix/workflows/services/workflow/runtime/workflow-identity';
import { WorkflowNodeStatusEnum } from '@connectingmatrix/workflows/services/workflow/contracts/types';
import type { AgentActionRuntime } from '@giga/shared/types/contracts/agent.types';
import type {
  WorkflowExecutionRequestContext,
  WorkflowNodeHandlerResult,
  WorkflowRuntimeSettings,
  WorkflowDefinition,
} from '@connectingmatrix/workflows/services/workflow/contracts/types';
import type { WorkflowBackendRequest } from '@giga/shared/types/contracts/workflow.types';
import type { WorkflowCredentialHostContext } from '@workflow/executor';

interface WorkflowExecutionHostContext {
  executeWorkflowReference?: (input: { workflowId: string; parameters: unknown; settings?: WorkflowRuntimeSettings }) => Promise<{
    result: unknown;
    runId: string;
    workflowId: string;
    workflowName: string;
    workflowScope: 'user' | 'organization';
    stopped: boolean;
    logs: string[];
    editorUrl?: string | null;
  }>;
}

const createWorkflowVersionOnPublish = async (params: {
  actorUserId: string | null;
  description?: string | null;
  name?: string | null;
  reference: { workflowId: string; scope?: WorkflowScope; organizationId?: string | null; ownerUserId?: string | null };
  supabase?: object;
  workflowSnapshot: WorkflowDefinition;
  publishedAt: string;
}) =>
  WorkflowVersionEntity.createOnPublish({
    workflowId: params.reference.workflowId,
    workflow: (params.workflowSnapshot || {}) as unknown as Record<string, unknown>,
    createdBy: params.actorUserId,
    metadata: {
      name: params.name || null,
      description: params.description || null,
      publishedAt: params.publishedAt,
    },
  });

export interface WorkflowExecutorHostContext {
  requestContext: WorkflowExecutionRequestContext;
  credentials: WorkflowCredentialHostContext;
  mcp: WorkflowMcpRuntimeManager;
  workflows: WorkflowExecutionHostContext;
}

export interface WorkflowExecutorHostContextOptions {
  mcp?: WorkflowMcpRuntimeManager;
  workflows?: WorkflowExecutionHostContext;
}

type WorkflowScope = 'user' | 'organization';
type WorkflowPermission = 'read' | 'create' | 'update' | 'delete';
type WorkflowRow = Record<string, any>;

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const recordValue = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
const workflowEditorUrl = (workflowId: string) => `/workflows/${workflowId}/edit`;
const workflowScope = (row: WorkflowRow): WorkflowScope => (textValue(row.organization_id) ? 'organization' : 'user');
const canReadOrgWorkflow = (permissions: Record<string, any>) => permissions.CAN_READ_WORKFLOW || permissions.CAN_EXECUTE_ORG_WORKFLOWS;
const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const actionRuntime = (requestContext: WorkflowExecutionRequestContext): AgentActionRuntime => ({
  supabase: requestContext.supabase,
  userId: requestContext.userId,
  chatId: '',
  message: 'Workflow node execution',
  context: {} as any,
  topK: 10,
  request: requestContext.request,
});
const managedRecord = (row: WorkflowRow) => ({
  workflowId: String(row.id),
  workflowName: textValue(row.name) || 'Workflow',
  workflowDescription: textValue(row.description) || null,
  workflowScope: workflowScope(row),
  organizationId: textValue(row.organization_id) || null,
  status: textValue(row.status) || 'draft',
  editorUrl: workflowEditorUrl(String(row.id)),
  workflow: (row.workflow || null) as WorkflowDefinition | null,
  publishedWorkflow: (row.published_workflow || null) as WorkflowDefinition | null,
  cypher: textValue(recordValue(row.metadata).workflow_cypher) || null,
  publishedAt: row.published_at || null,
});
const managedSummaryRecord = (record: ReturnType<typeof managedRecord>) => ({
  workflowId: record.workflowId,
  workflowName: record.workflowName,
  workflowDescription: record.workflowDescription,
  workflowScope: record.workflowScope,
  organizationId: record.organizationId,
  status: record.status,
  editorUrl: record.editorUrl,
  nodeCount: Array.isArray(record.workflow?.nodes) ? record.workflow.nodes.length : 0,
  connectionCount: Array.isArray(record.workflow?.connections) ? record.workflow.connections.length : 0,
  publishedNodeCount: Array.isArray(record.publishedWorkflow?.nodes) ? record.publishedWorkflow.nodes.length : 0,
  publishedConnectionCount: Array.isArray(record.publishedWorkflow?.connections) ? record.publishedWorkflow.connections.length : 0,
  hasCypher: Boolean(record.cypher),
  publishedAt: record.publishedAt,
});
const isWorkflowExecutionRequestContext = (value: unknown): value is WorkflowExecutionRequestContext => {
  const record = toRecord(value);
  return typeof record.userId === 'string' && record.userId.trim().length > 0 && typeof record.request === 'object' && record.request !== null;
};
const readPermissions = async (requestContext: WorkflowExecutionRequestContext, organizationId?: string | null) =>
  buildPermissionContext(
    await readUserMatrixState(requestContext.supabase, { userId: requestContext.userId, organizationId: organizationId || null }),
    false,
  ) as Record<string, any>;
const assertScopeAccess = async (params: {
  requestContext: WorkflowExecutionRequestContext;
  scope: WorkflowScope;
  organizationId?: string | null;
  permission: WorkflowPermission;
  effectiveRoot: boolean;
}) => {
  if (params.scope === 'user' || params.effectiveRoot) return;
  const organizationId = textValue(params.organizationId);
  if (!organizationId) throw new BadRequestError('organizationId is required for organization workflows.');
  const access = await getOrganizationAccessContext(params.requestContext.supabase, params.requestContext.userId, organizationId);
  if (!access.hasMembership) throw new BadRequestError('You do not have access to this organization workflow scope.');
  const permissions = await readPermissions(params.requestContext, organizationId);
  if (params.permission === 'read' && canReadOrgWorkflow(permissions)) return;
  if (params.permission === 'create' && permissions.CAN_CREATE_WORKFLOW) return;
  if (params.permission === 'update' && permissions.CAN_UPDATE_WORKFLOW) return;
  if (params.permission === 'delete' && permissions.CAN_DELETE_WORKFLOW) return;
  throw new BadRequestError(`You do not have access to ${params.permission} organization workflows.`);
};
const loadWorkflowRow = async (params: {
  requestContext: WorkflowExecutionRequestContext;
  workflowId: string;
  effectiveRoot: boolean;
  permission: WorkflowPermission;
}) => {
  const row = await WorkflowEntity.readActiveRowById(params.workflowId);
  if (!row?.id) throw new BadRequestError('Workflow not found.');
  if (row.is_global === true) throw new BadRequestError('Global workflows are not supported by this node.');
  const scope = workflowScope(row);
  if (scope === 'user' && !params.effectiveRoot && textValue(row.user_id) !== params.requestContext.userId)
    throw new BadRequestError('You do not have access to this workflow.');
  await assertScopeAccess({
    requestContext: params.requestContext,
    scope,
    organizationId: row.organization_id,
    permission: params.permission,
    effectiveRoot: params.effectiveRoot,
  });
  return row;
};
const publishWorkflowRow = async (params: { requestContext: WorkflowExecutionRequestContext; row: WorkflowRow; workflow: WorkflowDefinition }) => {
  const now = new Date().toISOString();
  const workflowScopeValue = workflowScope(params.row);
  const workflowWithCredentials = await bindWorkflowCredentials({
    workflow: params.workflow,
    scope: workflowScopeValue,
    organizationId: textValue(params.row.organization_id) || null,
    supabase: params.requestContext.supabase,
    userId: params.requestContext.userId,
    effectiveRoot: await isCurrentUserRootUser(params.requestContext.supabase),
  });
  const normalizedWorkflow = normalizeWorkflowSnapshotIdentity({
    workflow: workflowWithCredentials,
    workflowId: String(params.row.id),
    workflowName: textValue(params.row.name),
    workflowDescription: textValue(params.row.description),
    workflowScope: workflowScopeValue,
  });
  const update = await params.requestContext.supabase
    .from('ai_workflows')
    .update({ published_workflow: normalizedWorkflow, status: 'published', published_at: now, updated_at: now })
    .eq('id', params.row.id)
    .select('*')
    .single();
  if (update.error) throw update.error;
  await createWorkflowVersionOnPublish({
    supabase: params.requestContext.supabase,
    actorUserId: params.requestContext.userId,
    reference: {
      workflowId: String(update.data.id),
      scope: workflowScopeValue,
      organizationId: textValue(update.data.organization_id) || null,
      ownerUserId: workflowScopeValue === 'user' ? params.requestContext.userId : null,
    },
    workflowSnapshot: normalizedWorkflow || params.workflow,
    publishedAt: now,
    name: textValue(update.data.name),
    description: textValue(update.data.description),
  });
  return update.data;
};
const createdRow = (value: unknown) => recordValue(recordValue(recordValue(value).data).workflow);
const saveUserWorkflow = async (
  requestContext: WorkflowExecutionRequestContext,
  input: {
    workflowId?: string | null;
    name: string;
    description?: string | null;
    workflow: WorkflowDefinition;
    cypher?: string | null;
  },
) => {
  const runtime = actionRuntime(requestContext);
  const metadataId = textValue(input.workflow.metadata?.id);
  const workflowId = textValue(input.workflowId) || (isUuid(metadataId) ? metadataId : randomUUID());
  const workflow = {
    ...input.workflow,
    metadata: { ...recordValue(input.workflow.metadata), id: workflowId, name: input.name, description: input.description || '' },
  } as WorkflowDefinition;
  if (textValue(input.cypher)) {
    return textValue(input.workflowId)
      ? createdRow(
          await runUpdateWorkflowFromCypher(runtime, {
            id: input.workflowId,
            name: input.name,
            description: input.description || '',
            cypher: input.cypher,
            executable: workflow.metadata?.executable !== false,
          }),
        )
      : createdRow(
          await runCreateWorkflowFromCypher(runtime, {
            id: workflowId,
            name: input.name,
            description: input.description || '',
            cypher: input.cypher,
            executable: workflow.metadata?.executable !== false,
          }),
        );
  }
  return textValue(input.workflowId)
    ? createdRow(await runUpdateWorkflow(runtime, { id: input.workflowId, name: input.name, description: input.description || '', workflow }))
    : createdRow(await runCreateWorkflow(runtime, { id: workflowId, name: input.name, description: input.description || '', workflow }));
};
const saveOrganizationWorkflow = async (params: {
  requestContext: WorkflowExecutionRequestContext;
  effectiveRoot: boolean;
  workflowId?: string | null;
  organizationId?: string | null;
  name: string;
  description?: string | null;
  workflow: WorkflowDefinition;
  cypher?: string | null;
  publishAfterSave?: boolean;
}) => {
  const now = new Date().toISOString();
  const description = textValue(params.description) || '';
  const metadataId = textValue(params.workflow.metadata?.id);
  const workflowId = textValue(params.workflowId) || (isUuid(metadataId) ? metadataId : randomUUID());
  const workflow = {
    ...params.workflow,
    metadata: { ...recordValue(params.workflow.metadata), id: workflowId, name: params.name, description },
  } as WorkflowDefinition;
  const metadata = { ...recordValue(workflow.metadata), workflow_cypher: textValue(params.cypher) || null };
  if (textValue(params.workflowId)) {
    const existing = await loadWorkflowRow({
      requestContext: params.requestContext,
      workflowId,
      effectiveRoot: params.effectiveRoot,
      permission: 'update',
    });
    const update = await params.requestContext.supabase
      .from('ai_workflows')
      .update({ name: params.name, description, workflow, metadata, search_text: buildWorkflowSearchText(workflow, description), updated_at: now })
      .eq('id', existing.id)
      .eq('organization_id', existing.organization_id)
      .select('*')
      .single();
    if (update.error) throw update.error;
    return params.publishAfterSave ? await publishWorkflowRow({ requestContext: params.requestContext, row: update.data, workflow }) : update.data;
  }
  await assertScopeAccess({
    requestContext: params.requestContext,
    scope: 'organization',
    organizationId: params.organizationId,
    permission: 'create',
    effectiveRoot: params.effectiveRoot,
  });
  const insert = await params.requestContext.supabase
    .from('ai_workflows')
    .insert({
      id: workflowId,
      user_id: null,
      organization_id: textValue(params.organizationId) || null,
      is_global: false,
      name: params.name,
      description,
      metadata,
      workflow,
      published_workflow: null,
      published_at: null,
      search_text: buildWorkflowSearchText(workflow, description),
      status: 'draft',
      webhook_secret: createWorkflowSecret(),
      is_active: true,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (insert.error) throw insert.error;
  return params.publishAfterSave ? await publishWorkflowRow({ requestContext: params.requestContext, row: insert.data, workflow }) : insert.data;
};
const listWorkflowDefinitions = async (params: {
  requestContext: WorkflowExecutionRequestContext;
  scope: WorkflowScope;
  organizationId?: string | null;
  effectiveRoot: boolean;
  limit: number;
}) => {
  await assertScopeAccess({
    requestContext: params.requestContext,
    scope: params.scope,
    organizationId: params.organizationId,
    permission: 'read',
    effectiveRoot: params.effectiveRoot,
  });
  let query = params.requestContext.supabase
    .from('ai_workflows')
    .select('id,name,description,organization_id,status,published_at,metadata')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(params.limit);
  query =
    params.scope === 'organization'
      ? query.eq('organization_id', textValue(params.organizationId))
      : query.eq('user_id', params.requestContext.userId).is('organization_id', null);
  const result = await query;
  if (result.error) throw result.error;
  return (result.data || []).map((row) => ({
    workflowId: String(row.id),
    workflowName: textValue(row.name) || 'Workflow',
    workflowDescription: textValue(row.description) || null,
    workflowScope: textValue(row.organization_id) ? 'organization' : 'user',
    organizationId: textValue(row.organization_id) || null,
    status: textValue(row.status) || 'draft',
    editorUrl: workflowEditorUrl(String(row.id)),
    nodeCount: 0,
    connectionCount: 0,
    publishedNodeCount: 0,
    publishedConnectionCount: 0,
    hasCypher: Boolean(textValue(recordValue(row.metadata).workflow_cypher)),
    publishedAt: row.published_at || null,
  }));
};
const loadWorkflowRowByName = async (params: {
  requestContext: WorkflowExecutionRequestContext;
  workflowName: string;
  scope: WorkflowScope;
  organizationId?: string | null;
  effectiveRoot: boolean;
  permission: WorkflowPermission;
}) => {
  let rows = await WorkflowEntity.listActiveRowsByName(params.workflowName);
  rows =
    params.scope === 'organization'
      ? rows.filter((row) => textValue(row.organization_id) === textValue(params.organizationId))
      : rows.filter((row) => textValue(row.user_id) === params.requestContext.userId && !textValue(row.organization_id));
  if (rows.length === 0) {
    const scopedRows =
      params.scope === 'organization'
        ? await WorkflowEntity.listActiveRowsByOrganizationId(textValue(params.organizationId))
        : await WorkflowEntity.listActiveRowsByUserId(params.requestContext.userId);
    const query = params.workflowName.toLowerCase();
    rows = scopedRows.filter((row) => textValue(row.name).toLowerCase().includes(query)).slice(0, 2);
  }
  if (rows.length === 0) throw new BadRequestError(`Workflow "${params.workflowName}" not found.`);
  if (rows.length > 1) throw new BadRequestError(`Multiple workflows matched "${params.workflowName}". Use workflowId.`);
  const row = rows[0];
  await assertScopeAccess({
    requestContext: params.requestContext,
    scope: workflowScope(row),
    organizationId: row.organization_id,
    permission: params.permission,
    effectiveRoot: params.effectiveRoot,
  });
  return row;
};
const resolveWorkflowId = async (params: {
  input: Record<string, unknown>;
  requestContext: WorkflowExecutionRequestContext;
  scope: WorkflowScope;
  organizationId?: string | null;
  effectiveRoot: boolean;
  permission: WorkflowPermission;
}) => {
  const workflowId = textValue(params.input.workflowId || params.input.workflow_id);
  if (workflowId) return workflowId;
  const workflowName = textValue(params.input.workflowName || params.input.name);
  if (!workflowName) throw new Error('Workflow ID or Workflow Name is required.');
  const row = await loadWorkflowRowByName({
    requestContext: params.requestContext,
    workflowName,
    scope: params.scope,
    organizationId: params.organizationId,
    effectiveRoot: params.effectiveRoot,
    permission: params.permission,
  });
  return String(row.id);
};
const getWorkflowDefinition = async (params: { requestContext: WorkflowExecutionRequestContext; workflowId: string; effectiveRoot: boolean }) =>
  managedRecord(
    await loadWorkflowRow({
      requestContext: params.requestContext,
      workflowId: params.workflowId,
      effectiveRoot: params.effectiveRoot,
      permission: 'read',
    }),
  );
const saveWorkflowDefinition = async (params: {
  requestContext: WorkflowExecutionRequestContext;
  workflowId?: string | null;
  scope: WorkflowScope;
  organizationId?: string | null;
  name: string;
  description?: string | null;
  workflow: WorkflowDefinition;
  cypher?: string | null;
  publishAfterSave?: boolean;
  effectiveRoot: boolean;
}) => {
  const row =
    params.scope === 'organization'
      ? await saveOrganizationWorkflow({
          requestContext: params.requestContext,
          effectiveRoot: params.effectiveRoot,
          workflowId: params.workflowId,
          organizationId: params.organizationId,
          name: params.name,
          description: params.description || '',
          workflow: params.workflow,
          cypher: params.cypher || null,
          publishAfterSave: params.publishAfterSave === true,
        })
      : await saveUserWorkflow(params.requestContext, {
          workflowId: params.workflowId,
          name: params.name,
          description: params.description || '',
          workflow: params.workflow,
          cypher: params.cypher || null,
        });
  if (params.scope === 'user' && params.publishAfterSave === true) {
    return managedRecord(
      await publishWorkflowRow({ requestContext: params.requestContext, row, workflow: (row.workflow || params.workflow) as WorkflowDefinition }),
    );
  }
  return managedRecord(row);
};
const deleteWorkflowDefinition = async (params: { requestContext: WorkflowExecutionRequestContext; workflowId: string; effectiveRoot: boolean }) => {
  const row = await loadWorkflowRow({
    requestContext: params.requestContext,
    workflowId: params.workflowId,
    effectiveRoot: params.effectiveRoot,
    permission: 'delete',
  });
  if (workflowScope(row) === 'user' && textValue(row.user_id) === params.requestContext.userId) {
    await runDeleteWorkflow(actionRuntime(params.requestContext), { id: params.workflowId });
    return { workflowId: params.workflowId };
  }
  await WorkflowEntity.deleteById(params.workflowId);
  return { workflowId: params.workflowId };
};
const publishWorkflowDefinition = async (params: { requestContext: WorkflowExecutionRequestContext; workflowId: string; effectiveRoot: boolean }) => {
  const row = await loadWorkflowRow({
    requestContext: params.requestContext,
    workflowId: params.workflowId,
    effectiveRoot: params.effectiveRoot,
    permission: 'update',
  });
  return managedRecord(await publishWorkflowRow({ requestContext: params.requestContext, row, workflow: row.workflow as WorkflowDefinition }));
};
const attachmentNodeType = (scopeType: string) => {
  const normalized = requireWorkflowScopeType(scopeType);
  if (normalized === 'CHANNEL') return RESOURCE_TYPES.channel;
  if (normalized === 'CATEGORY') return RESOURCE_TYPES.category;
  if (normalized === 'SUBJECT') return RESOURCE_TYPES.subject;
  return 'POST';
};
const resolveAttachmentScopeId = async (requestContext: WorkflowExecutionRequestContext, input: Record<string, unknown>) => {
  const scopeId = textValue(input.scopeId || input.scope_id);
  if (scopeId) return scopeId;
  const scopeType = requireWorkflowScopeType(textValue(input.scopeType || input.scope_type || 'CHANNEL'));
  const scopeName = textValue(input.scopeName || input.scope_name || input.channelName || input.channel_name || input.targetName || input.target);
  const runtime = actionRuntime(requestContext);
  if (scopeType === 'POST')
    return resolvePostId(
      runtime,
      { ...input, title: scopeName },
      { idKeys: ['scopeId', 'scope_id', 'post_id'], titleKeys: ['scopeName', 'scope_name', 'post_title', 'title'] },
    );
  return resolveTreeNodeId(
    runtime,
    { ...input, name: scopeName },
    { idKey: 'scopeId', label: scopeType.toLowerCase(), nameKeys: ['scopeName', 'scope_name', 'name'], nodeType: attachmentNodeType(scopeType) },
  );
};
const attachWorkflowDefinition = async (params: {
  requestContext: WorkflowExecutionRequestContext;
  input: Record<string, unknown>;
  workflowId: string;
  organizationId?: string | null;
}) => {
  const scopeType = requireWorkflowScopeType(textValue(params.input.scopeType || params.input.scope_type || 'CHANNEL'));
  const scopeId = await resolveAttachmentScopeId(params.requestContext, params.input);
  const now = new Date().toISOString();
  let update = params.requestContext.supabase
    .from('ai_workflow_assignments')
    .update({ workflow_id: params.workflowId, metadata: recordValue(params.input.metadata), updated_at: now })
    .eq('scope_type', scopeType)
    .eq('scope_id', scopeId);
  update = params.organizationId
    ? update.eq('organization_id', params.organizationId).is('user_id', null)
    : update.eq('user_id', params.requestContext.userId).is('organization_id', null);
  const updateResult = await update.select('*');
  if (updateResult.error) throw updateResult.error;
  const updated = (updateResult.data || [])[0];
  if (updated) return { assignment: updated, scopeType, scopeId };
  const insert = await params.requestContext.supabase
    .from('ai_workflow_assignments')
    .insert({
      id: randomUUID(),
      workflow_id: params.workflowId,
      scope_type: scopeType,
      scope_id: scopeId,
      user_id: params.organizationId ? null : params.requestContext.userId,
      organization_id: params.organizationId || null,
      metadata: recordValue(params.input.metadata),
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (insert.error) throw insert.error;
  return { assignment: insert.data, scopeType, scopeId };
};

export const getWorkflowExecutionRequestContext = (hostContext: unknown): WorkflowExecutionRequestContext | null => {
  if (isWorkflowExecutionRequestContext(hostContext)) return hostContext;
  const { requestContext } = toRecord(hostContext);
  return isWorkflowExecutionRequestContext(requestContext) ? requestContext : null;
};

export const createWorkflowExecutorHostContext = (
  requestContext: WorkflowExecutionRequestContext,
  options?: WorkflowExecutorHostContextOptions,
): WorkflowExecutorHostContext => {
  let effectiveRootPromise: Promise<boolean> | null = null;
  const getEffectiveRoot = (): Promise<boolean> => {
    if (!effectiveRootPromise) effectiveRootPromise = isCurrentUserRootUser(requestContext.supabase);
    return effectiveRootPromise;
  };

  return {
    requestContext,
    credentials: {
      fetchCredentialById: async (credentialId) =>
        resolveCredentialForExecution(requestContext.supabase, credentialId, async (scope) =>
          resolveRuntimeCredentialAccess({
            supabase: requestContext.supabase,
            currentUserId: requestContext.userId,
            effectiveRoot: await getEffectiveRoot(),
            scope: scope.scope,
            organizationId: scope.organizationId,
          }),
        ),
      recordCredentialExecutionResult: async (input) => {
        await recordCredentialExecutionResult(input);
      },
    },
    mcp: options && options.mcp ? options.mcp : createWorkflowMcpRuntimeManager(),
    workflows: options && options.workflows ? options.workflows : {},
  };
};

const workflowManagementPayload = (request: WorkflowBackendRequest) => toRecord(toRecord(request.payload).request || request.payload);
const workflowManagementSummary = (operation: string, record: Record<string, any>) => {
  const name = textValue(record.workflowName || record.name || record.workflow_id || record.workflowId || 'workflow');
  if (operation === 'list') return `Listed ${Number(record.count || (Array.isArray(record.workflows) ? record.workflows.length : 0))} workflow(s).`;
  if (operation === 'delete') return `Deleted ${name}.`;
  if (operation === 'publish') return `Published ${name}.`;
  if (operation === 'get') return `Loaded ${name}.`;
  if (operation === 'attach') return `Attached ${name}.`;
  return `Saved ${name}.`;
};

export const executeWorkflowManagementBackendRequest = async (request: WorkflowBackendRequest): Promise<WorkflowNodeHandlerResult> => {
  const requestContext = getWorkflowExecutionRequestContext(request.context.hostContext);
  if (!requestContext)
    return {
      output: { error: 'Workflow backend execution requires a backend request context.' },
      status: WorkflowNodeStatusEnum.Failed,
      logs: ['Workflow backend execution requires a backend request context.'],
    };
  try {
    const input = workflowManagementPayload(request);
    const operation = textValue(input.operation || 'save');
    const scope = textValue(input.scope || 'user') === 'organization' ? 'organization' : 'user';
    const organizationId = textValue(input.organizationId || input.organization_id) || null;
    const effectiveRoot = await isCurrentUserRootUser(requestContext.supabase);
    let data: Record<string, unknown> = {};
    if (operation === 'list') {
      const listLimit = Math.min(Math.max(Number(input.limit || input.topK || 25) || 25, 1), 50);
      const workflows = await listWorkflowDefinitions({ requestContext, scope, organizationId, effectiveRoot, limit: listLimit });
      data = { workflows, count: workflows.length };
    } else if (operation === 'get') {
      const workflowId = await resolveWorkflowId({ input, requestContext, scope, organizationId, effectiveRoot, permission: 'read' });
      const workflow = await getWorkflowDefinition({ requestContext, workflowId, effectiveRoot });
      data = { workflow: managedSummaryRecord(workflow), editorUrl: workflow.editorUrl || null };
    } else if (operation === 'delete') {
      const workflowId = await resolveWorkflowId({ input, requestContext, scope, organizationId, effectiveRoot, permission: 'delete' });
      const workflowName = textValue(input.workflowName || input.name);
      const deleted = await deleteWorkflowDefinition({ requestContext, workflowId, effectiveRoot });
      data = { workflowId: deleted.workflowId || workflowId, workflowName };
    } else if (operation === 'publish') {
      const workflowId = await resolveWorkflowId({ input, requestContext, scope, organizationId, effectiveRoot, permission: 'update' });
      const workflow = await publishWorkflowDefinition({ requestContext, workflowId, effectiveRoot });
      data = { workflow, editorUrl: workflow.editorUrl || null };
    } else if (operation === 'attach') {
      const workflowId = await resolveWorkflowId({ input, requestContext, scope, organizationId, effectiveRoot, permission: 'read' });
      const workflow = await getWorkflowDefinition({ requestContext, workflowId, effectiveRoot });
      const attached = await attachWorkflowDefinition({ requestContext, input, workflowId, organizationId });
      data = {
        workflow,
        assignment: attached.assignment,
        scopeType: attached.scopeType,
        scopeId: attached.scopeId,
        editorUrl: workflow.editorUrl || null,
      };
    } else {
      const workflowName = textValue(input.workflowName || input.name);
      if (!workflowName) throw new Error('Workflow Name is required.');
      const updateWorkflowId =
        textValue(input.saveMode) === 'update'
          ? await resolveWorkflowId({ input, requestContext, scope, organizationId, effectiveRoot, permission: 'update' })
          : null;
      const workflow = await saveWorkflowDefinition({
        requestContext,
        workflowId: updateWorkflowId,
        scope,
        organizationId,
        name: workflowName,
        description: textValue(input.workflowDescription || input.description) || null,
        workflow: recordValue(input.workflow) as WorkflowDefinition,
        cypher: textValue(input.cypher) || null,
        publishAfterSave: input.publishAfterSave === true,
        effectiveRoot,
      });
      data = { workflow, validation: recordValue(input.validation), cypher: textValue(input.cypher) || null, editorUrl: workflow.editorUrl || null };
    }
    const workflow = recordValue(recordValue(data.workflow).workflow || data.workflow || data);
    const summary = workflowManagementSummary(operation, { ...data, ...workflow, count: data.count });
    const action_result = {
      id: 'workflow',
      name: 'Workflow',
      status: 'completed',
      reason: textValue(input.reason || 'Workflow node execution.'),
      summary,
      error: null,
      data: {
        ...data,
        workflow_id: textValue(workflow.workflowId || workflow.id || data.workflowId),
        workflow_name: textValue(workflow.workflowName || workflow.name),
        editor_url: textValue(workflow.editorUrl || data.editorUrl) || null,
        text: summary,
      },
    };
    return {
      output: { ...data, action_result, action_results: [action_result], __activeOutputs: ['output'] },
      status: WorkflowNodeStatusEnum.Passed,
      logs: [summary],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workflow node execution failed.';
    return { output: { error: message }, status: WorkflowNodeStatusEnum.Failed, logs: [message] };
  }
};
