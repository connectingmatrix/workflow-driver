import { randomUUID } from 'crypto';
import { ENTITY, FIELD, RELATION, PERMISSIONS, Entity, Relation } from '@connectingmatrix/orm/orm';
import type { WorkflowDefinition } from '@giga/shared/types/contracts/workflow.types';
import type { WorkflowEventEntity } from './WorkflowEventEntity';
import type { WorkflowLogEntity } from '../telemetry/WorkflowLogEntity';

export type WorkflowExecutionRow = {
  id?: string;
  workflow_id: string;
  workflow_version_id?: string | null;
  status: string;
  user_id?: string | null;
  chat_session_id?: string | null;
  chat_message_id?: string | null;
  assistant_message_id?: string | null;
  scope_type?: string | null;
  scope_id?: string | null;
  workflow_source?: string | null;
  run_id?: string | null;
  trigger_type?: string | null;
  error_message?: string | null;
  logs?: unknown[] | null;
  request_payload?: Record<string, unknown> | null;
  response_payload?: Record<string, unknown> | null;
  workflow_snapshot?: WorkflowDefinition | null;
  duration_ms?: number | null;
  input_payload?: Record<string, unknown> | null;
  output_payload?: Record<string, unknown> | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  error_payload?: Record<string, unknown> | null;
};

type PaginationInput = { first?: number | null; offset?: number | null };
type PageResult<T> = { records: T[]; hasNextPage: boolean; returnedCount: number; totalCount?: number };

const pageBounds = (input?: PaginationInput) => {
  const first = Math.max(0, Math.floor(Number(input?.first ?? 50)));
  const offset = Math.max(0, Math.floor(Number(input?.offset ?? 0)));
  return { first, offset };
};

@ENTITY({ table: 'ai_workflow_executions', label: 'WorkflowExecution', store: 'supabase', primaryKey: 'id', scoped: true })
@PERMISSIONS({
  read: 'WORKFLOW_EXECUTION_READ',
  list: 'WORKFLOW_EXECUTION_LIST',
  create: 'WORKFLOW_EXECUTION_CREATE',
  update: 'WORKFLOW_EXECUTION_UPDATE',
  delete: 'WORKFLOW_EXECUTION_DELETE',
  relations: {
    events: { list: 'WORKFLOW_EVENT_LIST', create: 'WORKFLOW_EVENT_CREATE' },
    logRows: { list: 'WORKFLOW_LOG_LIST', create: 'WORKFLOW_LOG_CREATE' },
  },
})
export class WorkflowExecutionEntity extends Entity<WorkflowExecutionRow> {
  @FIELD({ type: 'string', required: true, index: true }) public declare id: string | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare workflow_id: string | null;

  @FIELD({ type: 'string', index: true }) public declare workflow_version_id: string | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare status: string | null;

  @FIELD({ type: 'string', index: true }) public declare user_id: string | null;

  @FIELD({ type: 'string', index: true }) public declare chat_session_id: string | null;

  @FIELD({ type: 'string' }) public declare chat_message_id: string | null;

  @FIELD({ type: 'string' }) public declare assistant_message_id: string | null;

  @FIELD({ type: 'string' }) public declare scope_type: string | null;

  @FIELD({ type: 'string' }) public declare scope_id: string | null;

  @FIELD({ type: 'string' }) public declare workflow_source: string | null;

  @FIELD({ type: 'string', index: true }) public declare run_id: string | null;

  @FIELD({ type: 'string' }) public declare trigger_type: string | null;

  @FIELD({ type: 'string' }) public declare error_message: string | null;

  @FIELD({ type: 'array', default: [] }) public declare logs: unknown[] | null;

  @FIELD({ type: 'object', default: {} }) public declare request_payload: Record<string, unknown> | null;

  @FIELD({ type: 'object', default: {} }) public declare response_payload: Record<string, unknown> | null;

  @FIELD({ type: 'object', default: {} }) public declare workflow_snapshot: Record<string, unknown> | null;

  @FIELD({ type: 'number' }) public declare duration_ms: number | null;

