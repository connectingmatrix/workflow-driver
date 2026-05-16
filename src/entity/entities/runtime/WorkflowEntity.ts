import { randomUUID } from 'node:crypto';
import { ENTITY, FIELD, RELATION, PERMISSIONS, Entity, Relation } from '@connectingmatrix/orm/orm';
import { OrganisationEntity } from './OrganisationEntity';
import { UserEntity } from './UserEntity';
import type { WorkflowAssignmentEntity } from './WorkflowAssignmentEntity';
import type { WorkflowAttachmentEntity } from './WorkflowAttachmentEntity';
import type { WorkflowExecutionEntity } from './WorkflowExecutionEntity';
import type { WorkflowVersionEntity } from './WorkflowVersionEntity';
import type { WorkflowDefinition } from '@giga/shared/types/contracts/workflow.types';

export type WorkflowRow = {
  id: string;
  name: string;
  description?: string | null;
  search_text?: string | null;
  webhook_secret?: string | null;
  is_org_default?: boolean | null;
  user_id?: string | null;
  organization_id?: string | null;
  is_global?: boolean | null;
  is_active?: boolean | null;
  status?: string | null;
  workflow?: WorkflowDefinition | null;
  published_workflow?: WorkflowDefinition | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
};

type PaginationInput = { first?: number | null; offset?: number | null };
type PageResult<T> = { records: T[]; hasNextPage: boolean; returnedCount: number; totalCount?: number };

const pageBounds = (input?: PaginationInput) => {
  const first = Math.max(0, Math.floor(Number(input?.first ?? 50)));
  const offset = Math.max(0, Math.floor(Number(input?.offset ?? 0)));
  return { first, offset };
};

const createWorkflowSecret = () => randomUUID().replace(/-/g, '');
const WORKFLOW_CATALOG_COLUMNS =
  'id,user_id,organization_id,name,description,is_global,is_org_default,is_active,status,search_text,created_at,updated_at,published_at';
const workflowScope = (value?: string | null): 'global' | 'organization' | 'user' | null => {
  const scope = value?.trim().toLowerCase();
  if (scope === 'global' || scope === 'organization' || scope === 'user') return scope;
  return null;
};

@ENTITY({ table: 'ai_workflows', label: 'Workflow', store: 'dual', primaryKey: 'id', scoped: true, graph: { mirror: true } })
@PERMISSIONS({
  read: 'WORKFLOW_READ',
  list: 'WORKFLOW_LIST',
  create: 'WORKFLOW_CREATE',
  update: 'WORKFLOW_UPDATE',
  delete: 'WORKFLOW_DELETE',
  relations: {
    versions: { list: 'WORKFLOW_VERSION_LIST', create: 'WORKFLOW_VERSION_CREATE' },
    executions: { list: 'WORKFLOW_EXECUTION_LIST', create: 'WORKFLOW_EXECUTION_CREATE' },
    attachments: { list: 'WORKFLOW_ATTACHMENT_LIST', create: 'WORKFLOW_ATTACHMENT_CREATE' },
    assignments: { list: 'WORKFLOW_ASSIGNMENT_LIST', create: 'WORKFLOW_ASSIGNMENT_CREATE' },
  },
})
export class WorkflowEntity extends Entity<WorkflowRow> {
  @FIELD({ type: 'string', required: true, index: true }) public declare id: string | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare name: string | null;

  @FIELD({ type: 'string' }) public declare description: string | null;

  @FIELD({ type: 'string' }) public declare search_text: string | null;

  @FIELD({ type: 'string' }) public declare webhook_secret: string | null;

  @FIELD({ type: 'boolean', default: false }) public declare is_org_default: boolean | null;

  @FIELD({ type: 'string', index: true }) public declare user_id: string | null;

  @FIELD({ type: 'string', index: true }) public declare organization_id: string | null;

  @FIELD({ type: 'boolean', default: false }) public declare is_global: boolean | null;

  @FIELD({ type: 'boolean', default: true }) public declare is_active: boolean | null;

  @FIELD({ type: 'string' }) public declare status: string | null;

  @FIELD({ type: 'json' }) public declare workflow: WorkflowDefinition | null;

  @FIELD({ type: 'json' }) public declare published_workflow: WorkflowDefinition | null;

  @FIELD({ type: 'object', default: {} }) public declare metadata: Record<string, unknown> | null;

