import { createStubLauncher } from './launcher.js';
import { PackageObservability } from './observability.js';
import { LocalEventBus, makeId, nowIso, type PackageHealth, type PackageModule, type PaginationOptions, type RequestContext } from './contracts.js';
import { InMemoryRepository, type BaseRecord } from './entity/repository.js';

export interface WorkflowRecord extends BaseRecord { name: string; description?: string; definition: Record<string, unknown>; publishedVersionId?: string; }
export interface WorkflowVersion extends BaseRecord { workflowId: string; definition: Record<string, unknown>; version: number; published: boolean; }
export interface WorkflowExecution extends BaseRecord { workflowId: string; status: 'queued' | 'running' | 'success' | 'error' | 'aborted'; input?: unknown; output?: unknown; logs: string[]; processId: string; }
export interface WorkflowDebugEvent extends BaseRecord { workflowId: string; sessionId: string; role: 'user'|'assistant'|'system'; content: string; metadata?: Record<string, unknown>; }
export interface WorkflowAISession extends BaseRecord { workflowId?: string; browserContext: Record<string, unknown>; messages: number; }
export interface WorkflowValidation { valid: boolean; errors: string[]; nodes: number; }
export type ExecutorAdapter = (workflow: WorkflowRecord, input: unknown, context: RequestContext) => Promise<{ output?: unknown; logs?: string[] }> | { output?: unknown; logs?: string[] };
export type WorkflowAIAgentAdapter = (input: { workflow?: WorkflowRecord; message: string; sessionId: string; mode: 'build'|'debug'|'run'|'execute'; preservedWorkflowContract?: string }, context: RequestContext) => Promise<{ message: string; definitionPatch?: Record<string, unknown>; executeInput?: unknown; actions?: string[] }> | { message: string; definitionPatch?: Record<string, unknown>; executeInput?: unknown; actions?: string[] };
export interface NodesAdapter { importNodePackage?: (archive: unknown, context?: RequestContext) => Promise<unknown> | unknown; getObject?: (id: string, context?: RequestContext) => unknown; }
export interface GigaAgentsAdapter { workflowAIAgent?: () => { run: (input: { message: string; workflow: WorkflowRecord; execute: (input?: unknown)=>Promise<unknown>; browserContext: Record<string, unknown> }, context: RequestContext) => Promise<{ output?: string; actions?: string[]; workflow?: unknown; validation?: unknown; execution?: unknown }> }; runWorkflowAgent?: (input: { prompt: string; workflowId?: string; debug?: boolean; execute?: boolean }, context?: RequestContext) => Promise<{ artifact?: unknown }> | { artifact?: unknown }; }
export interface ProcessMonitoringLike { start?: (input: { kind: string; packageName: string; title: string; targetId?: string; context?: RequestContext; metadata?: Record<string, unknown> }) => { id?: string; processId?: string }; register?: (input: { processId: string; kind?: string; packageName?: string; name?: string; metadata?: Record<string, unknown> }, context?: RequestContext) => unknown; heartbeat?: (processId: string, input?: { status?: string; message?: string; metadata?: Record<string, unknown> }) => unknown; appendLog?: (processId: string, level: 'debug'|'info'|'warn'|'error', message: string, data?: unknown) => unknown; complete?: (processId: string, metadata?: Record<string, unknown>) => unknown; fail?: (processId: string, error: unknown, metadata?: Record<string, unknown>) => unknown; abort?: (processId: string, reason?: string) => unknown; }

const workflows = new InMemoryRepository<WorkflowRecord>('workflow');
const versionsRepo = new InMemoryRepository<WorkflowVersion>('workflow_version');
const execs = new InMemoryRepository<WorkflowExecution>('workflow_exec');
const debugEvents = new InMemoryRepository<WorkflowDebugEvent>('workflow_debug');
const aiSessions = new InMemoryRepository<WorkflowAISession>('workflow_ai_session');
const bus = new LocalEventBus();
let executorAdapter: ExecutorAdapter | undefined;
let workflowAgentAdapter: WorkflowAIAgentAdapter | undefined;
let nodesAdapter: NodesAdapter | undefined;
let gigaAgents: GigaAgentsAdapter | undefined;
let processMonitoring: ProcessMonitoringLike | undefined;
let preservedWorkflowAIConfigured = false;

