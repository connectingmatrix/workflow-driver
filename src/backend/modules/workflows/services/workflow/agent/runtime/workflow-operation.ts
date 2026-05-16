import { randomUUID } from 'node:crypto';
import { Executor } from '@workflow/executor';
import * as Entities from '@connectingmatrix/orm/repositories/entities';
import { EntityRequestContext } from '@connectingmatrix/orm/orm/request-entity-context';
import {
  fetchWorkflowEvents,
  fetchWorkflowLogs,
  listRunningWorkflowExecutions,
  listWorkflowCatalog,
  listenWorkflowLiveEvents,
  workflowEventTopic,
} from '../telemetry/workflow-log-events';
import { executeEntityAgentOperation } from './entity-operation';

type OperationInput = Record<string, unknown>;
type EntityClass = {
  load?: (id?: string) => Record<string, unknown>;
  create?: (payload: Record<string, unknown>) => Promise<unknown>;
  find?: (where?: Record<string, unknown>) => {
    many?: () => Promise<unknown[]>;
    orderBy?: (field: string, direction?: string) => unknown;
    limit?: (count: number) => unknown;
    offset?: (count: number) => unknown;
  };
};
const entityExports = Entities as unknown as Record<string, EntityClass>;
const { WorkflowEntity } = entityExports;
const { WorkflowExecutionEntity } = entityExports;