  @FIELD({ type: 'object', default: {} }) public declare input_payload: Record<string, unknown> | null;

  @FIELD({ type: 'object', default: {} }) public declare output_payload: Record<string, unknown> | null;

  @FIELD({ type: 'object', default: {} }) public declare error_payload: Record<string, unknown> | null;

  @FIELD({ type: 'string' }) public declare started_at: string | null;

  @FIELD({ type: 'string' }) public declare completed_at: string | null;

  @FIELD({ type: 'string' }) public declare created_at: string | null;

  @FIELD({ type: 'string' }) public declare updated_at: string | null;

  @RELATION({
    target: 'WorkflowEvent',
    relation: 'HAS_WORKFLOW_EVENT',
    store: 'supabase',
    many: true,
    owner: { scope: 'inherit', parentField: 'id', childField: 'workflow_execution_id' },
  })
  public declare events: Relation<WorkflowEventEntity>;

  @RELATION({
    target: 'WorkflowLog',
    relation: 'HAS_WORKFLOW_LOG',
    store: 'supabase',
    many: true,
    owner: { scope: 'inherit', parentField: 'id', childField: 'workflow_execution_id' },
  })
  public declare logRows: Relation<WorkflowLogEntity>;

  public static async listForWorkflow(input: PaginationInput & { workflowId: string }): Promise<PageResult<WorkflowExecutionEntity>> {
    const { first, offset } = pageBounds(input);
    const result = await this.find({ workflow_id: input.workflowId }).orderBy('started_at', 'desc').limit(first).offset(offset).manyWithCount();
    const records = result.records as unknown as WorkflowExecutionEntity[];
    return {
      records,
      hasNextPage: offset + records.length < result.count,
      returnedCount: records.length,
      totalCount: result.count,
    };
  }

  public static async transition(input: { id: string; status: string; patch?: Record<string, unknown> | null }): Promise<WorkflowExecutionEntity> {
    const execution = await this.single(input.id);
    if (!execution) throw new Error(`Workflow execution ${input.id} was not found.`);
    return (await execution.update({
      ...(input.patch ?? {}),
      status: input.status,
      updated_at: new Date().toISOString(),
    })) as unknown as WorkflowExecutionEntity;
  }

  public static async finalize(input: {
    id: string;
    status: string;
    finishedAt?: string | null;
    output?: Record<string, unknown> | null;
    error?: Record<string, unknown> | null;
  }): Promise<WorkflowExecutionEntity> {
    const execution = await this.single(input.id);
    if (!execution) throw new Error(`Workflow execution ${input.id} was not found.`);
    return (await execution.update({
      status: input.status,
      completed_at: input.finishedAt ?? new Date().toISOString(),
      response_payload: input.output ?? null,
      output_payload: input.output ?? null,
      error_payload: input.error ?? null,
      updated_at: new Date().toISOString(),
    })) as unknown as WorkflowExecutionEntity;
  }

  public static async createTracker(input: {
    executionId?: string | null;
    workflowId: string;
    workflowVersionId?: string | null;
    status?: string | null;
    workflowSource: string;
    triggerType: string;
    runId: string;
    userId?: string | null;
    scopeType?: string | null;
    scopeId?: string | null;
    requestPayload?: Record<string, unknown> | null;
    responsePayload?: Record<string, unknown> | null;
    workflowSnapshot?: WorkflowDefinition | null;
    inputPayload?: Record<string, unknown> | null;
    startedAt?: string | null;
  }): Promise<WorkflowExecutionEntity> {
    const executionId = input.executionId || this.createExecutionId();
    return (await this.create({
      id: executionId,
      workflow_id: input.workflowId,
      workflow_version_id: input.workflowVersionId ?? null,
      workflow_source: input.workflowSource,
      trigger_type: input.triggerType,
      run_id: input.runId,
      user_id: input.userId ?? null,
      scope_type: input.scopeType ?? null,
      scope_id: input.scopeId ?? null,
      status: input.status || 'queued',
      request_payload: input.requestPayload ?? null,
      response_payload: input.responsePayload ?? null,
      workflow_snapshot: input.workflowSnapshot ?? null,
      input_payload: input.inputPayload ?? null,
      started_at: input.startedAt || new Date().toISOString(),
    })) as unknown as WorkflowExecutionEntity;
  }