function processIdOf(row: { id?: string; processId?: string } | undefined, fallback: string) { return row?.id ?? row?.processId ?? fallback; }
function workflowSummary(workflow: WorkflowRecord): string { return `${workflow.id} :: ${workflow.name}${workflow.description ? ` — ${workflow.description}` : ''}`; }
function nodeArray(definition: Record<string, unknown>): unknown[] { return Array.isArray(definition.nodes) ? definition.nodes : []; }
function edgeArray(definition: Record<string, unknown>): unknown[] { return Array.isArray(definition.edges) ? definition.edges : []; }
function defaultWorkflowAgent(input: { workflow?: WorkflowRecord; message: string; mode: 'build'|'debug'|'run'|'execute' }): { message: string; definitionPatch?: Record<string, unknown>; executeInput?: unknown; actions: string[] } { const name = input.workflow?.name ?? 'New workflow'; const actions = [`workflow-ai-${input.mode}`]; return { message: `Workflow AI ${input.mode} for ${name}: ${input.message}`, definitionPatch: input.mode === 'build' && !input.workflow ? { nodes: [], edges: [] } : undefined, executeInput: input.mode === 'execute' || input.mode === 'run' ? { source: 'workflow-ai' } : undefined, actions }; }
function recordDebug(workflowId: string, sessionId: string, role: WorkflowDebugEvent['role'], content: string, context: RequestContext, metadata?: Record<string, unknown>) { return debugEvents.create({ workflowId, sessionId, role, content, metadata }, context); }
function nameFromPrompt(prompt: string, fallback: string) { return (prompt.match(/name:\s*([^,\n]+)/i)?.[1] ?? fallback).trim(); }