const text = (value: unknown): string => String(value ?? '').trim();
const record = (value: unknown): OperationInput => (value && typeof value === 'object' && !Array.isArray(value) ? (value as OperationInput) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const bool = (value: unknown): boolean => value === true || value === 'true' || value === 1 || value === '1';
const plain = (value: unknown): unknown => {
  const entity = value as { extract?: () => unknown } | null;
  if (entity && typeof entity.extract === 'function') return entity.extract();
  return value;
};

const workflowPayloadFromDraft = (draft: ReturnType<typeof Executor.compileWorkflow>, extras: OperationInput = {}) => {
  const ctx = EntityRequestContext.current();
  const userId = text(extras.user_id || extras.userId || ctx.caller.id);
  const organizationId = text(extras.organization_id || extras.organizationId || ctx.scope.organizationId || '');
  const workflow = {
    id: text(extras.id) || draft.id || randomUUID(),
    name: text(extras.name) || draft.name,
    description: text(extras.description) || draft.description,
    workflow: draft.workflow,
    metadata: { ...record(extras.metadata), ...draft.metadata },
    webhook_secret: text(extras.webhook_secret) || randomUUID().replace(/-/g, ''),
  } as OperationInput;
  if (userId) workflow.user_id = userId;
  if (organizationId) workflow.organization_id = organizationId;
  return workflow;
};

const workflowRef = (id: string): OperationInput => {
  if (!WorkflowEntity?.load) throw new Error('WorkflowEntity.load is not available.');
  return WorkflowEntity.load(id) as unknown as OperationInput;
};
const confirmationRequired = (summary: string, input: OperationInput) => ({
  status: 'confirmation_required',
  summary,
  operation: text(input.operation || input.action),
  workflow_id: text(input.workflowId || input.workflow_id || input.id),
});

const currentCatalogInput = (input: OperationInput) => {
  const ctx = EntityRequestContext.current();
  return {
    first: Number(input.first || input.limit || 50),
    offset: Number(input.offset || 0),
    userId: text(input.userId || input.user_id || ctx.caller.id),
    organizationId:
      text(input.organizationId || input.organization_id || ctx.scope.organizationId || (ctx.scope.type === 'organization' ? ctx.scope.id : '')) ||
      null,
    effectiveRoot: bool(input.effectiveRoot || input.effective_root || input.root || input.superAdmin),
    scope: text(input.scope || input.catalog),
  };
};

const createWorkflow = async (input: OperationInput, payload: OperationInput, prompt: string, executeAfterCreate: boolean) => {
  if (!WorkflowEntity?.create) throw new Error('WorkflowEntity.create is not available.');
  const draft = Executor.compileWorkflow({ ...input, ...payload, prompt });
  if (!draft.validation.ok) return { summary: 'Workflow was not created because validation failed.', draft, validation: draft.validation };
  const created = await WorkflowEntity.create(workflowPayloadFromDraft(draft, { ...payload, ...input }));
  if (!executeAfterCreate) return { summary: 'Workflow created.', workflow: plain(created), draft, effects: { refetch: ['workflow-list'] } };
  const exec = (created as OperationInput).execute as ((args?: OperationInput) => Promise<unknown>) | undefined;
  const execution = exec ? await exec.call(created, record(input.executionInput || input.input || input.execution_input)) : null;
  return {
    summary: 'Workflow created and executed.',
    workflow: plain(created),
    execution: plain(execution),
    draft,
    effects: { refetch: ['workflow-list', 'workflow-running'] },
  };
};

const executeWorkflow = async (workflowId: string, payload: OperationInput) => {
  if (!workflowId) throw new Error('execute requires workflowId.');
  const ref = workflowRef(workflowId);
  const execute = ref.execute as ((payload?: OperationInput) => Promise<unknown>) | undefined;
  if (!execute) throw new Error('Workflow execute is not available on WorkflowEntity.');
  const output = await execute.call(ref, payload);
  return { summary: 'Workflow execution started.', data: plain(output), effects: { refetch: ['workflow-running'] } };
};

const publishWorkflow = async (workflowId: string, payload: OperationInput) => {
  if (!workflowId) throw new Error('publish requires workflowId.');
  const ref = workflowRef(workflowId);
  const publish = ref.publish as ((payload?: OperationInput) => Promise<unknown>) | undefined;
  if (!publish) throw new Error('Workflow publish is not available on WorkflowEntity.');
  const output = await publish.call(ref, payload);
  return { summary: 'Workflow published.', data: plain(output), effects: { refetch: ['workflow-list'] } };
};

const updateWorkflow = async (operation: string, workflowId: string, payload: OperationInput, prompt: string) => {
  if (!workflowId) throw new Error(`${operation} requires workflowId.`);
  const ref = workflowRef(workflowId);
  const patch =
    operation === 'fix'
      ? { ...payload, metadata: { ...record(payload.metadata), repairPrompt: prompt, repairedAt: new Date().toISOString() } }
      : payload;
  const update = ref.update as ((patch: OperationInput) => Promise<unknown>) | undefined;
  if (!update) throw new Error('Workflow update is not available on WorkflowEntity.');
  const output = await update.call(ref, patch);
  return {
    summary: operation === 'fix' ? 'Workflow patch applied.' : 'Workflow updated.',
    data: plain(output),
    effects: { refetch: ['workflow-list'] },
  };
};

const stopWorkflowExecution = async (input: OperationInput) => {
  if (!WorkflowExecutionEntity?.load) throw new Error('WorkflowExecutionEntity.load is not available.');
  const executionId = text(input.executionId || input.execution_id || input.runId || input.run_id || input.id);
  if (!executionId) throw new Error('stop requires runId/executionId.');
  const execution = WorkflowExecutionEntity.load(executionId) as unknown as { update?: (patch: OperationInput) => Promise<unknown> };
  if (!execution.update) throw new Error('WorkflowExecution update is not available.');
  const output = await execution.update({
    status: 'cancelled',
    stopped_at: new Date().toISOString(),
    stop_reason: text(input.reason || 'Stopped by AI agent.'),
  });
  return { summary: 'Workflow execution stopped.', data: plain(output), effects: { refetch: ['workflow-running'] } };
};

const attachWorkflow = async (input: OperationInput) => {
  const workflowId = text(input.workflowId || input.workflow_id || input.id);
  const parentEntity = text(input.parentEntity || input.parent_entity || input.entity || 'Channel');
  const parentId = text(input.parentId || input.parent_id || input.channelId || input.channel_id || input.subjectId || input.categoryId);
  if (!parentId || !workflowId) throw new Error('attach requires parentId and workflowId.');
  return executeEntityAgentOperation({
    operation: 'attach',
    parentEntity,
    parentId,
    childEntity: 'Workflow',
    childId: workflowId,
    id: workflowId,
    relation: text(input.relation || 'workflows'),
    confirmed: input.confirmed === true,
  });
};

const debugWorkflow = async (input: OperationInput, workflowId: string, prompt: string) => {
  const executionId = text(input.executionId || input.runId || input.execution_id || input.run_id);
  const logs = await fetchWorkflowLogs({ workflowId, executionId, runId: executionId, first: Number(input.first || 200) });
  const failures = logs.logs.filter((row) => /error|fail|exception|timeout|cancel/i.test(JSON.stringify(row)));
  return {
    summary: failures.length ? `Found ${failures.length} failing log/event row(s).` : 'No obvious failure row found in workflow logs.',
    workflowId,
    executionId: logs.executionId || executionId,
    prompt,
    logs: logs.logs,
    failures,
    suggestedPatch: failures.length ? { metadata: { debugPrompt: prompt, failedRows: failures.slice(0, 10) } } : null,
  };
};

const workflowIdFromPreviousResults = (input: OperationInput): string => {
  const context = record(input.context);
  const workflowActionId = text(input.workflowActionId || input.workflow_action_id);
  const previousResults = list(context.previousResults);
  const readWorkflowId = (value: OperationInput): string =>
    text(
      value.workflowId ||
        value.workflow_id ||
        record(value.workflow).id ||
        record(value.workflow).workflowId ||
        record(record(value.data).workflow).id ||
        record(record(value.data).workflow).workflowId ||
        record(value.data).workflow_id ||
        record(value.data).workflowId,
    );
  for (const result of previousResults) {
    const item = record(result);
    const action = record(item.action);
    if (workflowActionId && text(action.id) !== workflowActionId) continue;
    const direct = readWorkflowId(item);
    if (direct) return direct;
    const output = record(item.output);
    const nested = readWorkflowId(output);
    if (nested) return nested;
  }
  return '';
};

const liveLogSnapshot = async (input: OperationInput) => {
  const reference = {
    workflowId: text(input.workflowId || input.workflow_id),
    executionId: text(input.executionId || input.execution_id),
    runId: text(input.runId || input.run_id),
  };
  const logs = await fetchWorkflowLogs({ ...reference, first: Number(input.first || 100), offset: Number(input.offset || 0) });
  const events = await fetchWorkflowEvents({ ...reference, first: Number(input.first || 100), offset: Number(input.offset || 0) });
  return {
    summary: 'Workflow live log subscription prepared.',
    topic: workflowEventTopic(reference),
    reference,
    snapshot: { logs: logs.logs, events: events.events },
    subscription: {
      graphQL:
        'subscription WorkflowLiveEvents($input: WorkflowRuntimeInput!) { workflowLiveEvents(input: $input) { type workflowId executionId runId payload createdAt } }',
      variables: { input: reference },
    },
  };
};

export const executeWorkflowAgentOperation = async (input: OperationInput) => {
  EntityRequestContext.current();
  const operation = text(input.operation || input.action || 'auto').toLowerCase();
  const workflowId = text(input.workflowId || input.workflow_id || input.id);
  const resolvedWorkflowId = workflowId || workflowIdFromPreviousResults(input);
  const payload = record(input.payload || input.data || input.workflow);
  const prompt = text(input.prompt || input.message || input.description);
  const confirmed = input.confirmed === true || record(input.context).confirmed === true;
  const requiresConfirmation = ['delete', 'cleanup', 'stop', 'swarm', 'delegate'].includes(operation);

  if (operation === 'auto') {
    return {
      summary: 'Workflow operation stayed in planning mode. Emit structured workflow.operation or workflow.compile action.',
      planned: true,
      operation,
      workflow_id: resolvedWorkflowId || null,
    };
  }
  if (operation === 'compile' || operation === 'validate' || operation === 'draft') {
    const draft = Executor.compileWorkflow({ ...input, ...payload });
    return {
      summary: draft.validation.ok ? 'Workflow draft compiled.' : 'Workflow draft compiled with validation errors.',
      draft,
      validation: draft.validation,
    };
  }
  if (operation === 'catalog' || operation === 'list_catalog')
    return { summary: 'Workflow catalog fetched.', data: await listWorkflowCatalog(currentCatalogInput(input)) };
  if (operation === 'list' || operation === 'many' || operation === 'find')
    return WorkflowEntity?.find?.(record(input.where || input.filter || {})).many?.() || [];
  if (operation === 'running' || operation === 'current_running' || operation === 'running_catalog') {
    const catalogInput = currentCatalogInput(input);
    return {
      summary: 'Current running workflow executions fetched.',
      data: await listRunningWorkflowExecutions({
        workflowIds: list(input.workflowIds || input.workflow_ids).map(String),
        organizationId: catalogInput.organizationId,
        userId: catalogInput.userId,
        first: catalogInput.first,
      }),
    };
  }
  if (operation === 'logs' || operation === 'fetch_logs')
    return {
      summary: 'Workflow logs fetched.',
      data: await fetchWorkflowLogs({
        workflowId,
        executionId: text(input.executionId || input.execution_id),
        runId: text(input.runId || input.run_id),
        first: Number(input.first || 100),
        offset: Number(input.offset || 0),
      }),
    };
  if (operation === 'events' || operation === 'fetch_events')
    return {
      summary: 'Workflow events fetched.',
      data: await fetchWorkflowEvents({
        workflowId,
        executionId: text(input.executionId || input.execution_id),
        runId: text(input.runId || input.run_id),
        first: Number(input.first || 100),
        offset: Number(input.offset || 0),
      }),
    };
  if (operation === 'listen_logs' || operation === 'live_logs' || operation === 'listen_events') return liveLogSnapshot(input);

  if (requiresConfirmation && !confirmed) return confirmationRequired(`${operation} workflow operation requires confirmation.`, input);

  if (operation === 'stop') return stopWorkflowExecution(input);
  if (operation === 'create' || operation === 'create_or_execute_chart_workflow')
    return createWorkflow(input, payload, prompt, operation === 'create_or_execute_chart_workflow' || bool(input.execute));
  if (operation === 'update' || operation === 'fix') return updateWorkflow(operation, resolvedWorkflowId, payload, prompt);
  if (operation === 'debug') return debugWorkflow(input, resolvedWorkflowId, prompt);
  if (operation === 'publish') return publishWorkflow(resolvedWorkflowId, payload);
  if (operation === 'attach') return attachWorkflow({ ...input, workflowId: resolvedWorkflowId });
  if (operation === 'execute' || operation === 'run') return executeWorkflow(resolvedWorkflowId, payload);
  if (operation === 'swarm' || operation === 'delegate') return launchWorkflowSwarm(input, prompt);
  if (operation === 'delete' || operation === 'cleanup') return deleteWorkflow(resolvedWorkflowId);
  throw new Error(`Unsupported workflow operation: ${operation}`);
};

const launchWorkflowSwarm = async (input: OperationInput, prompt: string) => {
  if (!WorkflowEntity?.create) throw new Error('WorkflowEntity.create is not available.');
  const tasks = list(input.tasks || input.agents || input.children).map(record);
  const created: unknown[] = [];
  const outputs: unknown[] = [];
  for (const task of tasks) {
    const draft = Executor.compileWorkflow({
      ...task,
      prompt: text(task.prompt || task.message || prompt),
      temporary: task.temporary !== false,
    });
    if (!draft.validation.ok) {
      outputs.push({ status: 'failed', task, validation: draft.validation });
      continue;
    }
    const workflow = await WorkflowEntity.create(workflowPayloadFromDraft(draft, task));
    created.push(plain(workflow));
    const execute = (workflow as OperationInput).execute as ((payload?: OperationInput) => Promise<unknown>) | undefined;
    if (execute && task.execute !== false) outputs.push(plain(await execute.call(workflow, record(task.input))));
  }
  if (input.cleanup === true) {
    for (const workflow of created) {
      const remove = (workflow as OperationInput).delete as (() => Promise<unknown>) | undefined;
      if (remove) await remove.call(workflow);
    }
  }
  return {
    summary: `Swarm completed with ${created.length} worker workflow(s).`,
    created,
    outputs,
    cleaned_up: input.cleanup === true,
    effects: { refetch: ['workflow-list', 'workflow-running'] },
  };
};

const deleteWorkflow = async (workflowId: string) => {
  if (!workflowId) throw new Error('delete requires workflowId.');
  const ref = workflowRef(workflowId);
  const remove = ref.delete as (() => Promise<unknown>) | undefined;
  if (!remove) throw new Error('Workflow delete is not available on WorkflowEntity.');
  const output = await remove.call(ref);
  return { summary: 'Workflow deleted.', data: plain(output), effects: { refetch: ['workflow-list'] } };
};

export { listenWorkflowLiveEvents };