  public static async updateRecord(input: { id: string; patch: Record<string, unknown> }): Promise<WorkflowExecutionEntity> {
    const execution = await this.single(input.id);
    if (!execution) throw new Error(`Workflow execution ${input.id} was not found.`);
    return (await execution.update(input.patch)) as unknown as WorkflowExecutionEntity;
  }

  public static async createFromChatRun(input: {
    userId: string;
    chatId: string;
    scopeType?: string | null;
    scopeId?: string | null;
    workflowId: string;
    runId: string;
    status: string;
    errorMessage?: string | null;
    logs: NonNullable<WorkflowExecutionRow['logs']>;
    requestPayload: NonNullable<WorkflowExecutionRow['request_payload']>;
    responsePayload: NonNullable<WorkflowExecutionRow['response_payload']>;
    workflowSnapshot?: WorkflowExecutionRow['workflow_snapshot'];
    durationMs: number;
    completedAt: string;
  }): Promise<WorkflowExecutionEntity> {
    return (await this.create({
      user_id: input.userId,
      chat_session_id: input.chatId,
      chat_message_id: null,
      assistant_message_id: null,
      scope_type: input.scopeType ?? null,
      scope_id: input.scopeId ?? null,
      workflow_source: 'user',
      workflow_id: input.workflowId,
      workflow_version_id: null,
      run_id: input.runId,
      trigger_type: 'chat_agent',
      status: input.status,
      error_message: input.errorMessage ?? null,
      logs: input.logs,
      request_payload: input.requestPayload,
      response_payload: input.responsePayload,
      workflow_snapshot: input.workflowSnapshot ?? null,
      duration_ms: input.durationMs,
      completed_at: input.completedAt,
      updated_at: input.completedAt,
    })) as unknown as WorkflowExecutionEntity;
  }

  public static createExecutionId(): string {
    return randomUUID();
  }

  public static async latestByWorkflowAndChat(workflowId: string, chatId?: string | null): Promise<WorkflowExecutionEntity | null> {
    let query = this.find({ workflow_id: String(workflowId || '').trim() });
    if (chatId) query = query.where({ chat_session_id: chatId });
    return query.orderBy('created_at', 'desc').single();
  }

  public static async readChatDebugContextRowById(executionId: string): Promise<WorkflowExecutionEntity | null> {
    return this.find({ id: String(executionId || '').trim() })
      .select(
        'id,workflow_id,workflow_version_id,status,run_id,request_payload,response_payload,error_payload,workflow_snapshot,created_at,updated_at',
      )
      .single();
  }

  public static async getExecution(input: {
    executionId?: string | null;
    runId?: string | null;
    workflowId?: string | null;
  }): Promise<WorkflowExecutionEntity | null> {
    const executionId = String(input.executionId || '').trim();
    if (executionId) return (await this.single(executionId)) as unknown as WorkflowExecutionEntity | null;
    const runId = String(input.runId || '').trim();
    if (!runId) return null;
    let query = this.find({ run_id: runId });
    if (input.workflowId) query = query.where({ workflow_id: input.workflowId });
    return (await query.single()) as unknown as WorkflowExecutionEntity | null;
  }

  public static async runningStatuses(input: {
    workflowIds?: string[];
    organizationId?: string | null;
    includeExecutions?: boolean;
  }): Promise<WorkflowExecutionEntity[]> {
    let query = this.find().whereIn('status', ['queued', 'running']);
    const workflowIds = (input.workflowIds || []).map((value) => String(value || '').trim()).filter(Boolean);
    if (workflowIds.length) query = query.whereIn('workflow_id', workflowIds);
    return (await query.orderBy('started_at', 'desc').many()) as unknown as WorkflowExecutionEntity[];
  }

