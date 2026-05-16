import { ENTITY, FIELD, PERMISSIONS, Entity } from '@connectingmatrix/orm/orm';

export type WorkflowVersionRow = {
  id?: string;
  workflow_id: string;
  version_number: number;
  is_current?: boolean | null;
  published_at?: string | null;
  published_by_user_id?: string | null;
  workflow_name?: string | null;
  workflow_description?: string | null;
  workflow_snapshot?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type PaginationInput = { first?: number | null; offset?: number | null };
type PageResult<T> = { records: T[]; hasNextPage: boolean; returnedCount: number; totalCount?: number };

const pageBounds = (input?: PaginationInput) => {
  const first = Math.max(0, Math.floor(Number(input?.first ?? 50)));
  const offset = Math.max(0, Math.floor(Number(input?.offset ?? 0)));
  return { first, offset };
};

@ENTITY({ table: 'ai_workflow_versions', label: 'WorkflowVersion', store: 'dual', primaryKey: 'id', scoped: true, graph: { mirror: true } })
@PERMISSIONS({
  read: 'WORKFLOW_VERSION_READ',
  list: 'WORKFLOW_VERSION_LIST',
  create: 'WORKFLOW_VERSION_CREATE',
  update: 'WORKFLOW_VERSION_UPDATE',
  delete: 'WORKFLOW_VERSION_DELETE',
})
export class WorkflowVersionEntity extends Entity<WorkflowVersionRow> {
  @FIELD({ type: 'string', required: true, index: true }) public declare id: string | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare workflow_id: string | null;

  @FIELD({ type: 'number', required: true }) public declare version_number: number | null;

  @FIELD({ type: 'boolean' }) public declare is_current: boolean | null;

  @FIELD({ type: 'string' }) public declare published_at: string | null;

  @FIELD({ type: 'string' }) public declare published_by_user_id: string | null;

  @FIELD({ type: 'string' }) public declare workflow_name: string | null;

  @FIELD({ type: 'string' }) public declare workflow_description: string | null;

  @FIELD({ type: 'object', default: {} }) public declare workflow_snapshot: Record<string, unknown> | null;

  @FIELD({ type: 'string' }) public declare created_at: string | null;

  @FIELD({ type: 'string' }) public declare updated_at: string | null;

  public static async listForWorkflow(input: PaginationInput & { workflowId: string }): Promise<PageResult<WorkflowVersionEntity>> {
    const { first, offset } = pageBounds(input);
    const result = await this.find({ workflow_id: input.workflowId }).orderBy('created_at', 'desc').limit(first).offset(offset).manyWithCount();
    const records = result.records as unknown as WorkflowVersionEntity[];
    return {
      records,
      hasNextPage: offset + records.length < result.count,
      returnedCount: records.length,
      totalCount: result.count,
    };
  }

  public static async createOnPublish(input: {
    workflowId: string;
    workflow: Record<string, unknown>;
    createdBy?: string | null;
    metadata?: { name?: string | null; description?: string | null; publishedAt?: string | null } | null;
  }): Promise<WorkflowVersionEntity> {
    const publishedAt = String(input.metadata?.publishedAt || '').trim() || new Date().toISOString();
    const latest = (await this.find({ workflow_id: input.workflowId }).orderBy('version_number', 'desc').limit(1).many())[0];
    const nextVersionNumber = Number(latest?.version_number || 0) + 1;
    await this.clearCurrentByWorkflowId(input.workflowId);
    return this.create({
      workflow_id: input.workflowId,
      version_number: nextVersionNumber,
      is_current: true,
      published_at: publishedAt,
      published_by_user_id: input.createdBy ?? null,
      workflow_name: input.metadata?.name ?? null,
      workflow_description: input.metadata?.description ?? null,
      workflow_snapshot: input.workflow,
      created_at: publishedAt,
      updated_at: publishedAt,
    });
  }

  public static async deleteManyForWorkflow(workflowId: string): Promise<void> {
    await this.deleteMany({ workflow_id: workflowId });
  }

  public static async resolveCurrentId(reference: { workflowId: string }): Promise<string | null> {
    const workflowId = String(reference.workflowId || '').trim();
    if (!workflowId) return null;
    const rows = await this.find({ workflow_id: workflowId }).orderBy('version_number', 'desc').limit(1).many();
    const row = rows[0];
    return row ? String(row.id || '').trim() || null : null;
  }

  public static async readVersionNumberById(workflowVersionId: string): Promise<number | null> {
    const row = await this.find({ id: workflowVersionId }).select('version_number').single();
    if (!row) return null;
    return Number.isFinite(Number(row.version_number)) ? Number(row.version_number) : null;
  }

  public static async findByWorkflowId(workflowId: string): Promise<WorkflowVersionEntity[]> {
    return (await this.find({ workflow_id: workflowId }).orderBy('version_number', 'desc').many()) as unknown as WorkflowVersionEntity[];
  }

  public static async readCurrentVersionId(workflowId: string): Promise<string | null> {
    const row = (await this.find({ workflow_id: workflowId }).orderBy('version_number', 'desc').limit(1).many())[0];
    return row ? String(row.id || '').trim() || null : null;
  }

  public static async clearCurrentByWorkflowId(workflowId: string): Promise<void> {
    if (!workflowId) return;
    const rows = await this.find({ workflow_id: workflowId, is_current: true }).many();
    for (const row of rows) {
      await row.update({ is_current: false });
    }
  }

  public static async findByIds(ids: string[]): Promise<WorkflowVersionEntity[]> {
    const values = ids.map((value) => String(value || '').trim()).filter(Boolean);
    if (!values.length) return [];
    return (await this.find().whereIn('id', values).many()) as unknown as WorkflowVersionEntity[];
  }

  public static async deleteByIds(ids: string[]): Promise<number> {
    const rows = await this.findByIds(ids);
    for (const row of rows) await row.delete();
    return rows.length;
  }

  public static async clearCurrentByWorkflowIdLegacy(_: string): Promise<void> {
    await Promise.resolve();
  }
}