export interface WorkflowQueueStatus {
  processId: string;
  executionId: string;
  runId: string;
  workflowId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted';
  progress: number;
  source: 'executor-kafka' | 'local';
  updatedAt: string;
  logs: string[];
  metadata?: Record<string, unknown>;
}
export interface WorkflowExecutorPubSubBridge {
  queueWorkflowForExecution?: (config?: unknown) => { connect?: () => Promise<void>; disconnect?: () => Promise<void>; publish: (request: Record<string, unknown>) => Promise<void> };
  consumeWorkflowExecutionEvents?: (options: { applyExecutionEvent: (event: Record<string, unknown>) => Promise<void> | void; config?: unknown; handleExecutionEventError?: (params: { error: unknown; event: unknown }) => Promise<void> | void }) => { start: () => Promise<void>; stop: (params?: { force?: boolean }) => Promise<void> };
  cancelRun?: (runId: string) => number | Promise<number>;
  cancelWorkflow?: (workflowId: string) => number | Promise<number>;
  getRunning?: (workflowId?: string | null) => Array<Record<string, unknown>>;
}
const workflowQueueStatuses = new Map<string, WorkflowQueueStatus>();
const workflowExecutionToRecord = new Map<string, string>();
const workflowRunToProcess = new Map<string, string>();
let workflowExecutorPubSub: WorkflowExecutorPubSubBridge | undefined;
let workflowExecutorConfig: unknown;
let workflowQueueProducer: Awaited<ReturnType<NonNullable<WorkflowExecutorPubSubBridge['queueWorkflowForExecution']>>> | undefined;
let workflowQueueConsumer: ReturnType<NonNullable<WorkflowExecutorPubSubBridge['consumeWorkflowExecutionEvents']>> | undefined;
function workflowQueueProcessId(runId: string) { return `workflow:run:${runId}`; }
function workflowQueueUser(context: RequestContext) { return context.userId ?? context.organizationId ?? 'anonymous'; }
function workflowQueueScope(context: RequestContext): 'user'|'organization'|'global' { return context.organizationId ? 'organization' : context.root ? 'global' : 'user'; }
function workflowQueueRequest(wf: WorkflowRecord, executionId: string, runId: string, input: unknown, context: RequestContext): Record<string, unknown> {
  const userId = workflowQueueUser(context);
  const workflowDefinition = { metadata: { ...(wf.definition.metadata as Record<string, unknown> | undefined), id: wf.id, name: wf.name }, nodes: nodeArray(wf.definition), connections: edgeArray(wf.definition), edges: edgeArray(wf.definition), input };
  return { executionId, runId, queueKey: context.organizationId ? `org:${context.organizationId}` : `user:${userId}`, userId, broadcastId: userId, broadcastChannelName: 'workflow-socket', triggerType: 'designer', workflowReference: { workflowId: wf.id, scope: workflowQueueScope(context), organizationId: context.organizationId ?? null, ownerUserId: context.userId ?? null }, workflowVersionId: wf.publishedVersionId ?? null, workflow: workflowDefinition, settings: { package: '@connectingmatrix/workflows', mode: 'queued' }, requestContext: { mode: context.root ? 'admin' : 'user', userId, authorization: context.headers?.authorization ?? null, headers: context.headers ?? {}, path: '/workflows/execute', body: input }, metadata: { packageName: '@connectingmatrix/workflows', source: 'connectingmatrix-workflows' } };
}
function workflowQueueApply(event: Record<string, unknown>, context: RequestContext = {}): WorkflowQueueStatus {
  const runId = String(event.runId ?? event.processId ?? makeId('run'));
  const executionId = String(event.executionId ?? runId);
  const workflowId = String(event.workflowId ?? (event.workflowReference && typeof event.workflowReference === 'object' ? (event.workflowReference as Record<string, unknown>).workflowId : '') ?? 'unknown');
  const processId = workflowRunToProcess.get(runId) ?? workflowQueueProcessId(runId);
  const type = String(event.type ?? event.status ?? 'running').toLowerCase();
  const status: WorkflowQueueStatus['status'] = type === 'completed' || type === 'success' ? 'completed' : type === 'failed' || type === 'error' ? 'failed' : type === 'aborted' || type === 'cancelled' ? 'aborted' : type === 'queued' ? 'queued' : 'running';
  const log = event.log && typeof event.log === 'object' ? event.log as Record<string, unknown> : undefined;
  const message = String(log?.message ?? event.errorMessage ?? event.message ?? (status === 'completed' ? 'Workflow completed' : status === 'failed' ? 'Workflow failed' : status === 'queued' ? 'Workflow queued' : 'Workflow running'));
  const previous = workflowQueueStatuses.get(processId);
  const next: WorkflowQueueStatus = { processId, executionId, runId, workflowId, status, progress: status === 'queued' ? 0 : status === 'running' ? 50 : 100, source: 'executor-kafka', updatedAt: nowIso(), logs: [...(previous?.logs ?? []), message].slice(-500), metadata: { event } };
  workflowQueueStatuses.set(processId, next);
  workflowRunToProcess.set(runId, processId);
  const recordId = workflowExecutionToRecord.get(executionId);
  if (recordId) {
    const mapped = status === 'completed' ? 'success' : status === 'failed' ? 'error' : status === 'aborted' ? 'aborted' : status;
    try { execs.update(recordId, { status: mapped as WorkflowExecution['status'], logs: next.logs, output: status === 'completed' ? (event.result ?? event.payload) : undefined }, { root: true }); } catch {}
  }
  processMonitoring?.heartbeat?.(processId, { status: status === 'failed' ? 'error' : status === 'aborted' ? 'stale' : 'ok', message, metadata: { workflowId, executionId, runId, queue: 'redpanda' } });
  processMonitoring?.appendLog?.(processId, status === 'failed' ? 'error' : 'info', message, { event });
  if (status === 'completed') processMonitoring?.complete?.(processId, { workflowId, executionId, runId });
  if (status === 'failed') processMonitoring?.fail?.(processId, event.errorMessage ?? message, { workflowId, executionId, runId });
  if (status === 'aborted') processMonitoring?.abort?.(processId, message);
  void bus.emit('workflow:queue-status', next);
  return next;
}
async function ensureWorkflowQueueStarted(): Promise<void> {
  if (!workflowExecutorPubSub) return;
  if (!workflowQueueProducer && workflowExecutorPubSub.queueWorkflowForExecution) {
    workflowQueueProducer = workflowExecutorPubSub.queueWorkflowForExecution(workflowExecutorConfig);
    await workflowQueueProducer.connect?.();
  }
  if (!workflowQueueConsumer && workflowExecutorPubSub.consumeWorkflowExecutionEvents) {
    workflowQueueConsumer = workflowExecutorPubSub.consumeWorkflowExecutionEvents({ applyExecutionEvent: (event) => { workflowQueueApply(event as Record<string, unknown>); }, config: workflowExecutorConfig });
    await workflowQueueConsumer.start();
  }
}
export const Workflows = {
  bindWithServer(_endpoint: string) { return Workflows; },
  bindLogger(logger: unknown) { PackageObservability.bind({ logger: logger as never }); return Workflows; },
  bindSockets(sockets: unknown) { PackageObservability.bind({ sockets: sockets as never }); return Workflows; },
  bindProcessMonitor(monitor: ProcessMonitoringLike) { processMonitoring = monitor; return Workflows; },
  bindProcessMonitoring(monitor: ProcessMonitoringLike) { processMonitoring = monitor; return Workflows; },
  setExecutorAdapter(adapter: ExecutorAdapter) { executorAdapter = adapter; return Workflows; },
  bindNodes(adapter: NodesAdapter) { nodesAdapter = adapter; return Workflows; },
  bindWorkflowAgent(adapter: WorkflowAIAgentAdapter) { workflowAgentAdapter = adapter; preservedWorkflowAIConfigured = true; return Workflows; },
  useWorkflowAIAgent(adapter: WorkflowAIAgentAdapter | GigaAgentsAdapter) { if (typeof adapter === 'function') return Workflows.bindWorkflowAgent(adapter); return Workflows.bindGigaAgents(adapter as GigaAgentsAdapter); },
  bindGigaAgents(adapter: GigaAgentsAdapter) { gigaAgents = adapter; preservedWorkflowAIConfigured = true; if (adapter.workflowAIAgent) { const agent = adapter.workflowAIAgent(); workflowAgentAdapter = async (input, context) => { const result = await agent.run({ message: input.message, workflow: input.workflow as WorkflowRecord, execute: (runInput) => Workflows.execute((input.workflow as WorkflowRecord).id, runInput, context), browserContext: { sessionId: input.sessionId, mode: input.mode } }, context); return { message: result.output ?? JSON.stringify(result), actions: result.actions ?? ['giga-workflow-agent'], executeInput: result.execution ? undefined : input.mode === 'execute' ? { source: 'workflow-ai' } : undefined }; }; } else if (adapter.runWorkflowAgent) { workflowAgentAdapter = async (input, context) => { const result = await adapter.runWorkflowAgent!({ prompt: input.message, workflowId: input.workflow?.id, debug: true, execute: /\b(run|execute)\b/i.test(input.message) || input.mode === 'execute' }, context); return { message: JSON.stringify(result.artifact ?? result), actions: ['giga-workflow-agent'], executeInput: input.mode === 'execute' ? { source: 'workflow-ai' } : undefined }; }; } return Workflows; },
  configurePreservedWorkflowAI(adapter?: WorkflowAIAgentAdapter | { run: (input: { message: string; workflow: WorkflowRecord; execute: (input?: unknown) => Promise<unknown>; browserContext: Record<string, unknown> }, context: RequestContext) => Promise<{ output?: string; actions?: string[]; execution?: unknown }> }) { if (adapter) { if (typeof adapter === 'function') workflowAgentAdapter = adapter; else workflowAgentAdapter = async (input, context) => { const result = await adapter.run({ message: input.message, workflow: input.workflow as WorkflowRecord, execute: (runInput) => Workflows.execute((input.workflow as WorkflowRecord).id, runInput, context), browserContext: { sessionId: input.sessionId, mode: input.mode } }, context); return { message: result.output ?? JSON.stringify(result), actions: result.actions ?? ['giga-workflow-agent'], executeInput: result.execution ? undefined : input.mode === 'execute' ? { source: 'workflow-ai' } : undefined }; }; } preservedWorkflowAIConfigured = true; return Workflows; },
  getList(pagination: PaginationOptions = {}, context: RequestContext = {}) { return workflows.list(context, pagination); },
  getObject(id: string, context: RequestContext = {}) { return workflows.get(id, context); },
  search(term: string, context: RequestContext = {}) { return workflows.search(term, context, ['name', 'description']); },
  create(input: { name: string; description?: string; definition?: Record<string, unknown> }, context: RequestContext = {}) { const wf = workflows.create({ name: input.name, description: input.description, definition: input.definition ?? { nodes: [], edges: [] } }, context); versionsRepo.create({ workflowId: wf.id, definition: wf.definition, version: 1, published: false }, context); void bus.emit('workflow:catalog', wf); return wf; },
  update(id: string, patch: Partial<WorkflowRecord>, context: RequestContext = {}) { const wf = workflows.update(id, patch, context); const count = versionsRepo.list(context, { limit: 500 }).items.filter((v) => v.workflowId === id).length; versionsRepo.create({ workflowId: id, definition: wf.definition, version: count + 1, published: false }, context); void bus.emit('workflow:catalog', wf); return wf; },
  delete(id: string, context: RequestContext = {}) { return workflows.delete(id, context); },
  validate(id: string, context: RequestContext = {}): WorkflowValidation { const wf = workflows.get(id, context); if (!wf) throw new Error('Workflow not found'); const nodes = nodeArray(wf.definition); const edges = edgeArray(wf.definition); const errors: string[] = []; if (!Array.isArray(wf.definition.nodes)) errors.push('definition.nodes must be an array'); if (!Array.isArray(wf.definition.edges)) errors.push('definition.edges must be an array'); const nodeIds = new Set(nodes.map((node) => typeof node === 'object' && node ? String((node as { id?: unknown }).id ?? '') : '').filter(Boolean)); for (const edge of edges) { if (!edge || typeof edge !== 'object') continue; const source = String((edge as { source?: unknown }).source ?? ''); const target = String((edge as { target?: unknown }).target ?? ''); if (source && !nodeIds.has(source)) errors.push(`edge source is missing node: ${source}`); if (target && !nodeIds.has(target)) errors.push(`edge target is missing node: ${target}`); } return { valid: errors.length === 0, errors, nodes: nodes.length }; },
  async execute(id: string, input?: unknown, context: RequestContext = {}) { const wf = workflows.get(id, context); if (!wf) throw new Error('Workflow not found'); const validation = Workflows.validate(id, context); if (!validation.valid) throw new Error(`Workflow validation failed: ${validation.errors.join('; ')}`); const fallbackPid = `workflow-exec:${makeId('workflow_exec')}`; const proc = processMonitoring?.start?.({ kind: 'Workflows', packageName: '@connectingmatrix/workflows', title: `Workflow ${wf.name}`, targetId: fallbackPid, context, metadata: { workflowId: id } }); const processId = processIdOf(proc, fallbackPid); const execution = execs.create({ workflowId: id, status: 'running', input, logs: ['Execution started'], processId }, context); PackageObservability.track(processId, { label: `Workflow ${wf.name}`, status: 'running', progress: 25, context: { processKind: 'Workflows', workflowId: id, executionId: execution.id } }, context); processMonitoring?.appendLog?.(processId, 'info', 'Workflow execution started', { workflowId: id, executionId: execution.id }); await bus.emit('workflow:execute', execution); try { const adapterResult = executorAdapter ? await executorAdapter(wf, input, context) : { output: { ok: true, workflowId: id, nodeCount: validation.nodes }, logs: ['No external executor adapter configured; static validated execution completed'] }; const done = execs.update(execution.id, { status: 'success', output: adapterResult.output, logs: ['Execution started', ...(adapterResult.logs ?? []), 'Execution completed'] }, context); processMonitoring?.complete?.(processId, { workflowId: id, executionId: execution.id }); PackageObservability.track(processId, { label: `Workflow ${wf.name}`, status: 'completed', progress: 100, context: { processKind: 'Workflows', workflowId: id, executionId: execution.id } }, context); await bus.emit('workflow:execute', done); return done; } catch (error) { const failed = execs.update(execution.id, { status: 'error', logs: ['Execution started', error instanceof Error ? error.message : String(error)] }, context); processMonitoring?.fail?.(processId, error, { workflowId: id, executionId: execution.id }); PackageObservability.track(processId, { label: `Workflow ${wf.name}`, status: 'failed', progress: 100, context: { processKind: 'Workflows', workflowId: id, executionId: execution.id } }, context); await bus.emit('workflow:execute', failed); throw error; } },
  abortExecution(executionId: string, context: RequestContext = {}) { const execution = execs.get(executionId, context); if (!execution) throw new Error(`Workflow execution not found: ${executionId}`); const row = execs.update(executionId, { status: 'aborted', logs: [...execution.logs, 'Execution aborted'] }, context); processMonitoring?.abort?.(execution.processId, 'workflow execution aborted'); PackageObservability.track(execution.processId, { label: `Workflow execution ${executionId}`, status: 'aborted', progress: 100, context: { processKind: 'Workflows', executionId } }, context); return row; },
  versions(workflowId: string, context: RequestContext = {}) { return versionsRepo.list(context, { limit: 500 }).items.filter((v) => v.workflowId === workflowId); },
  versionsDelete(workflowId: string, versionId: string, context: RequestContext = {}) { const version = versionsRepo.get(versionId, context); if (version?.workflowId !== workflowId) return false; return versionsRepo.delete(versionId, context); },
  versionsPublish(workflowId: string, versionId: string, context: RequestContext = {}) { const version = versionsRepo.get(versionId, context); if (!version || version.workflowId !== workflowId) throw new Error('Version not found'); versionsRepo.update(versionId, { published: true }, context); workflows.update(workflowId, { publishedVersionId: versionId, definition: version.definition }, context); return version; },
  executions: { list(workflowId?: string, context: RequestContext = {}) { const list = execs.list(context, { limit: 500 }).items; return workflowId ? list.filter((e) => e.workflowId === workflowId) : list; } },
  onWorkflowExecute(handler: (execution: WorkflowExecution) => void | Promise<void>) { return bus.on('workflow:execute', handler); },
  onWorkflowCatalog(handler: (workflow: WorkflowRecord) => void | Promise<void>) { return bus.on('workflow:catalog', handler); },
  openDesigner(id: string, context: RequestContext = {}) { const wf = workflows.get(id, context); if (!wf) throw new Error('Workflow not found'); return { workflow: wf, designer: '@workflow/ui', contract: 'preserved', workflowAIConfigured: preservedWorkflowAIConfigured, panels: ['canvas','catalog','executions','versions','workflow-ai'] }; },
  startAISession(workflowId?: string, browserContext: Record<string, unknown> = {}, context: RequestContext = {}) { if (workflowId) workflows.get(workflowId, context); const session = aiSessions.create({ workflowId, browserContext, messages: 0 }, context); if (workflowId) recordDebug(workflowId, session.id, 'system', 'Workflow AI session started', context); return session; },
  async buildWithAI(input: { message: string; workflowId?: string; sessionId?: string; name?: string }, context: RequestContext = {}) { const sessionId = input.sessionId ?? Workflows.startAISession(input.workflowId, {}, context).id; const workflow = input.workflowId ? workflows.get(input.workflowId, context) : undefined; const assistant = workflowAgentAdapter ? await workflowAgentAdapter({ workflow, message: input.message, sessionId, mode: 'build', preservedWorkflowContract: 'workflow-ai' }, context) : defaultWorkflowAgent({ workflow, message: input.message, mode: 'build' }); const wf = workflow ? Workflows.update(workflow.id, { definition: { ...workflow.definition, ...(assistant.definitionPatch ?? {}) } }, context) : Workflows.create({ name: input.name ?? nameFromPrompt(input.message, 'AI Workflow'), description: input.message, definition: assistant.definitionPatch ?? { nodes: [], edges: [] } }, context); recordDebug(wf.id, sessionId, 'assistant', assistant.message, context, { actions: assistant.actions }); return { workflow: wf, sessionId, message: assistant.message, actions: assistant.actions ?? ['workflow-ai-build'] }; },
  async debugWithAI(arg1: string, arg2: { message: string; sessionId?: string; execute?: boolean } | string, arg3: RequestContext = {}) { const session = aiSessions.get(arg1, arg3); const workflowId = session?.workflowId ?? arg1; const context = session ? arg3 : arg3; const input = typeof arg2 === 'string' ? { message: arg2, sessionId: session?.id, execute: /\b(run|execute)\b/i.test(arg2) } : arg2; const wf = workflows.get(workflowId, context); if (!wf) throw new Error('Workflow not found'); const sessionId = input.sessionId ?? session?.id ?? Workflows.startAISession(workflowId, {}, context).id; recordDebug(workflowId, sessionId, 'user', input.message, context); const mode = input.execute ? 'execute' : (/\b(run|execute)\b/i.test(input.message) ? 'execute' : 'debug'); const assistant = workflowAgentAdapter ? await workflowAgentAdapter({ workflow: wf, message: input.message, sessionId, mode, preservedWorkflowContract: 'workflow-ai' }, context) : defaultWorkflowAgent({ workflow: wf, message: input.message, mode }); if (assistant.definitionPatch) Workflows.update(workflowId, { definition: { ...wf.definition, ...assistant.definitionPatch } }, context); const execution = input.execute || assistant.executeInput !== undefined || /\b(run|execute)\b/i.test(input.message) ? await Workflows.execute(workflowId, assistant.executeInput, context) : undefined; recordDebug(workflowId, sessionId, 'assistant', assistant.message, context, { actions: assistant.actions }); if (session) aiSessions.update(session.id, { messages: session.messages + 2 }, context); return { sessionId, message: assistant.message, actions: assistant.actions ?? ['workflow-ai-debug'], workflow: Workflows.getObject(workflowId, context), execution }; },
  async runWithAI(workflowId: string, message: string, context: RequestContext = {}) { return Workflows.debugWithAI(workflowId, { message, execute: true }, context); },
  async importNodePackage(archive: unknown, context: RequestContext = {}) { if (!nodesAdapter?.importNodePackage) throw new Error('@connectingmatrix/nodes must be bound through Workflows.bindNodes(...) to import .node packages'); const node = await nodesAdapter.importNodePackage(archive, context); return { importedNode: node, workflowCatalogRefresh: true }; },
  async importNodePackageToWorkflow(workflowId: string, archive: unknown, position: Record<string, unknown> = {}, context: RequestContext = {}) { const wf = workflows.get(workflowId, context); if (!wf) throw new Error('Workflow not found'); if (!nodesAdapter?.importNodePackage) throw new Error('@connectingmatrix/nodes must be bound through Workflows.bindNodes(...) to import .node packages'); const node = await nodesAdapter.importNodePackage(archive, context) as { id?: string; name?: string }; const currentNodes = nodeArray(wf.definition); const nextNode = { id: node.id ?? makeId('node'), type: 'user-node', label: node.name ?? 'Imported Node', nodePackageImported: true, ...position }; const updated = Workflows.update(workflowId, { definition: { ...wf.definition, nodes: [...currentNodes, nextNode], edges: edgeArray(wf.definition) } }, context); return { node, workflow: updated }; },
  getDebugEvents(workflowId?: string, context: RequestContext = {}) { const rows = debugEvents.list(context, { limit: 500 }).items; return workflowId ? rows.filter((row)=>row.workflowId===workflowId) : rows; },
  slash(args: string[], context: RequestContext = {}) { const [action = 'help', ...rest] = args; if (action === 'list') { const rows = Workflows.getList({ limit: 25 }, context).items; return rows.length ? rows.map(workflowSummary).join('\n') : 'No workflows found for this scope.'; } if (action === 'search') { const rows = Workflows.search(rest.join(' '), context); return rows.length ? rows.map(workflowSummary).join('\n') : 'No workflows matched the search.'; } if (action === 'validate') return Workflows.validate(rest[0] ?? '', context); if (action === 'execute') return Workflows.execute(rest[0] ?? '', {}, context); if (action === 'debug') return Workflows.debugWithAI(rest[0] ?? '', { message: rest.slice(1).join(' ') || 'Debug workflow' }, context); return 'Workflow commands: /workflow list, /workflow search <term>, /workflow validate <id>, /workflow execute <id>, /workflow debug <id> <message>'; },
  health(): PackageHealth { return { name: '@connectingmatrix/workflows', status: 'ok', checkedAt: nowIso(), details: { workflows: workflows.list({ root: true }).total, executions: execs.list({ root: true }).total, debugEvents: debugEvents.list({ root: true }).total, executorAdapter: Boolean(executorAdapter), executorPubSubBound: Boolean(workflowExecutorPubSub), queueStatuses: workflowQueueStatuses.size, workflowAgentBound: Boolean(workflowAgentAdapter), preservedWorkflowAIConfigured, nodesAdapterBound: Boolean(nodesAdapter), processMonitoring: Boolean(processMonitoring), ...PackageObservability.healthDetails() } }; },
};


