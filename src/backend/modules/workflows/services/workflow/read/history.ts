import { randomUUID } from 'crypto';
import { cloneJson, toSafeString } from 'giga-ai-helper';
import { Executor } from '@workflow/executor';
import { invalidateGraphqlCache } from '@giga/shared/cache';
import { WorkflowEntity, WorkflowExecutionEntity, WorkflowVersionEntity } from '@connectingmatrix/orm/repositories/entities';
import { emitWorkflowCatalogStatus, emitWorkflowExecutionUpdate, emitWorkflowLogEvent } from '@connectingmatrix/sockets/workflow/event-bus';
import { normalizeWorkflowSnapshotIdentity } from '@connectingmatrix/workflows/services/workflow/runtime/workflow-identity';
import { WorkflowDefinition, WorkflowRunLogEvent } from '@connectingmatrix/workflows/services/workflow/contracts/types';
import type { WorkflowExecutionTracker, WorkflowHistoryScope, WorkflowReference, WorkflowSource } from '@giga/shared/types/contracts/workflow.types';
import type { WorkflowExecutionRow } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowExecutionEntity';
import type { WorkflowVersionRow } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowVersionEntity';

export type { WorkflowExecutionTracker, WorkflowHistoryScope, WorkflowReference, WorkflowSource } from '@giga/shared/types/contracts/workflow.types';