  public static async findByWorkflowId(workflowId: string): Promise<WorkflowExecutionEntity[]> {
    return (await this.find({ workflow_id: workflowId }).orderBy('started_at', 'desc').many()) as unknown as WorkflowExecutionEntity[];
  }

  public static async listActiveRowsByWorkflowIds(workflowIds: string[]): Promise<WorkflowExecutionEntity[]> {
    const ids = workflowIds.map((value) => String(value || '').trim()).filter(Boolean);
    if (!ids.length) return [];
    return (await this.find().whereIn('status', ['queued', 'running']).whereIn('workflow_id', ids).many()) as unknown as WorkflowExecutionEntity[];
  }

  public static async listStatusRowsByWorkflowIds(workflowIds: string[]): Promise<WorkflowExecutionEntity[]> {
    const ids = workflowIds.map((value) => String(value || '').trim()).filter(Boolean);
    if (!ids.length) return [];
    return (await this.find().whereIn('workflow_id', ids).many()) as unknown as WorkflowExecutionEntity[];
  }

  public static async listVersionIdRows(versionIds: string[]): Promise<WorkflowExecutionEntity[]> {
    const ids = versionIds.map((value) => String(value || '').trim()).filter(Boolean);
    if (!ids.length) return [];
    return (await this.find().whereIn('workflow_version_id', ids).select('workflow_version_id').many()) as unknown as WorkflowExecutionEntity[];
  }

  public static async findByWorkflowExecution(input: {
    workflowId: string;
    executionId?: string | null;
    runId?: string | null;
  }): Promise<WorkflowExecutionEntity | null> {
    const workflowId = String(input.workflowId || '').trim();
    const executionId = String(input.executionId || '').trim();
    const runId = String(input.runId || '').trim();
    if (executionId) return (await this.find({ workflow_id: workflowId, id: executionId }).single()) as unknown as WorkflowExecutionEntity | null;
    if (runId) return (await this.find({ workflow_id: workflowId, run_id: runId }).single()) as unknown as WorkflowExecutionEntity | null;
    return null;
  }

  public static async readResponsePayloadRowById(id: string): Promise<WorkflowExecutionEntity | null> {
    return (await this.find({ id }).select('id,response_payload,output_payload,status').single()) as unknown as WorkflowExecutionEntity | null;
  }

  public static async readLogsRowById(id: string): Promise<WorkflowExecutionEntity | null> {
    return (await this.find({ id }).select('id,logs,error_payload,response_payload,status').single()) as unknown as WorkflowExecutionEntity | null;
  }

  public static async readFinalizeSeedRow(id: string): Promise<WorkflowExecutionEntity | null> {
    return (await this.find({ id })
      .select('id,status,workflow_id,workflow_version_id,created_at,logs,response_payload,workflow_snapshot')
      .single()) as unknown as WorkflowExecutionEntity | null;
  }

  public static async updateById(input: {
    id: string;
    patch: Partial<WorkflowExecutionRow>;
    expectedStatuses?: string[];
  }): Promise<WorkflowExecutionEntity | null> {
    const row = await this.single(input.id);
    if (!row) return null;
    const status = String(row.status || '');
    if (input.expectedStatuses?.length && !input.expectedStatuses.includes(status)) return null;
    return (await row.update(input.patch)) as unknown as WorkflowExecutionEntity;
  }

  public static async deleteByIds(ids: string[]): Promise<number> {
    const values = ids.map((value) => String(value || '').trim()).filter(Boolean);
    if (!values.length) return 0;
    const rows = await this.find().whereIn('id', values).many();
    for (const row of rows) await row.delete();
    return rows.length;
  }

  public static async deleteByWorkflowIds(workflowIds: string[]): Promise<number> {
    const ids = workflowIds.map((value) => String(value || '').trim()).filter(Boolean);
    if (!ids.length) return 0;
    const rows = await this.find().whereIn('workflow_id', ids).many();
    for (const row of rows) await row.delete();
    return rows.length;
  }
}