const originalWorkflowExecute = Workflows.execute.bind(Workflows);
async function executeWorkflowThroughQueue(id: string, input?: unknown, context: RequestContext = {}): Promise<WorkflowExecution> {
  const wf = workflows.get(id, context);
  if (!wf) throw new Error('Workflow not found');
  const validation = Workflows.validate(id, context);
  if (!validation.valid) throw new Error(`Workflow validation failed: ${validation.errors.join('; ')}`);
  await ensureWorkflowQueueStarted();
  if (!workflowQueueProducer) return originalWorkflowExecute(id, input, context);
  const executionId = makeId('workflow_exec');
  const runId = makeId('workflow_run');
  const processId = workflowQueueProcessId(runId);
  workflowRunToProcess.set(runId, processId);
  const proc = processMonitoring?.start?.({ kind: 'Workflows', packageName: '@connectingmatrix/workflows', title: `Workflow ${wf.name}`, targetId: processId, context, metadata: { workflowId: id, executionId, runId, queue: 'redpanda' } });
  const finalProcessId = processIdOf(proc, processId);
  workflowRunToProcess.set(runId, finalProcessId);
  const execution = execs.create({ workflowId: id, status: 'queued', input, logs: ['Execution queued through giga-wf-executor Redpanda pub/sub'], processId: finalProcessId }, context);
  workflowExecutionToRecord.set(executionId, execution.id);
  workflowQueueStatuses.set(finalProcessId, { processId: finalProcessId, executionId, runId, workflowId: id, status: 'queued', progress: 0, source: 'executor-kafka', updatedAt: nowIso(), logs: ['Execution queued through giga-wf-executor Redpanda pub/sub'] });
  processMonitoring?.heartbeat?.(finalProcessId, { status: 'ok', message: 'Workflow execution queued on Redpanda', metadata: { workflowId: id, executionId, runId } });
  await workflowQueueProducer.publish(workflowQueueRequest(wf, executionId, runId, input, context));
  await bus.emit('workflow:execute', execution);
  await bus.emit('workflow:queue-status', workflowQueueStatuses.get(finalProcessId));
  return execution;
}
(Workflows as unknown as { execute: typeof Workflows.execute }).execute = executeWorkflowThroughQueue;
Object.assign(Workflows, {
  bindExecutorPubSub(executor: WorkflowExecutorPubSubBridge, config?: unknown) { workflowExecutorPubSub = executor; workflowExecutorConfig = config; return Workflows; },
  bindWorkflowExecutor(executor: WorkflowExecutorPubSubBridge, config?: unknown) { return (Workflows as unknown as { bindExecutorPubSub: (e: WorkflowExecutorPubSubBridge, c?: unknown) => typeof Workflows }).bindExecutorPubSub(executor, config); },
  async startExecutorPubSub() { await ensureWorkflowQueueStarted(); return { producer: Boolean(workflowQueueProducer), consumer: Boolean(workflowQueueConsumer) }; },
  applyExecutorQueueEvent(event: Record<string, unknown>, context: RequestContext = {}) { return workflowQueueApply(event, context); },
  executionQueueStatus(workflowId?: string) { const rows = [...workflowQueueStatuses.values(), ...(workflowExecutorPubSub?.getRunning?.(workflowId ?? null) ?? []).map((row) => workflowQueueApply({ ...(row as Record<string, unknown>), type: 'running' }))]; return workflowId ? rows.filter((row) => row.workflowId === workflowId) : rows; },
  queueStatus(workflowId?: string) { return (Workflows as unknown as { executionQueueStatus: (workflowId?: string)=>WorkflowQueueStatus[] }).executionQueueStatus(workflowId); },
  onWorkflowQueueStatus(handler: (status: WorkflowQueueStatus) => void | Promise<void>) { return bus.on('workflow:queue-status', handler); },
  onWorkflowExecutionEvent(handler: (status: WorkflowQueueStatus) => void | Promise<void>) { return bus.on('workflow:queue-status', handler); },
  async abortExecution(runIdOrProcessId: string, reason = 'aborted by user') { const status = workflowQueueStatuses.get(runIdOrProcessId) ?? [...workflowQueueStatuses.values()].find((row) => row.runId === runIdOrProcessId || row.executionId === runIdOrProcessId); const runId = status?.runId ?? runIdOrProcessId; const count = await workflowExecutorPubSub?.cancelRun?.(runId); if (status) workflowQueueApply({ ...status, type: 'aborted', message: reason }); else processMonitoring?.abort?.(runIdOrProcessId, reason); return { runId, cancelled: count ?? 0, reason }; },
});
const WorkflowApi = Workflows as typeof Workflows & { versions: typeof Workflows.versions & { delete: typeof Workflows.versionsDelete; publish: typeof Workflows.versionsPublish } };
Object.assign(WorkflowApi.versions, { delete: Workflows.versionsDelete, publish: Workflows.versionsPublish });
export const Workflow = WorkflowApi;
export const workflowSlashCommands = [ { command: '/workflow', owner: '@connectingmatrix/workflows', description: 'List/search/validate/execute/debug workflows', handler: (args: string[], context: RequestContext) => Workflows.slash(args, context) } ];
export function openDesignerStub(workflowId?: string, context: RequestContext = {}) { return { mode: 'stub' as const, workflowId, title: 'Workflow Designer', context: { userId: context.userId, organizationId: context.organizationId }, panels: ['canvas','catalog','executions','versions','workflow-ai'], workflowAIConfigured: preservedWorkflowAIConfigured }; }
export const graphql = { namespace: 'workflows', typeDefs: `type Workflow { id: ID!, name: String!, description: String, createdAt: String!, updatedAt: String! } type WorkflowExecution { id: ID!, workflowId: ID!, status: String!, createdAt: String!, updatedAt: String! } type WorkflowValidation { valid: Boolean!, errors: [String!]!, nodes: Int! } type Query { workflowList(limit: Int, offset: Int): [Workflow!]!, workflowGet(id: ID!): Workflow, workflowHealth: String!, workflowDebugEvents(workflowId: ID): String!, workflowQueueStatus(workflowId: ID): String! } type Mutation { workflowCreate(name: String!, description: String): Workflow!, workflowExecute(id: ID!): WorkflowExecution!, workflowDebugWithAI(id: ID!, message: String!): String!, workflowBuildWithAI(message: String!, workflowId: ID): String!, workflowImportNodePackage(workflowId: ID!, archive: String!): String! }`, resolvers: { Query: { workflowList: (_: unknown, args: PaginationOptions, ctx: RequestContext) => Workflows.getList(args, ctx).items, workflowGet: (_: unknown, args: { id: string }, ctx: RequestContext) => Workflows.getObject(args.id, ctx), workflowHealth: () => Workflows.health().status, workflowDebugEvents: (_: unknown,args:{workflowId?:string},ctx:RequestContext)=>JSON.stringify(Workflows.getDebugEvents(args.workflowId,ctx)), workflowQueueStatus: (_: unknown,args:{workflowId?:string})=>JSON.stringify((Workflows as unknown as { queueStatus: (workflowId?: string)=>unknown }).queueStatus(args.workflowId)) }, Mutation: { workflowCreate: (_: unknown, args: { name: string; description?: string }, ctx: RequestContext) => Workflows.create(args, ctx), workflowExecute: (_: unknown, args: { id: string }, ctx: RequestContext) => Workflows.execute(args.id, undefined, ctx), workflowDebugWithAI: async (_:unknown,args:{id:string; message:string},ctx:RequestContext)=>JSON.stringify(await Workflows.debugWithAI(args.id,{message:args.message},ctx)), workflowBuildWithAI: async (_:unknown,args:{message:string; workflowId?:string},ctx:RequestContext)=>JSON.stringify(await Workflows.buildWithAI(args,ctx)), workflowImportNodePackage: async (_:unknown,args:{workflowId:string; archive:string},ctx:RequestContext)=>JSON.stringify(await Workflows.importNodePackageToWorkflow(args.workflowId,args.archive,{},ctx)) } }, migrations: ['migrations/0001_init.sql'] };
export function createPackage(): PackageModule & { slashCommands: typeof workflowSlashCommands } { return { name: '@connectingmatrix/workflows', version: '0.3.0', health: () => Workflows.health(), graphql, migrations: graphql.migrations, launcher: createStubLauncher, runtime: { Workflows, workflowSlashCommands, observability: PackageObservability }, routes: [{ method: 'GET', path: '/workflows/health', handler: () => Workflows.health() }, { method: 'GET', path: '/workflows/launcher', handler: (request) => createStubLauncher((request as { context?: RequestContext }).context ?? {}) }, { method: 'GET', path: '/workflows', handler: (request) => Workflows.getList({}, (request as { context?: RequestContext }).context ?? {}) }, { method: 'POST', path: '/workflows/debug-with-ai', handler: (request) => Workflows.debugWithAI(String((request as { body?: { id?: string; message?: string } }).body?.id ?? ''), { message: String((request as { body?: { message?: string } }).body?.message ?? '') }, (request as { context?: RequestContext }).context ?? {}) }, { method: 'GET', path: '/workflows/queue-status', handler: (request) => (Workflows as unknown as { queueStatus: (workflowId?: string)=>unknown }).queueStatus(String((request as { body?: { workflowId?: string } }).body?.workflowId ?? '')) }, { method: 'POST', path: '/workflows/abort', handler: (request) => (Workflows as unknown as { abortExecution: (id: string, reason?: string)=>unknown }).abortExecution(String((request as { body?: { processId?: string; runId?: string } }).body?.processId ?? (request as { body?: { runId?: string } }).body?.runId ?? ''), String((request as { body?: { reason?: string } }).body?.reason ?? 'aborted by user')) }, { method: 'POST', path: '/workflows/node/import', handler: (request) => Workflows.importNodePackageToWorkflow(String((request as { body?: { workflowId?: string } }).body?.workflowId ?? ''), (request as { body?: { archive?: unknown } }).body?.archive ?? '', {}, (request as { context?: RequestContext }).context ?? {}) }], slashCommands: workflowSlashCommands }; }
export * from './contracts.js';
export * from './package-structure.js';
export * from './observability.js';
export * from './launcher.js';
