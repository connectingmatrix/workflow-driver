import { randomUUID } from 'crypto';
import { cloneJson, toSafeString } from 'giga-ai-helper';
import { BadRequestError } from 'routing-controllers';
import { SupabaseClientAdmin } from '@giga/general/decorators/integration/supabase-admin-client';
import { WorkflowAssignmentEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowAssignmentEntity';
import { WorkflowEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowEntity';
import { WorkflowVersionEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowVersionEntity';
import {
  assertWorkflowScopeAssignmentAllowed,
  buildWorkflowSearchText,
  createWorkflowSecret,
  isRestrictedScope,
  requireWorkflowScopeType,
} from '@giga/general/services/graphql/resolvers/integration/base';
import { bindWorkflowCredentials } from '@connectingmatrix/workflows/services/workflow/runtime/bindWorkflowCredentials';
import { normalizeWorkflowSnapshotIdentity } from '@connectingmatrix/workflows/services/workflow/runtime/workflow-identity';
import type { WorkflowDefinition } from '@connectingmatrix/workflows/services/workflow/contracts/types';
import type { OrganizationAccessContext } from '@giga/shared/types/contracts/org.types';
import type { WorkflowCollectionObject, WorkflowDeleteArgs, WorkflowInsertArgs, WorkflowUpdateArgs } from '@giga/shared/types';

const getAdminSupabase = () => SupabaseClientAdmin();

type WorkflowAssignmentSlot = {
  scopeType: 'CHANNEL' | 'CATEGORY' | 'SUBJECT' | 'POST';
  scopeId: string | null;
  userId: string | null;
  organizationId: string | null;
};

type WorkflowAssignmentUpsertInput = WorkflowAssignmentSlot & {
  id: string;
  workflowId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const createWorkflowVersionOnPublish = async (params: {
  actorUserId: string | null;
  description?: string | null;
  name?: string | null;
  reference: { workflowId: string; scope?: string; organizationId?: string | null; ownerUserId?: string | null };
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

type WorkflowAssignmentCollectionFilter = {
  id?: unknown;
  workflow_id?: unknown;
  scope_id?: unknown;
  user_id?: unknown;
  organization_id?: unknown;
  scope_type?: unknown;
};

function normalizeFilterText(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeNullableId(value: unknown): string | null {
  return normalizeFilterText(value);
}

function normalizeWorkflowAssignmentMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function hasEqFilter(filterValue: unknown): filterValue is { eq: unknown } {
  return Boolean(filterValue && typeof filterValue === 'object' && Object.prototype.hasOwnProperty.call(filterValue, 'eq'));
}

function hasInFilter(filterValue: unknown): filterValue is { in: unknown[] } {
  return Boolean(filterValue && typeof filterValue === 'object' && Object.prototype.hasOwnProperty.call(filterValue, 'in'));
}

function getEqFilterValue(filterValue: unknown): string | null | undefined {
  if (!hasEqFilter(filterValue)) return undefined;
  if ((filterValue as { eq?: unknown }).eq == null) return null;
  const normalized = String((filterValue as { eq?: unknown }).eq).trim();
  return normalized || null;
}

function getInFilterValues(filterValue: unknown, normalize: (value: unknown) => string | null = normalizeFilterText): string[] | undefined {
  if (!hasInFilter(filterValue)) return undefined;
  const values = Array.isArray((filterValue as { in?: unknown[] }).in) ? ((filterValue as { in?: unknown[] }).in as unknown[]) : [];
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) result.push(normalized);
  }
  return result;
}

function getNullFilterValue(filterValue: unknown): 'NULL' | 'NOT_NULL' | undefined {
  if (!filterValue || typeof filterValue !== 'object' || !Object.prototype.hasOwnProperty.call(filterValue, 'is')) return undefined;
  const normalized = String((filterValue as { is?: unknown }).is || '')
    .trim()
    .toUpperCase();
  if (normalized === 'NULL' || normalized === 'NOT_NULL') return normalized;
  return undefined;
}

function matchesWorkflowAssignmentFilterValue(
  rowValue: unknown,
  filterValue: unknown,
  normalize: (value: unknown) => string | null = normalizeFilterText,
) {
  const nullFilter = getNullFilterValue(filterValue);
  if (nullFilter === 'NULL') return rowValue == null;
  if (nullFilter === 'NOT_NULL') return rowValue != null;
  const inValues = getInFilterValues(filterValue, normalize);
  if (inValues !== undefined) return inValues.includes(normalize(rowValue));
  const eqValue = getEqFilterValue(filterValue);
  if (eqValue === undefined) return true;
  if (eqValue === null) return rowValue == null;
  return normalize(rowValue) === normalize(eqValue);
}

function filterWorkflowAssignmentRows(rows: Array<Record<string, unknown>>, filter: WorkflowAssignmentCollectionFilter = {}) {
  return rows.filter((row) => {
    if (!matchesWorkflowAssignmentFilterValue(row.id, filter.id)) return false;
    if (!matchesWorkflowAssignmentFilterValue(row.workflow_id, filter.workflow_id)) return false;
    if (!matchesWorkflowAssignmentFilterValue(row.scope_id, filter.scope_id)) return false;
    if (!matchesWorkflowAssignmentFilterValue(row.user_id, filter.user_id)) return false;
    if (!matchesWorkflowAssignmentFilterValue(row.organization_id, filter.organization_id)) return false;
    if (!matchesWorkflowAssignmentFilterValue(row.scope_type, filter.scope_type, requireWorkflowScopeType)) return false;
    return true;
  });
}

function normalizeAssignmentSlot(input: {
  scopeType?: unknown;
  scopeId?: unknown;
  userId?: unknown;
  organizationId?: unknown;
}): WorkflowAssignmentSlot {
  const scopeType = requireWorkflowScopeType(normalizeNullableId(input.scopeType) || undefined);
  const scopeId = normalizeNullableId(input.scopeId);
  const userId = normalizeNullableId(input.userId);
  const organizationId = normalizeNullableId(input.organizationId);
  if (userId && organizationId) throw new BadRequestError('user_id and organization_id cannot both be set.');
  if (userId) {
    if (!scopeId) throw new BadRequestError('user exact assignment requires scope_id.');
    return { scopeType, scopeId, userId, organizationId: null };
  }
  if (organizationId) return { scopeType, scopeId, userId: null, organizationId };
  if (!scopeId) return { scopeType, scopeId: null, userId: null, organizationId: null };
  throw new BadRequestError('Exact-scope default assignments are removed. Use user/org exact assignments or scope defaults.');
}

function readWorkflowOrganizationId(workflow?: WorkflowDefinition | null) {
  const metadata = workflow?.metadata as Record<string, unknown> | undefined;
  const scope = (metadata?.scope || null) as Record<string, unknown> | null;
  return String(scope?.organizationId || metadata?.organizationId || '').trim() || null;
}

async function preparePublishedWorkflowUpdate(input: {
  currentUserId: string;
  effectiveRoot: boolean;
  organizationId?: string | null;
  scope: 'user' | 'organization' | 'global';
  set: Record<string, unknown>;
  workflowId: string;
}) {
  if (
    String(input.set.status || '')
      .trim()
      .toLowerCase() !== 'published'
  )
    return input.set;
  const workflow = cloneJson((input.set.workflow || input.set.published_workflow || null) as WorkflowDefinition | null);
  if (!workflow) throw new BadRequestError('workflow is required to publish.');
  const description = String(input.set.description || workflow.metadata?.description || '').trim();
  const name = String(input.set.name || workflow.metadata?.name || 'Workflow').trim() || 'Workflow';
  const boundWorkflow = await bindWorkflowCredentials({
    workflow,
    scope: input.scope,
    organizationId: input.organizationId || readWorkflowOrganizationId(workflow),
    supabase: getAdminSupabase(),
    userId: input.currentUserId,
    effectiveRoot: input.effectiveRoot,
  });
  const publishedAt = String(input.set.published_at || '').trim() || new Date().toISOString();
  return {
    ...input.set,
    workflow: boundWorkflow,
    published_workflow: normalizeWorkflowSnapshotIdentity({
      workflow: boundWorkflow,
      workflowId: input.workflowId,
      workflowName: name,
      workflowDescription: description,
      workflowScope: input.scope,
    }),
    published_at: publishedAt,
    updated_at: input.set.updated_at || publishedAt,
  };
}

async function upsertWorkflowAssignmentSlot(input: WorkflowAssignmentUpsertInput) {
  const existing = await WorkflowAssignmentEntity.readLatestSlot({
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    userId: input.userId,
    organizationId: input.organizationId,
  });
  if (existing?.id) {
    return WorkflowAssignmentEntity.updateById(String(existing.id), {
      workflow_id: input.workflowId,
      metadata: input.metadata,
      updated_at: input.updatedAt,
    });
  }
  return WorkflowAssignmentEntity.create({
    id: input.id,
    workflow_id: input.workflowId,
    scope_type: input.scopeType,
    scope_id: input.scopeId,
    user_id: input.userId,
    organization_id: input.organizationId,
    metadata: input.metadata,
    created_at: input.createdAt,
    updated_at: input.updatedAt,
  });
}

export async function createAiWorkflowsCollectionData(input: {
  objects?: WorkflowInsertArgs['objects'];
  currentUserId: string;
  effectiveRoot: boolean;
}) {
  const now = new Date().toISOString();
  const rowsToInsert = (input.objects || []).map((item) => {
    const workflow = cloneJson((item.workflow ?? {}) as WorkflowDefinition) as WorkflowDefinition;
    const description = item.description ?? '';
    return {
      ...item,
      id: item.id ?? randomUUID(),
      user_id: input.currentUserId,
      name: item.name || 'New Workflow',
      description,
      metadata: item.metadata || {},
      workflow,
      published_workflow: item.published_workflow ?? null,
      published_at: item.published_at ?? null,
      search_text: item.search_text || buildWorkflowSearchText(workflow, description),
      status: item.status || 'draft',
      webhook_secret: item.webhook_secret || createWorkflowSecret(),
      is_active: item.is_active !== false,
      created_at: item.created_at || now,
      updated_at: item.updated_at || now,
    };
  });
  const records: WorkflowCollectionObject[] = [];
  for (const row of rowsToInsert) records.push((await WorkflowEntity.create(row)) as unknown as WorkflowCollectionObject);
  for (const row of records) {
    if (String(row.status || '').toLowerCase() !== 'published') continue;
    await createWorkflowVersionOnPublish({
      supabase: getAdminSupabase(),
      actorUserId: input.currentUserId,
      reference: { workflowId: row.id, scope: 'user', organizationId: null, ownerUserId: input.currentUserId },
      workflowSnapshot: cloneJson((row.workflow ?? {}) as WorkflowDefinition) as WorkflowDefinition,
      publishedAt: row.published_at || row.updated_at,
      name: row.name,
      description: row.description,
    });
  }
  return { affectedCount: records.length, records };
}

export async function updateAiWorkflowsCollectionData(input: {
  filter?: WorkflowUpdateArgs['filter'];
  set?: WorkflowUpdateArgs['set'];
  currentUserId: string;
  effectiveRoot: boolean;
}) {
  const workflowId = input.filter?.id?.eq ?? null;
  if (!workflowId) return { affectedCount: 0, records: [] as WorkflowCollectionObject[] };
  const nextSet = await preparePublishedWorkflowUpdate({
    currentUserId: input.currentUserId,
    effectiveRoot: input.effectiveRoot,
    organizationId: null,
    scope: 'user',
    workflowId,
    set: {
      ...(input.set || {}),
      updated_at: input.set?.updated_at || new Date().toISOString(),
      user_id: input.currentUserId,
    },
  });
  const updated = await WorkflowEntity.updateOwnedRow({
    workflowId,
    currentUserId: input.currentUserId,
    organizationId: null,
    effectiveRoot: input.effectiveRoot,
    patch: nextSet,
  });
  const records = updated ? ([updated as unknown as WorkflowCollectionObject] as WorkflowCollectionObject[]) : [];
  if (String(input.set?.status || '').toLowerCase() === 'published') {
    for (const row of records) {
      await createWorkflowVersionOnPublish({
        supabase: getAdminSupabase(),
        actorUserId: input.currentUserId,
        reference: { workflowId: row.id, scope: 'user', organizationId: null, ownerUserId: input.currentUserId },
        workflowSnapshot: cloneJson(((row.published_workflow || row.workflow) ?? {}) as WorkflowDefinition) as WorkflowDefinition,
        publishedAt: row.published_at || String(input.set?.updated_at || ''),
        name: row.name,
        description: row.description,
      });
    }
  }
  return { affectedCount: records.length, records };
}

export async function createAiWorkflowAssignmentsCollectionData(input: {
  objects?: WorkflowInsertArgs['objects'];
  currentUserId: string;
  effectiveRoot: boolean;
}) {
  const now = new Date().toISOString();
  const records: WorkflowCollectionObject[] = [];
  for (const item of input.objects || []) {
    const workflowId = normalizeNullableId(item?.workflow_id);
    if (!workflowId) throw new BadRequestError('workflow_id is required.');
    const slot = normalizeAssignmentSlot({
      scopeType: item?.scope_type,
      scopeId: item?.scope_id,
      userId: item?.user_id,
      organizationId: item?.organization_id,
    });
    if (slot.userId && slot.userId !== input.currentUserId && !input.effectiveRoot)
      throw new BadRequestError('Cannot create workflow assignment for another user.');
    if (!slot.userId && !slot.organizationId && !input.effectiveRoot) {
      throw new BadRequestError('Only root users can manage global default workflow assignments.');
    }
    await assertWorkflowScopeAssignmentAllowed({
      supabase: getAdminSupabase(),
      currentUserId: input.currentUserId,
      workflowId,
      organizationId: slot.organizationId,
      scopeType: slot.scopeType,
      scopeId: slot.scopeId,
      action: 'create',
    });
    const upserted = await upsertWorkflowAssignmentSlot({
      id: normalizeNullableId(item?.id) || randomUUID(),
      workflowId,
      scopeType: slot.scopeType,
      scopeId: slot.scopeId,
      userId: slot.userId,
      organizationId: slot.organizationId,
      metadata: normalizeWorkflowAssignmentMetadata(item?.metadata),
      createdAt: normalizeNullableId(item?.created_at) || now,
      updatedAt: normalizeNullableId(item?.updated_at) || now,
    });
    if (upserted) records.push(upserted as WorkflowCollectionObject);
  }
  return { affectedCount: records.length, records };
}

export async function updateAiWorkflowAssignmentsCollectionData(input: {
  filter?: WorkflowUpdateArgs['filter'];
  set?: WorkflowUpdateArgs['set'];
  currentUserId: string;
  effectiveRoot: boolean;
}) {
  const assignmentFilter = (input.filter || {}) as WorkflowAssignmentCollectionFilter;
  const existingRows = filterWorkflowAssignmentRows(
    (await WorkflowAssignmentEntity.findByFilter('*')) as unknown as Array<Record<string, unknown>>,
    assignmentFilter,
  );
  const now = new Date().toISOString();
  const records: WorkflowCollectionObject[] = [];
  for (const row of existingRows) {
    const nextWorkflowId = normalizeNullableId(input.set?.workflow_id ?? row.workflow_id);
    if (!nextWorkflowId) throw new BadRequestError('workflow_id is required.');
    const slot = normalizeAssignmentSlot({
      scopeType: input.set?.scope_type ?? row.scope_type,
      scopeId: input.set?.scope_id ?? row.scope_id,
      userId: input.set?.user_id ?? row.user_id,
      organizationId: input.set?.organization_id ?? row.organization_id,
    });
    if (slot.userId && slot.userId !== input.currentUserId && !input.effectiveRoot)
      throw new BadRequestError('Cannot update workflow assignment for another user.');
    if (!slot.userId && !slot.organizationId && !input.effectiveRoot) {
      throw new BadRequestError('Only root users can manage global default workflow assignments.');
    }
    await assertWorkflowScopeAssignmentAllowed({
      supabase: getAdminSupabase(),
      currentUserId: input.currentUserId,
      workflowId: nextWorkflowId,
      organizationId: slot.organizationId,
      scopeType: slot.scopeType,
      scopeId: slot.scopeId,
      action: 'update',
    });
    const upserted = await upsertWorkflowAssignmentSlot({
      id: normalizeNullableId(row.id) || randomUUID(),
      workflowId: nextWorkflowId,
      scopeType: slot.scopeType,
      scopeId: slot.scopeId,
      userId: slot.userId,
      organizationId: slot.organizationId,
      metadata: normalizeWorkflowAssignmentMetadata(input.set?.metadata ?? row.metadata),
      createdAt: normalizeNullableId(row.created_at) || now,
      updatedAt: normalizeNullableId(input.set?.updated_at) || now,
    });
    if (upserted) records.push(upserted as WorkflowCollectionObject);
  }
  return { affectedCount: records.length, records };
}

export async function deleteAiWorkflowAssignmentsCollectionData(input: {
  filter?: WorkflowDeleteArgs['filter'];
  currentUserId: string;
  effectiveRoot: boolean;
  actorContext: OrganizationAccessContext;
}) {
  const assignmentFilter = (input.filter || {}) as WorkflowAssignmentCollectionFilter;
  const existingRows = filterWorkflowAssignmentRows(
    (await WorkflowAssignmentEntity.findByFilter('*')) as unknown as Array<Record<string, unknown>>,
    assignmentFilter,
  );
  const allowedRows = existingRows.filter((row: Record<string, unknown>) => {
    const userId = normalizeNullableId(row.user_id);
    const organizationId = normalizeNullableId(row.organization_id);
    const scopeType = normalizeNullableId(row.scope_type);
    const scopeId = normalizeNullableId(row.scope_id);
    if (input.effectiveRoot) return true;
    if (userId && userId !== input.currentUserId) return false;
    if (!userId && !organizationId) return false;
    if (organizationId && !input.actorContext.organizationIds.includes(organizationId)) return false;
    if (isRestrictedScope(input.actorContext, scopeType, scopeId)) return false;
    return true;
  });
  const ids = allowedRows.map((row) => normalizeNullableId(row.id)).filter((value): value is string => Boolean(value));
  if (!ids.length) return { affectedCount: 0, records: [] as WorkflowCollectionObject[] };
  const affectedCount = await WorkflowAssignmentEntity.deleteByIds(ids);
  return { affectedCount, records: [] as WorkflowCollectionObject[] };
}
