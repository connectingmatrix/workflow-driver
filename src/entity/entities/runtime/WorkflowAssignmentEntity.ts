import { randomUUID } from 'node:crypto';
import { ENTITY, FIELD, PERMISSIONS, Entity } from '@connectingmatrix/orm/orm';

export type WorkflowAssignmentRow = {
  id: string;
  workflow_id: string;
  scope_type: string;
  scope_id?: string | null;
  user_id?: string | null;
  organization_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

@ENTITY({ table: 'ai_workflow_assignments', label: 'WorkflowAssignment', store: 'supabase', primaryKey: 'id', scoped: true })
@PERMISSIONS({
  read: 'WORKFLOW_ASSIGNMENT_READ',
  list: 'WORKFLOW_ASSIGNMENT_LIST',
  create: 'WORKFLOW_ASSIGNMENT_CREATE',
  update: 'WORKFLOW_ASSIGNMENT_UPDATE',
  delete: 'WORKFLOW_ASSIGNMENT_DELETE',
})
export class WorkflowAssignmentEntity extends Entity<WorkflowAssignmentRow> {
  @FIELD({ type: 'string', required: true, index: true }) public declare id: string | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare workflow_id: string | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare scope_type: string | null;

  @FIELD({ type: 'string', index: true }) public declare scope_id: string | null;

  @FIELD({ type: 'string', index: true }) public declare user_id: string | null;

  @FIELD({ type: 'string', index: true }) public declare organization_id: string | null;

  @FIELD({ type: 'object', default: {} }) public declare metadata: Record<string, unknown> | null;

  @FIELD({ type: 'string' }) public declare created_at: string | null;

  @FIELD({ type: 'string' }) public declare updated_at: string | null;

  public static async createCollectionData(input: {
    id?: string | null;
    workflow_id: string;
    scope_type: string;
    scope_id?: string | null;
    user_id?: string | null;
    organization_id?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<WorkflowAssignmentEntity> {
    return this.create({
      id: input.id ?? randomUUID(),
      workflow_id: input.workflow_id,
      scope_type: input.scope_type,
      scope_id: input.scope_id ?? null,
      user_id: input.user_id ?? null,
      organization_id: input.organization_id ?? null,
      metadata: input.metadata ?? {},
    });
  }

  public static async updateCollectionData(input: {
    id: string;
    scope_type?: string | null;
    scope_id?: string | null;
    user_id?: string | null;
    organization_id?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<WorkflowAssignmentEntity> {
    const assignment = await this.single(input.id);
    if (!assignment) throw new Error(`Workflow assignment ${input.id} was not found.`);
    return assignment.update({
      ...(input.scope_type !== undefined ? { scope_type: input.scope_type } : {}),
      ...(input.scope_id !== undefined ? { scope_id: input.scope_id } : {}),
      ...(input.user_id !== undefined ? { user_id: input.user_id } : {}),
      ...(input.organization_id !== undefined ? { organization_id: input.organization_id } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata ?? {} } : {}),
    });
  }

  public static async deleteCollectionData(input: { id: string }): Promise<void> {
    const assignment = await this.single(input.id);
    if (assignment) await assignment.delete();
  }

  public static async findByUserId(userId: string): Promise<WorkflowAssignmentEntity[]> {
    return userId ? this.find({ user_id: userId }).many() : [];
  }

  public static async readScopedRow(input: {
    scopeType: string;
    scopeId?: string | null;
    userId?: string | null;
    organizationId?: string | null;
  }): Promise<WorkflowAssignmentEntity | null> {
    let query = this.find({ scope_type: input.scopeType, scope_id: input.scopeId ?? null });
    if (input.userId) query = query.where({ user_id: input.userId });
    if (input.organizationId !== undefined) query = query.where({ organization_id: input.organizationId ?? null });
    return query.single();
  }

  public static async readLatestSlot(input: {
    scopeType: string;
    scopeId?: string | null;
    userId?: string | null;
    organizationId?: string | null;
  }): Promise<WorkflowAssignmentEntity | null> {
    let query = this.find({ scope_type: input.scopeType, scope_id: input.scopeId ?? null });
    if (input.userId !== undefined) query = query.where({ user_id: input.userId ?? null });
    if (input.organizationId !== undefined) query = query.where({ organization_id: input.organizationId ?? null });
    return query.orderBy('created_at', 'desc').single();
  }

  public static async updateById(id: string, patch: Partial<WorkflowAssignmentRow>): Promise<WorkflowAssignmentEntity | null> {
    const row = await this.single(id);
    return row ? row.update(patch) : null;
  }

  public static async upsertScopedWorkflow(input: {
    workflowId: string;
    scopeType: string;
    scopeId?: string | null;
    userId?: string | null;
    organizationId?: string | null;
    metadata?: Record<string, unknown> | null;
    updatedAt?: string | null;
  }): Promise<WorkflowAssignmentEntity> {
    const updatedAt = input.updatedAt || new Date().toISOString();
    const existing = await this.readLatestSlot({
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
      userId: input.userId ?? null,
      organizationId: input.organizationId ?? null,
    });
    if (existing?.id) {
      return (await existing.update({
        workflow_id: input.workflowId,
        metadata: input.metadata ?? {},
        updated_at: updatedAt,
      })) as unknown as WorkflowAssignmentEntity;
    }
    return this.create({
      id: randomUUID(),
      workflow_id: input.workflowId,
      scope_type: input.scopeType,
      scope_id: input.scopeId ?? null,
      user_id: input.userId ?? null,
      organization_id: input.organizationId ?? null,
      metadata: input.metadata ?? {},
      created_at: updatedAt,
      updated_at: updatedAt,
    });
  }

  public static async findByFilter(select = '*'): Promise<WorkflowAssignmentEntity[]> {
    let query = this.find();
    if (select && select !== '*') query = query.select(select);
    return query.many();
  }

  public static async deleteByIds(ids: string[]): Promise<number> {
    const values = ids.map((value) => String(value || '').trim()).filter(Boolean);
    if (!values.length) return 0;
    const rows = await this.find().whereIn('id', values).many();
    for (const row of rows) await row.delete();
    return rows.length;
  }
}