  @FIELD({ type: 'string' }) public declare created_at: string | null;

  @FIELD({ type: 'string' }) public declare updated_at: string | null;

  @FIELD({ type: 'string' }) public declare published_at: string | null;

  @RELATION({
    target: 'WorkflowVersion',
    relation: 'HAS_WORKFLOW_VERSION',
    store: 'dual',
    many: true,
    owner: { scope: 'inherit', parentField: 'id', childField: 'workflow_id' },
    graph: { edge: true },
  })
  public declare versions: Relation<WorkflowVersionEntity>;

  @RELATION({
    target: 'WorkflowExecution',
    relation: 'HAS_WORKFLOW_EXECUTION',
    store: 'dual',
    many: true,
    owner: { scope: 'inherit', parentField: 'id', childField: 'workflow_id' },
    graph: { edge: true },
  })
  public declare executions: Relation<WorkflowExecutionEntity>;

  @RELATION({
    target: 'WorkflowAttachment',
    relation: 'HAS_WORKFLOW_ATTACHMENT',
    store: 'supabase',
    many: true,
    owner: { scope: 'inherit', parentField: 'id', childField: 'workflow_id' },
  })
  public declare attachments: Relation<WorkflowAttachmentEntity>;

  @RELATION({
    target: 'WorkflowAssignment',
    relation: 'HAS_WORKFLOW_ASSIGNMENT',
    store: 'supabase',
    many: true,
    owner: { scope: 'inherit', parentField: 'id', childField: 'workflow_id' },
  })
  public declare assignments: Relation<WorkflowAssignmentEntity>;

