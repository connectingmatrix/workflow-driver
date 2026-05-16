import { EventEmitter } from 'node:events';
import * as Entities from '@connectingmatrix/orm/repositories/entities';

type QueryBuilder<T = unknown> = {
  many?: () => Promise<T[]>;
  single?: () => Promise<T | null>;
  orderBy?: (field: string, direction?: string) => QueryBuilder<T>;
  limit?: (count: number) => QueryBuilder<T>;
  offset?: (count: number) => QueryBuilder<T>;
  whereIn?: (field: string, values: unknown[]) => QueryBuilder<T>;
};

type EntityClass = {
  load?: (id?: string) => Record<string, unknown>;
  find?: (where?: Record<string, unknown>) => QueryBuilder<unknown>;
  single?: (where: string | Record<string, unknown>) => Promise<unknown>;
  create?: (payload: Record<string, unknown>) => Promise<unknown>;
  append?: (payload: Record<string, unknown>) => Promise<unknown>;
  getExecution?: (payload: Record<string, unknown>) => Promise<unknown>;
  runningStatuses?: (payload: Record<string, unknown>) => Promise<unknown[]>;
};

const entityExports = Entities as unknown as Record<string, EntityClass>;
const { WorkflowEntity } = entityExports;
const { WorkflowExecutionEntity } = entityExports;
const { WorkflowLogEntity } = entityExports;
const { WorkflowEventEntity } = entityExports;

export type WorkflowLiveEvent = {
  type: 'workflow.log' | 'workflow.event' | 'workflow.status' | 'workflow.completed' | 'workflow.failed';
  workflowId?: string | null;
  executionId?: string | null;
  runId?: string | null;
  payload: unknown;
  createdAt: string;
};

export type WorkflowLogReference = { workflowId?: string | null; executionId?: string | null; runId?: string | null };

const bus = new EventEmitter();
bus.setMaxListeners(1000);
const text = (value: unknown): string => String(value ?? '').trim();
const normalizeReference = (input: WorkflowLogReference): WorkflowLogReference => ({
  workflowId: text(input.workflowId) || null,
  executionId: text(input.executionId) || null,
  runId: text(input.runId) || null,
});

export const workflowEventTopic = (input: WorkflowLogReference): string => {
  const ref = normalizeReference(input);
  if (ref.executionId) return `execution:${ref.executionId}`;
  if (ref.runId) return `run:${ref.runId}`;
  if (ref.workflowId) return `workflow:${ref.workflowId}`;
  return 'workflow:*';
};

const candidateTopics = (event: WorkflowLiveEvent): string[] => {
  const topics = new Set<string>(['workflow:*']);
  if (event.workflowId) topics.add(`workflow:${event.workflowId}`);
  if (event.executionId) topics.add(`execution:${event.executionId}`);
  if (event.runId) topics.add(`run:${event.runId}`);
  return Array.from(topics);
};

export const publishWorkflowLiveEvent = (event: WorkflowLiveEvent): void => {
  for (const topic of candidateTopics(event)) bus.emit(topic, event);
};