type WorkflowBroadcast = {
  broadcastId: string;
  broadcastChannelName: string;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const resolveStoredResponsePayload = (currentPayload: unknown, nextPayload: unknown): unknown => {
  const currentRecord = toRecord(currentPayload);
  const nextRecord = toRecord(nextPayload);

  if (Object.keys(nextRecord).length > 0) {
    if (Object.keys(currentRecord).length > 0) {
      return cloneJson({
        ...currentRecord,
        ...nextRecord,
      });
    }
    return cloneJson(nextRecord);
  }

  if (Object.keys(currentRecord).length > 0) {
    return cloneJson(currentRecord);
  }

  if (typeof nextPayload !== 'undefined' && nextPayload !== null) {
    return cloneJson(nextPayload);
  }

  return {};
};

const resolveStoredLogs = (currentLogs: unknown, nextLogs: unknown): WorkflowRunLogEvent[] => {
  if (Array.isArray(nextLogs) && nextLogs.length) return cloneJson(nextLogs) as WorkflowRunLogEvent[];
  if (Array.isArray(currentLogs) && currentLogs.length) return cloneJson(currentLogs) as WorkflowRunLogEvent[];
  return [];
};

const normalizeScope = (value: unknown): WorkflowHistoryScope => {
  const normalized = toSafeString(value).toLowerCase();
  if (normalized === 'global') return 'global';
  if (normalized === 'organization') return 'organization';
  return 'user';
};

const workflowSourceForScope = (scope: WorkflowHistoryScope): WorkflowSource =>
  scope === 'global' ? 'globalDefault' : scope === 'organization' ? 'organization' : 'user';

const readWorkflowVersionLabel = async (supabase: any, workflowVersionId: string | null): Promise<string | null> => {
  if (!workflowVersionId) {
    return null;
  }
  const versionNumber = await WorkflowVersionEntity.readVersionNumberById(workflowVersionId);
  return Number.isFinite(versionNumber) ? `v${versionNumber}` : null;
};

const createExecutionRecord = (row: Record<string, any>, reference: WorkflowReference, workflowVersionLabel: string | null, compact = false) => ({
  id: toSafeString(row.id),
  workflowId: reference.workflowId,
  workflowScope: reference.scope,
  organizationId: reference.organizationId,
  workflowVersionId: toSafeString(row.workflow_version_id) || null,
  workflowVersionLabel,
  status: toSafeString(row.status),
  triggerType: toSafeString(row.trigger_type) || null,
  runId: toSafeString(row.run_id) || null,
  errorMessage: toSafeString(row.error_message) || null,
  createdAt: row.created_at,
  completedAt: row.completed_at || null,
  durationMs: Number.isFinite(Number(row.duration_ms)) ? Number(row.duration_ms) : null,
  requestPayload: compact ? null : row.request_payload || null,
  responsePayload: row.response_payload || null,
  logs: compact ? [] : Array.isArray(row.logs) ? row.logs : [],
  workflowSnapshot: compact
    ? null
    : normalizeWorkflowSnapshotIdentity({
        workflow: row.workflow_snapshot || null,
        workflowId: reference.workflowId,
        workflowScope: reference.scope,
      }),
});

const listActiveExecutionRows = async (supabase: any, workflowIds: string[]) => WorkflowExecutionEntity.listActiveRowsByWorkflowIds(workflowIds);

const listLatestExecutionRows = async (supabase: any, workflowIds: string[]) => {
  if (!workflowIds.length) return {};
  const latestByWorkflowId: Record<string, Record<string, any>> = {};
  const rows = await WorkflowExecutionEntity.listStatusRowsByWorkflowIds(workflowIds);
  for (const row of rows) {
    const workflowId = toSafeString(row.workflow_id);
    if (workflowId && !latestByWorkflowId[workflowId]) latestByWorkflowId[workflowId] = row;
  }
  return latestByWorkflowId;
};

const reconcileTrackedExecutionRows = async (params: {
  broadcast?: WorkflowBroadcast;
  now?: Date;
  rows: Array<Record<string, any>>;
  supabase: any;
  workflowReferenceById?: Record<string, WorkflowReference>;
}) => {
  const now = params.now || new Date();
  const nowIso = now.toISOString();
  const rowsById = params.rows.reduce<Record<string, Record<string, any>>>((acc, row) => {
    const id = toSafeString(row.id);
    if (id) {
      acc[id] = row;
    }
    return acc;
  }, {});

  const staleRows = params.rows.filter((row) =>
    Executor.isWorkflowQueueExecutionStalled({
      createdAt: row.created_at,
      now,
      responsePayload: row.response_payload,
      workflowSnapshot: row.workflow_snapshot,
    }),
  );

  for (const row of staleRows) {
    const executionId = toSafeString(row.id);
    if (!executionId) {
      continue;
    }

    const createdAt = Number.isFinite(new Date(row.created_at).getTime()) ? new Date(row.created_at).getTime() : now.getTime();
    const data = await WorkflowExecutionEntity.updateById({
      id: executionId,
      expectedStatuses: ['queued', 'running'],
      patch: {
        status: 'failed',
        error_message: 'Workflow execution stalled before completion.',
        duration_ms: Math.max(0, now.getTime() - createdAt),
        updated_at: nowIso,
        completed_at: nowIso,
      },
    });
    if (!data) {
      continue;
    }

    rowsById[executionId] = data;
    const workflowReference = params.workflowReferenceById?.[toSafeString(data.workflow_id)];
    if (workflowReference) {
      invalidateWorkflowHistoryCache(workflowReference);
    }
    if (workflowReference && params.broadcast) {
      void emitExecutionUpdateForRow(params.supabase, workflowReference, data, params.broadcast).catch(() => undefined);
    }
  }

  return Object.values(rowsById);
};

const invalidateWorkflowHistoryCache = (reference: WorkflowReference): void => {
  const tags = ['workflow:catalog:', 'workflow:history:', 'workflow:running:', `workflow:record:${reference.workflowId}`];
  if (reference.organizationId) {
    tags.push(`workflow:organization:${reference.organizationId}`);
  }
  invalidateGraphqlCache(tags);
};

export const isWebhookBasedWorkflow = (workflow: WorkflowDefinition | null | undefined): boolean => {
  const startNode = workflow?.nodes?.find((node) => node.modelId === 'start');
  const runtime = toRecord(startNode?.runtime);
  return toSafeString(runtime.triggerSource).toLowerCase() === 'webhook';
};

const queryWorkflowReference = async (
  supabase: any,
  workflowId: string,
  currentUserId: string,
  scope: WorkflowHistoryScope,
  organizationId: string | null = null,
): Promise<WorkflowReference | null> => {
  if (scope === 'global') {
    const data = await WorkflowEntity.readActiveGlobalById(workflowId);

    if (!data?.id) {
      return null;
    }

    return {
      workflowId,
      scope,
      organizationId: null,
      ownerUserId: null,
    };
  }

  if (scope === 'organization') {
    const organizationIdSafe = toSafeString(organizationId);
    if (!organizationIdSafe) {
      return null;
    }

    const data = await WorkflowEntity.readActiveOrganizationById(workflowId, organizationIdSafe);

    if (!data?.id) {
      return null;
    }

    return {
      workflowId,
      scope,
      organizationId: organizationIdSafe,
      ownerUserId: null,
    };
  }
  const data = await WorkflowEntity.readActivePersonalById(workflowId, currentUserId);

  if (!data?.id) {
    return null;
  }

  return {
    workflowId,
    scope,
    organizationId: null,
    ownerUserId: toSafeString(data.user_id) || null,
  };
};

const listWorkflowVersionsRows = async (supabase: any, reference: WorkflowReference) => WorkflowVersionEntity.findByWorkflowId(reference.workflowId);

const countVersionExecutions = async (supabase: any, versionIds: string[]): Promise<Map<string, number>> => {
  if (!versionIds.length) {
    return new Map();
  }
  const rows = await WorkflowExecutionEntity.listVersionIdRows(versionIds);
  return rows.reduce((acc, row) => {
    const versionId = toSafeString(row.workflow_version_id);
    if (!versionId) {
      return acc;
    }
    acc.set(versionId, (acc.get(versionId) || 0) + 1);
    return acc;
  }, new Map<string, number>());
};

export const resolveWorkflowReference = async (params: {
  currentUserId: string;
  organizationId?: string | null;
  scope: unknown;
  supabase: any;
  workflowId: string;
}): Promise<WorkflowReference | null> =>
  queryWorkflowReference(
    params.supabase,
    params.workflowId,
    params.currentUserId,
    normalizeScope(params.scope),
    toSafeString(params.organizationId) || null,
  );

export const resolveCurrentWorkflowVersionId = async (supabase: any, reference: WorkflowReference): Promise<string | null> =>
  WorkflowVersionEntity.readCurrentVersionId(reference.workflowId);

export const createWorkflowVersionOnPublish = async (params: {
  actorUserId: string | null;
  description?: string | null;
  name?: string | null;
  reference: WorkflowReference;
  supabase: any;
  workflowSnapshot: WorkflowDefinition;
  publishedAt: string;
}): Promise<void> => {
  const versionRows = await listWorkflowVersionsRows(params.supabase, params.reference);
  const nextVersionNumber = versionRows.reduce((maxValue, row) => Math.max(maxValue, Number(row.version_number) || 0), 0) + 1;

  await WorkflowVersionEntity.clearCurrentByWorkflowId(params.reference.workflowId);

  const row: WorkflowVersionRow = {
    id: randomUUID(),
    workflow_id: params.reference.workflowId,
    version_number: nextVersionNumber,
    is_current: true,
    published_at: params.publishedAt,
    published_by_user_id: params.actorUserId,
    workflow_name: toSafeString(params.name) || toSafeString(params.workflowSnapshot.metadata?.name),
    workflow_description: toSafeString(params.description) || toSafeString(params.workflowSnapshot.metadata?.description),
    workflow_snapshot: normalizeWorkflowSnapshotIdentity({
      workflow: params.workflowSnapshot,
      workflowId: params.reference.workflowId,
      workflowName: params.name || null,
      workflowDescription: params.description || null,
      workflowScope: params.reference.scope,
    }),
    created_at: params.publishedAt,
    updated_at: params.publishedAt,
  };

  await WorkflowVersionEntity.create(row);
  invalidateWorkflowHistoryCache(params.reference);
};

export const listWorkflowVersions = async (params: {
  currentUserId: string;
  organizationId?: string | null;
  scope: unknown;
  supabase: any;
  workflowId: string;
}) => {
  const reference = await resolveWorkflowReference(params);
  if (!reference) {
    return [];
  }

  const rows = await listWorkflowVersionsRows(params.supabase, reference);
  const executionCounts = await countVersionExecutions(params.supabase, rows.map((row) => toSafeString(row.id)).filter(Boolean));

  return rows.map((row) => {
    const versionId = toSafeString(row.id);
    const versionNumber = Number(row.version_number) || 1;
    const executionCount = executionCounts.get(versionId) || 0;
    return {
      id: versionId,
      workflowId: reference.workflowId,
      workflowScope: reference.scope,
      organizationId: reference.organizationId,
      versionNumber,
      label: `v${versionNumber}`,
      isCurrent: row.is_current === true,
      publishedAt: row.published_at || null,
      createdAt: row.created_at,
      executionCount,
      referencedByExecutions: executionCount > 0,
      workflowSnapshot: normalizeWorkflowSnapshotIdentity({
        workflow: (row.workflow_snapshot || null) as unknown as WorkflowDefinition | null,
        workflowId: reference.workflowId,
        workflowScope: reference.scope,
      }),
    };
  });
};

export const deleteWorkflowVersions = async (params: {
  currentUserId: string;
  isRootUser: boolean;
  supabase: any;
  versionIds: string[];
}): Promise<{ blockedIds: string[]; deletedIds: string[] }> => {
  const requestedIds = params.versionIds.map(toSafeString).filter(Boolean);
  if (!requestedIds.length) {
    return { blockedIds: [], deletedIds: [] };
  }

  const versionRows = await WorkflowVersionEntity.findByIds(requestedIds);
  const executionRows = await WorkflowExecutionEntity.listVersionIdRows(requestedIds);

  const referencedIds = new Set(
    (Array.isArray(executionRows) ? executionRows : []).map((row) => toSafeString(row.workflow_version_id)).filter(Boolean),
  );
  const workflowIds = (Array.isArray(versionRows) ? versionRows : []).map((row) => toSafeString(row.workflow_id)).filter(Boolean);
  const workflowRows = workflowIds.length ? await WorkflowEntity.findByIds(workflowIds, 'id,user_id,organization_id,is_global') : [];
  const workflowById = (Array.isArray(workflowRows) ? workflowRows : []).reduce((acc, row) => {
    acc[toSafeString(row.id)] = row;
    return acc;
  }, {} as Record<string, Record<string, any>>);

  const blockedIds: string[] = [];
  const deletableIds: string[] = [];
  for (const row of Array.isArray(versionRows) ? versionRows : []) {
    const versionId = toSafeString(row.id);
    const workflowId = toSafeString(row.workflow_id);
    const workflowRow = workflowById[workflowId];
    const ownerUserId = toSafeString(workflowRow?.user_id);
    const isGlobalVersion = workflowRow?.is_global === true;
    const isOrganizationVersion = Boolean(toSafeString(workflowRow?.organization_id));
    const canDelete =
      !row.is_current &&
      !referencedIds.has(versionId) &&
      (isGlobalVersion ? params.isRootUser : isOrganizationVersion ? true : ownerUserId === params.currentUserId);
    if (canDelete) {
      deletableIds.push(versionId);
      continue;
    }
    blockedIds.push(versionId);
  }

  if (deletableIds.length) {
    await WorkflowVersionEntity.deleteByIds(deletableIds);
    invalidateGraphqlCache(['workflow:catalog:', 'workflow:history:', 'workflow:running:']);
  }

  return {
    blockedIds,
    deletedIds: deletableIds,
  };
};

export const listWorkflowExecutions = async (params: {
  currentUserId: string;
  filter?: Record<string, unknown> | null;
  limit?: number | null;
  offset?: number | null;
  organizationId?: string | null;
  scope: unknown;
  supabase: any;
  workflowId: string;
}) => {
  const reference = await resolveWorkflowReference(params);
  if (!reference) {
    return [];
  }

  const rows = await reconcileTrackedExecutionRows({
    supabase: params.supabase,
    rows: await WorkflowExecutionEntity.findByWorkflowId(reference.workflowId),
    workflowReferenceById: {
      [reference.workflowId]: reference,
    },
  });
  const filter = toRecord(params.filter);
  const versionRows = await listWorkflowVersionsRows(params.supabase, reference);
  const versionLabelById = versionRows.reduce<Record<string, string>>((acc, row) => {
    const versionId = toSafeString(row.id);
    if (!versionId) {
      return acc;
    }
    acc[versionId] = `v${Number(row.version_number) || 1}`;
    return acc;
  }, {});

  const filteredRows = rows.filter((row) => {
    const status = toSafeString(filter.status);
    const workflowVersionId = toSafeString(filter.workflowVersionId);
    const createdFrom = toSafeString(filter.createdFrom);
    const createdTo = toSafeString(filter.createdTo);
    const durationMsMin = Number(filter.durationMsMin);
    const durationMsMax = Number(filter.durationMsMax);
    const createdAt = new Date(row.created_at).getTime();
    const durationMs = Number(row.duration_ms);

    if (status && toSafeString(row.status) !== status) {
      return false;
    }
    if (workflowVersionId && toSafeString(row.workflow_version_id) !== workflowVersionId) {
      return false;
    }
    if (createdFrom && createdAt < new Date(createdFrom).getTime()) {
      return false;
    }
    if (createdTo && createdAt > new Date(`${createdTo}T23:59:59.999Z`).getTime()) {
      return false;
    }
    if (Number.isFinite(durationMsMin) && (!Number.isFinite(durationMs) || durationMs < durationMsMin)) {
      return false;
    }
    if (Number.isFinite(durationMsMax) && (!Number.isFinite(durationMs) || durationMs > durationMsMax)) {
      return false;
    }
    return true;
  });
  const limit = Number(params.limit) > 0 ? Number(params.limit) : 0;
  const offset = Number(params.offset) > 0 ? Number(params.offset) : 0;
  const pagedRows = limit ? filteredRows.slice(offset, offset + limit) : filteredRows.slice(offset);

  return pagedRows.map((row) => createExecutionRecord(row, reference, versionLabelById[toSafeString(row.workflow_version_id)] || null));
};

export const getWorkflowExecution = async (params: {
  currentUserId: string;
  executionId?: string | null;
  runId?: string | null;
  organizationId?: string | null;
  scope: unknown;
  supabase: any;
  workflowId: string;
}) => {
  const reference = await resolveWorkflowReference(params);
  if (!reference) return null;
  const executionId = toSafeString(params.executionId);
  const runId = toSafeString(params.runId);
  if (!executionId && !runId) return null;
  const data = await WorkflowExecutionEntity.findByWorkflowExecution({
    workflowId: reference.workflowId,
    executionId,
    runId,
  });
  if (!data) return null;
  const rows = await reconcileTrackedExecutionRows({
    supabase: params.supabase,
    rows: [data],
    workflowReferenceById: { [reference.workflowId]: reference },
  });
  const row = rows[0] || data;
  const workflowVersionLabel = await readWorkflowVersionLabel(params.supabase, toSafeString(row.workflow_version_id) || null);
  return createExecutionRecord(row, reference, workflowVersionLabel);
};

export const listWorkflowExecutionLogs = async (params: {
  currentUserId: string;
  executionId?: string | null;
  limit?: number | null;
  offset?: number | null;
  organizationId?: string | null;
  runId?: string | null;
  scope: unknown;
  supabase: any;
  workflowId: string;
}) => {
  const execution = await getWorkflowExecution(params);
  const logs = Array.isArray(execution?.logs) ? execution.logs : [];
  const offset = Math.max(0, Number(params.offset) || 0);
  const limit = Math.max(0, Number(params.limit) || 0);
  return {
    executionId: execution?.id || null,
    runId: execution?.runId || null,
    workflowId: execution?.workflowId || null,
    count: logs.length,
    logs: limit ? logs.slice(offset, offset + limit) : logs.slice(offset),
  };
};

export const listWorkflowRunningStatuses = async (params: {
  currentUserId: string;
  includeExecutions?: boolean;
  organizationId?: string | null;
  supabase: any;
  workflowIds: string[];
}) => {
  const normalizedOrganizationId = toSafeString(params.organizationId) || null;
  const references = (
    await Promise.all(
      params.workflowIds.map((workflowId) =>
        Promise.all(
          normalizedOrganizationId
            ? [queryWorkflowReference(params.supabase, workflowId, params.currentUserId, 'organization', normalizedOrganizationId)]
            : [
                queryWorkflowReference(params.supabase, workflowId, params.currentUserId, 'user'),
                queryWorkflowReference(params.supabase, workflowId, params.currentUserId, 'global'),
              ],
        ).then((matches) => matches.find(Boolean) || null),
      ),
    )
  ).filter((value): value is WorkflowReference => Boolean(value));

  const workflowIds = references.map((reference) => reference.workflowId).filter(Boolean) as string[];

  const trackedRows = await reconcileTrackedExecutionRows({
    supabase: params.supabase,
    rows: await listActiveExecutionRows(params.supabase, workflowIds),
    workflowReferenceById: references.reduce<Record<string, WorkflowReference>>((acc, reference) => {
      acc[reference.workflowId] = reference;
      return acc;
    }, {}),
  });
  const latestRows = await listLatestExecutionRows(params.supabase, workflowIds);

  return references.map((reference) => {
    const workflowRows = trackedRows.filter((row) => toSafeString(row.workflow_id) === reference.workflowId);
    const activeExecutionCount = workflowRows.filter((row) => toSafeString(row.status) === 'running').length;
    const queuedExecutionCount = workflowRows.filter((row) => toSafeString(row.status) === 'queued').length;
    const latestRow = latestRows[reference.workflowId] || null;
    return {
      workflowId: reference.workflowId,
      isRunning: activeExecutionCount > 0,
      activeExecutionCount,
      queuedExecutionCount,
      activeExecutions:
        params.includeExecutions === true
          ? workflowRows.map((row) => ({
              id: toSafeString(row.id),
              runId: toSafeString(row.run_id) || null,
              status: toSafeString(row.status),
              createdAt: row.created_at || null,
            }))
          : [],
      latestStatus: activeExecutionCount > 0 ? 'running' : queuedExecutionCount > 0 ? 'queued' : 'idle',
      latestRunAt: toSafeString(latestRow?.created_at) || null,
      latestCompletedAt: toSafeString(latestRow?.completed_at) || null,
    };
  });
};

const emitExecutionUpdateForRow = async (
  supabase: any,
  reference: WorkflowReference,
  row: Record<string, any> | null,
  broadcast: WorkflowBroadcast,
): Promise<void> => {
  if (!row) {
    return;
  }
  const workflowVersionLabel = await readWorkflowVersionLabel(supabase, toSafeString(row.workflow_version_id) || null);
  emitWorkflowExecutionUpdate({
    broadcastId: broadcast.broadcastId,
    broadcastChannelName: broadcast.broadcastChannelName,
    execution: createExecutionRecord(row, reference, workflowVersionLabel),
  });
};

const emitCatalogStatusForReference = async (
  supabase: any,
  reference: WorkflowReference,
  latestStatus: string,
  broadcast: WorkflowBroadcast,
): Promise<void> => {
  const workflowRows = await reconcileTrackedExecutionRows({
    supabase,
    broadcast,
    rows: await listActiveExecutionRows(supabase, [reference.workflowId]),
    workflowReferenceById: {
      [reference.workflowId]: reference,
    },
  });
  const activeExecutionCount = workflowRows.filter((row) => toSafeString(row.status) === 'running').length;
  const queuedExecutionCount = workflowRows.filter((row) => toSafeString(row.status) === 'queued').length;
  const resolvedLatestStatus = activeExecutionCount > 0 ? 'running' : queuedExecutionCount > 0 ? 'queued' : latestStatus;
  const latestRows = await listLatestExecutionRows(supabase, [reference.workflowId]);
  const latestRow = latestRows[reference.workflowId] || null;
  emitWorkflowCatalogStatus({
    broadcastId: broadcast.broadcastId,
    broadcastChannelName: broadcast.broadcastChannelName,
    workflowId: reference.workflowId,
    isRunning: activeExecutionCount > 0,
    activeExecutionCount,
    queuedExecutionCount,
    latestStatus: resolvedLatestStatus,
    latestRunAt: toSafeString(latestRow?.created_at) || null,
    latestCompletedAt: toSafeString(latestRow?.completed_at) || null,
  });
};

export const transitionWorkflowExecutionRecord = async (params: {
  broadcastChannelName: string;
  broadcastId: string;
  executionId: string;
  expectedStatuses?: string[];
  extraFields?: Record<string, unknown>;
  latestStatus?: string;
  status: string;
  supabase: any;
  workflowReference: WorkflowReference;
}): Promise<void> => {
  const completedAt = params.status === 'completed' || params.status === 'failed' ? new Date().toISOString() : null;
  const update = {
    ...(params.extraFields || {}),
    status: params.status,
    updated_at: new Date().toISOString(),
    ...(completedAt ? { completed_at: completedAt } : {}),
  };
  const data = await WorkflowExecutionEntity.updateById({
    id: params.executionId,
    patch: update,
    expectedStatuses: params.expectedStatuses,
  });
  if (!data) {
    return;
  }
  invalidateWorkflowHistoryCache(params.workflowReference);
  void emitExecutionUpdateForRow(params.supabase, params.workflowReference, data || null, {
    broadcastId: params.broadcastId,
    broadcastChannelName: params.broadcastChannelName,
  }).catch(() => undefined);
  void emitCatalogStatusForReference(params.supabase, params.workflowReference, params.latestStatus || params.status, {
    broadcastId: params.broadcastId,
    broadcastChannelName: params.broadcastChannelName,
  }).catch(() => undefined);
};

export const updateWorkflowExecutionRecord = async (params: {
  executionId: string;
  patch: Record<string, unknown>;
  supabase: any;
}): Promise<void> => {
  await WorkflowExecutionEntity.updateById({
    id: params.executionId,
    patch: {
      ...(params.patch || {}),
      updated_at: new Date().toISOString(),
    },
  });
};

export const appendWorkflowExecutionLog = async (params: { executionId: string; log: WorkflowRunLogEvent; supabase: any }): Promise<void> => {
  const data = await WorkflowExecutionEntity.readLogsRowById(params.executionId);
  const logs = Array.isArray(data?.logs) ? data.logs : [];
  const nextLogs = [...logs, cloneJson(params.log)];
  await WorkflowExecutionEntity.updateById({
    id: params.executionId,
    patch: { logs: nextLogs, updated_at: new Date().toISOString() },
  });
};

export const finalizeWorkflowExecutionRecord = async (params: {
  broadcastChannelName: string;
  broadcastId: string;
  errorMessage?: string | null;
  executionId: string;
  extraFields?: Record<string, unknown>;
  logs?: WorkflowRunLogEvent[];
  responsePayload?: unknown;
  status: 'completed' | 'failed';
  supabase: any;
  workflowReference: WorkflowReference;
  workflowSnapshot?: WorkflowDefinition | null;
}): Promise<void> => {
  const current = await WorkflowExecutionEntity.readFinalizeSeedRow(params.executionId);

  const completedAt = new Date().toISOString();
  const startedAt = toSafeString(current?.created_at) || completedAt;
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const data = await WorkflowExecutionEntity.updateById({
    id: params.executionId,
    patch: {
      ...(params.extraFields || {}),
      status: params.status,
      error_message: params.errorMessage || null,
      response_payload: resolveStoredResponsePayload(current?.response_payload, params.responsePayload),
      workflow_snapshot: normalizeWorkflowSnapshotIdentity({
        workflow:
          typeof params.workflowSnapshot === 'undefined'
            ? ((current?.workflow_snapshot || null) as unknown as WorkflowDefinition | null)
            : params.workflowSnapshot || null,
        workflowId: params.workflowReference.workflowId,
        workflowScope: params.workflowReference.scope,
      }),
      logs: resolveStoredLogs(current?.logs, params.logs),
      duration_ms: durationMs,
      updated_at: completedAt,
      completed_at: completedAt,
    } as unknown as Partial<WorkflowExecutionRow>,
  });
  invalidateWorkflowHistoryCache(params.workflowReference);
  void emitExecutionUpdateForRow(params.supabase, params.workflowReference, data || null, {
    broadcastId: params.broadcastId,
    broadcastChannelName: params.broadcastChannelName,
  }).catch(() => undefined);
  void emitCatalogStatusForReference(params.supabase, params.workflowReference, params.status, {
    broadcastId: params.broadcastId,
    broadcastChannelName: params.broadcastChannelName,
  }).catch(() => undefined);
};

export const createWorkflowExecutionTracker = async (params: {
  assistantMessageId?: string | null;
  broadcastChannelName: string;
  broadcastId: string;
  chatMessageId?: string | null;
  chatSessionId?: string | null;
  initialStatus?: 'queued' | 'running';
  requestPayload?: unknown;
  responsePayload?: unknown;
  runId: string;
  scopeId?: string | null;
  scopeType?: string | null;
  supabase: any;
  triggerType: string;
  userId?: string | null;
  workflowReference: WorkflowReference;
  workflowSource?: WorkflowSource | null;
  workflowSnapshot?: WorkflowDefinition | null;
  workflowVersionId?: string | null;
}): Promise<WorkflowExecutionTracker> => {
  const executionId = randomUUID();
  const startedAt = new Date().toISOString();
  const entries: WorkflowRunLogEvent[] = [];
  const pendingWrites = new Set<Promise<unknown>>();

  const row = {
    id: executionId,
    user_id: params.userId || null,
    chat_session_id: params.chatSessionId || null,
    chat_message_id: params.chatMessageId || null,
    assistant_message_id: params.assistantMessageId || null,
    scope_type: params.scopeType || null,
    scope_id: params.scopeId || null,
    workflow_source: params.workflowSource || workflowSourceForScope(params.workflowReference.scope),
    workflow_id: params.workflowReference.workflowId,
    workflow_version_id: params.workflowVersionId || null,
    run_id: params.runId,
    trigger_type: params.triggerType,
    status: params.initialStatus || 'running',
    error_message: null,
    logs: [],
    request_payload: params.requestPayload || null,
    response_payload: params.responsePayload ?? null,
    workflow_snapshot: normalizeWorkflowSnapshotIdentity({
      workflow: params.workflowSnapshot || null,
      workflowId: params.workflowReference.workflowId,
      workflowScope: params.workflowReference.scope,
    }),
    duration_ms: null,
    created_at: startedAt,
    updated_at: startedAt,
    completed_at: null,
  } as unknown as WorkflowExecutionRow;

  const data = await WorkflowExecutionEntity.create(row);

  if (process.env.CHAT_PARITY_FAST_WORKFLOW_TRACKER !== '1') {
    invalidateWorkflowHistoryCache(params.workflowReference);
    void emitExecutionUpdateForRow(params.supabase, params.workflowReference, data || null, {
      broadcastId: params.broadcastId,
      broadcastChannelName: params.broadcastChannelName,
    }).catch(() => undefined);
    void emitCatalogStatusForReference(params.supabase, params.workflowReference, params.initialStatus || 'running', {
      broadcastId: params.broadcastId,
      broadcastChannelName: params.broadcastChannelName,
    }).catch(() => undefined);
  }

  return {
    id: executionId,
    recordEvent: (event: WorkflowRunLogEvent) => {
      entries.push(cloneJson(event));
      emitWorkflowLogEvent({
        broadcastId: params.broadcastId,
        broadcastChannelName: params.broadcastChannelName,
        workflowId: params.workflowReference.workflowId,
        event,
      });
      const writePromise = WorkflowExecutionEntity.updateById({
        id: executionId,
        patch: {
          logs: cloneJson(entries),
          updated_at: new Date().toISOString(),
        } as unknown as Partial<WorkflowExecutionRow>,
      })
        .then(() => undefined)
        .finally(() => pendingWrites.delete(writePromise));
      pendingWrites.add(writePromise);
      void writePromise;
    },
    finalize: async ({ status, errorMessage, responsePayload, workflowSnapshot, extraFields }) => {
      void Promise.allSettled(Array.from(pendingWrites));
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      const finalizedRow = await WorkflowExecutionEntity.updateById({
        id: executionId,
        patch: {
          ...(extraFields || {}),
          status,
          error_message: errorMessage || null,
          response_payload: responsePayload || null,
          workflow_snapshot: normalizeWorkflowSnapshotIdentity({
            workflow: workflowSnapshot || params.workflowSnapshot || null,
            workflowId: params.workflowReference.workflowId,
            workflowScope: params.workflowReference.scope,
          }),
          logs: cloneJson(entries),
          duration_ms: durationMs,
          updated_at: completedAt,
          completed_at: completedAt,
        } as unknown as Partial<WorkflowExecutionRow>,
      });
      invalidateWorkflowHistoryCache(params.workflowReference);
      void emitExecutionUpdateForRow(params.supabase, params.workflowReference, finalizedRow || null, {
        broadcastId: params.broadcastId,
        broadcastChannelName: params.broadcastChannelName,
      }).catch(() => undefined);
      void emitCatalogStatusForReference(params.supabase, params.workflowReference, status, {
        broadcastId: params.broadcastId,
        broadcastChannelName: params.broadcastChannelName,
      }).catch(() => undefined);
    },
  };
};