  private static newestTime(row: WorkflowEntity): number {
    const parsed = new Date(String(row.updated_at || row.published_at || row.created_at || '')).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  public static catalogColumns(): string {
    return WORKFLOW_CATALOG_COLUMNS;
  }

  public static async listGlobalCatalog(input?: PaginationInput): Promise<PageResult<WorkflowEntity>> {
    const { first, offset } = pageBounds(input);
    const result = await this.find({ is_global: true, is_active: true })
      .select(WORKFLOW_CATALOG_COLUMNS)
      .orderBy('updated_at', 'desc')
      .limit(first)
      .offset(offset)
      .manyWithCount();
    return {
      records: result.records,
      hasNextPage: offset + result.records.length < result.count,
      returnedCount: result.records.length,
      totalCount: result.count,
    };
  }

  public static async listPersonalCatalog(input: PaginationInput & { userId: string }): Promise<PageResult<WorkflowEntity>> {
    const { first, offset } = pageBounds(input);
    const result = await this.find({ user_id: input.userId, is_active: true })
      .whereNull('organization_id')
      .select(WORKFLOW_CATALOG_COLUMNS)
      .orderBy('updated_at', 'desc')
      .limit(first)
      .offset(offset)
      .manyWithCount();
    return {
      records: result.records.filter((row) => row.is_global !== true),
      hasNextPage: offset + result.records.length < result.count,
      returnedCount: result.records.length,
      totalCount: result.count,
    };
  }

  public static async listOrganizationCatalog(input: PaginationInput & { organizationId: string }): Promise<PageResult<WorkflowEntity>> {
    const { first, offset } = pageBounds(input);
    const result = await this.find({ organization_id: input.organizationId, is_active: true })
      .select(WORKFLOW_CATALOG_COLUMNS)
      .orderBy('updated_at', 'desc')
      .limit(first)
      .offset(offset)
      .manyWithCount();
    return {
      records: result.records,
      hasNextPage: offset + result.records.length < result.count,
      returnedCount: result.records.length,
      totalCount: result.count,
    };
  }

  public static async listAccessibleCatalog(
    input: PaginationInput & {
      userId: string;
      organizationId?: string | null;
      organizationIds?: string[] | null;
      effectiveRoot?: boolean | null;
      scope?: string | null;
      search?: string | null;
    },
  ): Promise<PageResult<WorkflowEntity>> {
    const { first, offset } = pageBounds(input);
    const access = await OrganisationEntity.accessForUser({
      userId: input.userId,
      organizationId: input.organizationId ?? input.organizationIds?.[0] ?? null,
      effectiveRoot: input.effectiveRoot ?? false,
    });
    const scope = workflowScope(input.scope);
    const search = (input.search || '').trim().toLowerCase();
    const organizationIds = input.organizationIds?.length
      ? input.organizationIds.filter((id) => access.organizationIds.includes(id))
      : access.organizationIds;
    const globalRows =
      scope === 'organization' || scope === 'user'
        ? []
        : await this.find({ is_global: true, is_active: true }).select(WORKFLOW_CATALOG_COLUMNS).many();
    const personalRows =
      scope === 'organization' || scope === 'global'
        ? []
        : await this.find({ user_id: input.userId, is_active: true }).whereNull('organization_id').select(WORKFLOW_CATALOG_COLUMNS).many();
    const organizationRows =
      scope === 'user' || scope === 'global' || !organizationIds.length
        ? []
        : await this.find({ is_active: true }).whereIn('organization_id', organizationIds).select(WORKFLOW_CATALOG_COLUMNS).many();
    const searchableRows = search
      ? [...globalRows, ...personalRows, ...organizationRows].filter((row) => this.matchesCatalogSearch(row, search))
      : [...globalRows, ...personalRows, ...organizationRows];
    const byId = new Map<string, WorkflowEntity>();
    for (const row of searchableRows) {
      const id = row.id?.trim();
      if (id) byId.set(id, row);
    }
    const sorted = Array.from(byId.values()).sort((left, right) => this.newestTime(right) - this.newestTime(left));
    const records = sorted.slice(offset, offset + first);
    return { records, hasNextPage: offset + records.length < sorted.length, returnedCount: records.length, totalCount: sorted.length };
  }

  public static async readAccessibleRecord(input: {
    workflowId: string;
    userId: string;
    effectiveRoot?: boolean | null;
  }): Promise<WorkflowEntity | null> {
    const catalog = await this.listAccessibleCatalog({
      userId: input.userId,
      effectiveRoot: input.effectiveRoot ?? false,
      first: 1000,
      offset: 0,
    });
    if (!catalog.records.some((record) => record.id === input.workflowId)) return null;
    return this.find({ id: input.workflowId, is_active: true }).single();
  }

  private static matchesCatalogSearch(row: WorkflowEntity, search: string): boolean {
    return Boolean(
      row.name?.toLowerCase().includes(search) || row.description?.toLowerCase().includes(search) || row.search_text?.toLowerCase().includes(search),
    );
  }

  public static async createCollectionData(input: {
    id?: string | null;
    name: string;
    description?: string | null;
    searchText?: string | null;
    webhookSecret?: string | null;
    userId?: string | null;
    organizationId?: string | null;
    isGlobal?: boolean | null;
    isActive?: boolean | null;
    status?: string | null;
    workflow?: Record<string, unknown> | null;
    publishedWorkflow?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    publishedAt?: string | null;
  }): Promise<WorkflowEntity> {
    const payload = {
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      description: input.description ?? null,
      search_text: input.searchText ?? null,
      workflow: input.workflow ?? null,
      published_workflow: input.publishedWorkflow ?? null,
      published_at: input.publishedAt ?? null,
      metadata: input.metadata ?? {},
      status: input.status ?? null,
      is_active: input.isActive ?? true,
      webhook_secret: input.webhookSecret ?? createWorkflowSecret(),
      ...(input.createdAt ? { created_at: input.createdAt } : {}),
      ...(input.updatedAt ? { updated_at: input.updatedAt } : {}),
    };
    if (input.organizationId) {
      return OrganisationEntity.load(input.organizationId).workflows.create({
        ...payload,
        is_global: input.isGlobal ?? false,
      });
    }
    if (input.isGlobal === true) throw new Error('Global workflow creation requires GlobalEntity.workflows relation.');
    return UserEntity.load(input.userId ?? undefined).workflows.create({ ...payload, is_global: false });
  }

  public static async updateCollectionData(input: {
    id: string;
    name?: string | null;
    description?: string | null;
    workflow?: Record<string, unknown> | null;
    published_workflow?: Record<string, unknown> | null;
    is_active?: boolean | null;
    status?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<WorkflowEntity> {
    const workflow = await this.single(input.id);
    if (!workflow) throw new Error(`Workflow ${input.id} was not found.`);
    return workflow.update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.workflow !== undefined ? { workflow: input.workflow } : {}),
      ...(input.published_workflow !== undefined ? { published_workflow: input.published_workflow } : {}),
      ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata ?? {} } : {}),
    });
  }

  public static isWebhookBased(workflow: WorkflowDefinition | null | undefined): boolean {
    const startNode = workflow?.nodes?.find((node) => node.modelId === 'start');
    const runtime = (startNode?.runtime || {}) as Record<string, unknown>;
    const triggerSource = String(runtime.triggerSource || '')
      .trim()
      .toLowerCase();
    return triggerSource === 'webhook';
  }

  public static isWebhookBasedWorkflow(workflow: WorkflowDefinition | null | undefined): boolean {
    return this.isWebhookBased(workflow);
  }

  public static async resolveReference(input: {
    currentUserId: string;
    scope: 'user' | 'organization' | 'global';
    workflowId: string;
    organizationId?: string | null;
  }): Promise<{ workflowId: string; scope: 'user' | 'organization' | 'global'; organizationId: string | null; ownerUserId: string | null } | null> {
    const workflowId = String(input.workflowId || '').trim();
    if (!workflowId) return null;
    if (input.scope === 'global') {
      const row = await this.find({ id: workflowId, is_global: true, is_active: true }).single();
      return row ? { workflowId, scope: 'global', organizationId: null, ownerUserId: null } : null;
    }
    if (input.scope === 'organization') {
      const organizationId = String(input.organizationId || '').trim();
      if (!organizationId) return null;
      const row = await this.find({ id: workflowId, organization_id: organizationId, is_active: true }).single();
      return row ? { workflowId, scope: 'organization', organizationId, ownerUserId: null } : null;
    }
    const row = await this.find({ id: workflowId, user_id: input.currentUserId, is_active: true }).single();
    return row ? { workflowId, scope: 'user', organizationId: null, ownerUserId: input.currentUserId } : null;
  }

  public static async listActiveRowsByUserId(userId: string, select = '*'): Promise<WorkflowEntity[]> {
    let query = this.find({ user_id: userId, is_active: true });
    if (select && select !== '*') query = query.select(select);
    return query.many();
  }

  public static async listActiveRowsByOrganizationId(organizationId: string, select = '*'): Promise<WorkflowEntity[]> {
    let query = this.find({ organization_id: organizationId, is_active: true });
    if (select && select !== '*') query = query.select(select);
    return query.many();
  }

  public static async listActiveRowsByName(name: string): Promise<WorkflowEntity[]> {
    return this.find({ name, is_active: true }).many();
  }

  public static async readActiveRowById(id: string): Promise<WorkflowEntity | null> {
    return this.find({ id, is_active: true }).single();
  }

  public static async readActiveGlobalById(id: string, select = '*'): Promise<Record<string, unknown> | null> {
    let query = this.find({ id, is_global: true, is_active: true });
    if (select && select !== '*') query = query.select(select);
    const row = await query.single();
    return row ? (row.payload as Record<string, unknown>) : null;
  }

  public static async readActiveOrganizationById(id: string, organizationId: string, select = '*'): Promise<Record<string, unknown> | null> {
    let query = this.find({ id, organization_id: organizationId, is_active: true });
    if (select && select !== '*') query = query.select(select);
    const row = await query.single();
    return row ? (row.payload as Record<string, unknown>) : null;
  }

  public static async readActivePersonalById(id: string, userId: string, select = '*'): Promise<Record<string, unknown> | null> {
    let query = this.find({ id, user_id: userId, is_active: true }).whereNull('organization_id');
    if (select && select !== '*') query = query.select(select);
    const row = await query.single();
    return row ? (row.payload as Record<string, unknown>) : null;
  }

  public static async findByIds(ids: string[], select = '*'): Promise<WorkflowEntity[]> {
    const values = ids.map((value) => String(value || '').trim()).filter(Boolean);
    if (!values.length) return [];
    let query = this.find().whereIn('id', values);
    if (select && select !== '*') query = query.select(select);
    return query.many();
  }

  public static activeQuery(input: { userId?: string | null; organizationId?: string | null; includeGlobal?: boolean }) {
    let query = this.find({ is_active: true });
    if (input.userId) query = query.where({ user_id: input.userId });
    if (input.organizationId) query = query.where({ organization_id: input.organizationId });
    if (input.includeGlobal === true) return query;
    return query.where({ is_global: false });
  }

  public static async readOwnedRow(input: {
    workflowId: string;
    currentUserId: string;
    organizationId?: string | null;
    effectiveRoot?: boolean;
  }): Promise<WorkflowEntity | null> {
    if (input.effectiveRoot === true) return this.single(input.workflowId);
    if (input.organizationId) {
      return this.find({ id: input.workflowId, organization_id: input.organizationId, is_active: true }).single();
    }
    return this.find({ id: input.workflowId, user_id: input.currentUserId, is_active: true }).single();
  }

  public static async updateOwnedRow(input: {
    workflowId: string;
    currentUserId: string;
    organizationId?: string | null;
    effectiveRoot?: boolean;
    patch: Partial<WorkflowRow>;
  }): Promise<WorkflowEntity> {
    const row = await this.readOwnedRow(input);
    if (!row) throw new Error(`Workflow ${input.workflowId} was not found.`);
    return row.update(input.patch);
  }

  public static async deleteOwnedRow(input: {
    workflowId: string;
    currentUserId: string;
    organizationId?: string | null;
    effectiveRoot?: boolean;
  }): Promise<void> {
    const row = await this.readOwnedRow(input);
    if (!row) return;
    await row.delete();
  }

  public static async deleteById(id: string): Promise<void> {
    const row = await this.single(id);
    if (row) await row.delete();
  }

  public static async findByUserAndName(userId: string, name: string): Promise<WorkflowEntity | null> {
    return this.find({ user_id: userId, name }).single();
  }

  public static async updateById(id: string, patch: Partial<WorkflowRow>): Promise<WorkflowEntity | null> {
    const row = await this.single(id);
    return row ? row.update(patch) : null;
  }

  public static async findByOrganizationId(organizationId: string, select = '*'): Promise<WorkflowEntity[]> {
    if (!organizationId) return [];
    let query = this.find({ organization_id: organizationId });
    if (select && select !== '*') query = query.select(select);
    return query.many();
  }

  public static async listReadableRows(input: {
    scope: 'global' | 'organization' | 'user';
    userId: string;
    organizationId?: string | null;
    select?: string;
  }): Promise<WorkflowEntity[]> {
    let query = this.activeQuery({ includeGlobal: true });
    if (input.scope === 'global') query = query.where({ is_global: true });
    if (input.scope === 'organization') query = query.where({ organization_id: input.organizationId || null });
    if (input.scope === 'user') query = query.where({ user_id: input.userId, is_global: false }).whereNull('organization_id');
    if (input.select && input.select !== '*') query = query.select(input.select);
    return query.orderBy('updated_at', 'desc').many();
  }

  public static async readFirstReadableRow(input: {
    scope: 'global' | 'organization' | 'user';
    userId: string;
    organizationId?: string | null;
    workflowId?: string | null;
    nameQuery?: string | null;
  }): Promise<WorkflowEntity | null> {
    let query = this.activeQuery({ includeGlobal: true });
    if (input.scope === 'global') query = query.where({ is_global: true });
    if (input.scope === 'organization') query = query.where({ organization_id: input.organizationId || null });
    if (input.scope === 'user') query = query.where({ user_id: input.userId, is_global: false }).whereNull('organization_id');
    if (input.workflowId) query = query.where({ id: input.workflowId });
    if (input.nameQuery) query = query.whereLike('name', `%${input.nameQuery}%`);
    return query.orderBy('updated_at', 'desc').single();
  }

  public static async createWorkflowRow(input: {
    id: string;
    userId: string;
    name: string;
    description?: string | null;
    workflow: WorkflowDefinition;
    metadata?: Record<string, unknown> | null;
    status?: string | null;
    searchText?: string | null;
    webhookSecret?: string | null;
    publishedAt?: string | null;
    publishedWorkflow?: WorkflowDefinition | null;
  }): Promise<WorkflowEntity> {
    return this.create({
      id: input.id,
      user_id: input.userId,
      name: input.name,
      description: input.description ?? null,
      workflow: input.workflow,
      published_at: input.publishedAt ?? null,
      published_workflow: input.publishedWorkflow ?? null,
      metadata: input.metadata ?? {},
      status: input.status ?? 'draft',
      search_text: input.searchText ?? null,
      webhook_secret: input.webhookSecret ?? createWorkflowSecret(),
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as WorkflowRow);
  }
}