export async function* listenWorkflowLiveEvents(
  input: WorkflowLogReference,
  options: { timeoutMs?: number | null } = {},
): AsyncGenerator<WorkflowLiveEvent> {
  const topic = workflowEventTopic(input);
  const queue: WorkflowLiveEvent[] = [];
  let done = false;
  const push = (event: WorkflowLiveEvent) => queue.push(event);
  bus.on(topic, push);
  const timeout =
    options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => {
          done = true;
        }, options.timeoutMs)
      : null;
  try {
    while (!done) {
      if (queue.length) {
        yield queue.shift() as WorkflowLiveEvent;
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    bus.off(topic, push);
    if (timeout) clearTimeout(timeout);
  }
}

export const resolveWorkflowExecution = async (reference: WorkflowLogReference): Promise<unknown | null> => {
  const executionId = text(reference.executionId);
  if (executionId && WorkflowExecutionEntity?.single) return WorkflowExecutionEntity.single(executionId);
  if (executionId && WorkflowExecutionEntity?.load) {
    const loaded = WorkflowExecutionEntity.load(executionId) as Record<string, unknown>;
    const fetch = loaded.fetch as (() => Promise<unknown>) | undefined;
    return fetch ? fetch.call(loaded) : loaded;
  }
  const runId = text(reference.runId);
  const workflowId = text(reference.workflowId);
  if (runId && WorkflowExecutionEntity?.getExecution) return WorkflowExecutionEntity.getExecution({ runId, workflowId });
  if (runId && WorkflowExecutionEntity?.find) return WorkflowExecutionEntity.find({ run_id: runId }).single?.() || null;
  return null;
};

export const fetchWorkflowLogs = async (input: WorkflowLogReference & { first?: number | null; offset?: number | null }) => {
  const execution = await resolveWorkflowExecution(input);
  const executionId = text(input.executionId || (execution as Record<string, unknown> | null)?.id);
  const first = Math.max(1, Math.min(Number(input.first || 100), 500));
  const offset = Math.max(0, Number(input.offset || 0));
  if (!executionId || !WorkflowLogEntity?.find) return { execution, executionId: executionId || null, logs: [], count: 0 };
  const query = WorkflowLogEntity.find({ workflow_execution_id: executionId });
  const logs = (await query.orderBy?.('created_at', 'asc').limit?.(first).offset?.(offset).many?.()) || [];
  return { execution, executionId, logs, count: logs.length };
};

export const fetchWorkflowEvents = async (input: WorkflowLogReference & { first?: number | null; offset?: number | null }) => {
  const execution = await resolveWorkflowExecution(input);
  const executionId = text(input.executionId || (execution as Record<string, unknown> | null)?.id);
  const first = Math.max(1, Math.min(Number(input.first || 100), 500));
  const offset = Math.max(0, Number(input.offset || 0));
  if (!executionId || !WorkflowEventEntity?.find) return { execution, executionId: executionId || null, events: [], count: 0 };
  const query = WorkflowEventEntity.find({ workflow_execution_id: executionId });
  const events = (await query.orderBy?.('created_at', 'asc').limit?.(first).offset?.(offset).many?.()) || [];
  return { execution, executionId, events, count: events.length };
};

export const appendWorkflowLogAndPublish = async (input: {
  executionId: string;
  workflowId?: string | null;
  runId?: string | null;
  level?: string | null;
  message: string;
  data?: Record<string, unknown> | null;
}) => {
  if (!WorkflowLogEntity?.append && !WorkflowLogEntity?.create) throw new Error('WorkflowLogEntity append/create is not available.');
  const payload = {
    executionId: input.executionId,
    workflow_execution_id: input.executionId,
    level: input.level || 'info',
    message: input.message,
    data: input.data || {},
  };
  const row = WorkflowLogEntity.append ? await WorkflowLogEntity.append(payload) : await WorkflowLogEntity.create?.(payload);
  publishWorkflowLiveEvent({
    type: 'workflow.log',
    executionId: input.executionId,
    workflowId: input.workflowId || null,
    runId: input.runId || null,
    payload: row,
    createdAt: new Date().toISOString(),
  });
  return row;
};

export const listRunningWorkflowExecutions = async (input: {
  workflowIds?: string[];
  organizationId?: string | null;
  userId?: string | null;
  first?: number | null;
}) => {
  if (!WorkflowExecutionEntity) return [];
  const first = Math.max(1, Math.min(Number(input.first || 100), 500));
  const ids = (input.workflowIds || []).map((value) => text(value)).filter(Boolean);
  let rows: unknown[] = [];
  if (WorkflowExecutionEntity.runningStatuses)
    rows = await WorkflowExecutionEntity.runningStatuses({
      workflowIds: ids,
      organizationId: input.organizationId || null,
      userId: input.userId || null,
      includeExecutions: true,
    });
  else if (WorkflowExecutionEntity.find) {
    let query = WorkflowExecutionEntity.find({}) as QueryBuilder<unknown>;
    if (query.whereIn) query = query.whereIn('status', ['queued', 'running']);
    if (ids.length && query.whereIn) query = query.whereIn('workflow_id', ids);
    rows = (await query.orderBy?.('started_at', 'desc').limit?.(first).many?.()) || [];
  }
  return rows.slice(0, first);
};

export const listWorkflowCatalog = async (input: {
  first?: number | null;
  offset?: number | null;
  userId?: string | null;
  organizationId?: string | null;
  effectiveRoot?: boolean | null;
  scope?: string | null;
}) => {
  const first = Math.max(1, Math.min(Number(input.first || 50), 500));
  const offset = Math.max(0, Number(input.offset || 0));
  if (!WorkflowEntity) return [];
  if ((input.effectiveRoot || input.scope === 'global') && (WorkflowEntity as Record<string, unknown>).listGlobalCatalog)
    return (WorkflowEntity as Record<string, (payload: Record<string, unknown>) => Promise<unknown>>).listGlobalCatalog({ first, offset });
  if (input.organizationId && (WorkflowEntity as Record<string, unknown>).listOrganizationCatalog)
    return (WorkflowEntity as Record<string, (payload: Record<string, unknown>) => Promise<unknown>>).listOrganizationCatalog({
      first,
      offset,
      organizationId: input.organizationId,
    });
  if ((WorkflowEntity as Record<string, unknown>).listAccessibleCatalog)
    return (WorkflowEntity as Record<string, (payload: Record<string, unknown>) => Promise<unknown>>).listAccessibleCatalog({
      first,
      offset,
      userId: input.userId || null,
      organizationId: input.organizationId || null,
    });
  return WorkflowEntity.find?.({ is_active: true }).orderBy?.('updated_at', 'desc').limit?.(first).offset?.(offset).many?.() || [];
};

export const appendWorkflowEventAndPublish = async (input: {
  executionId: string;
  workflowId?: string | null;
  runId?: string | null;
  type?: string | null;
  payload?: Record<string, unknown> | null;
}) => {
  if (!WorkflowEventEntity?.create) {
    const event: WorkflowLiveEvent = {
      type: 'workflow.event',
      executionId: input.executionId,
      workflowId: input.workflowId || null,
      runId: input.runId || null,
      payload: input.payload || {},
      createdAt: new Date().toISOString(),
    };
    publishWorkflowLiveEvent(event);
    return event;
  }
  const row = await WorkflowEventEntity.create({
    workflow_execution_id: input.executionId,
    executionId: input.executionId,
    type: input.type || 'workflow.event',
    payload: input.payload || {},
  });
  publishWorkflowLiveEvent({
    type: 'workflow.event',
    executionId: input.executionId,
    workflowId: input.workflowId || null,
    runId: input.runId || null,
    payload: row,
    createdAt: new Date().toISOString(),
  });
  return row;
};
