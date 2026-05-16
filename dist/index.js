import { createPackageStatusPanel } from './services/package-status.service.js';
import { PackageObservability } from './observability.js';
import { LocalEventBus, makeId, nowIso } from './contracts.js';
import { InMemoryRepository } from './entity/repository.js';
const workflows = new InMemoryRepository('workflow');
const versionsRepo = new InMemoryRepository('workflow_version');
const execs = new InMemoryRepository('workflow_exec');
const debugEvents = new InMemoryRepository('workflow_debug');
const aiSessions = new InMemoryRepository('workflow_ai_session');
const bus = new LocalEventBus();
let executorAdapter;
let workflowAgentAdapter;
let nodesAdapter;
let gigaAgents;
let processMonitoring;
let preservedWorkflowAIConfigured = false;
function processIdOf(row, fallback) { return row?.id ?? row?.processId ?? fallback; }
function workflowSummary(workflow) { return `${workflow.id} :: ${workflow.name}${workflow.description ? ` — ${workflow.description}` : ''}`; }
function nodeArray(definition) { return Array.isArray(definition.nodes) ? definition.nodes : []; }
function edgeArray(definition) { return Array.isArray(definition.edges) ? definition.edges : []; }
function defaultWorkflowAgent(input) { const name = input.workflow?.name ?? 'New workflow'; const actions = [`workflow-ai-${input.mode}`]; return { message: `Workflow AI ${input.mode} for ${name}: ${input.message}`, definitionPatch: input.mode === 'build' && !input.workflow ? { nodes: [], edges: [] } : undefined, executeInput: input.mode === 'execute' || input.mode === 'run' ? { source: 'workflow-ai' } : undefined, actions }; }
function recordDebug(workflowId, sessionId, role, content, context, metadata) { return debugEvents.create({ workflowId, sessionId, role, content, metadata }, context); }
function nameFromPrompt(prompt, fallback) { return (prompt.match(/name:\s*([^,\n]+)/i)?.[1] ?? fallback).trim(); }
export const Workflows = {
    bindWithServer(_endpoint) { return Workflows; },
    bindLogger(logger) { PackageObservability.bind({ logger: logger }); return Workflows; },
    bindSockets(sockets) { PackageObservability.bind({ sockets: sockets }); return Workflows; },
    bindProcessMonitor(monitor) { processMonitoring = monitor; return Workflows; },
    bindProcessMonitoring(monitor) { processMonitoring = monitor; return Workflows; },
    setExecutorAdapter(adapter) { executorAdapter = adapter; return Workflows; },
    bindNodes(adapter) { nodesAdapter = adapter; return Workflows; },
    bindWorkflowAgent(adapter) { workflowAgentAdapter = adapter; preservedWorkflowAIConfigured = true; return Workflows; },
    useWorkflowAIAgent(adapter) { if (typeof adapter === 'function')
        return Workflows.bindWorkflowAgent(adapter); return Workflows.bindGigaAgents(adapter); },
    bindGigaAgents(adapter) { gigaAgents = adapter; preservedWorkflowAIConfigured = true; if (adapter.workflowAIAgent) {
        const agent = adapter.workflowAIAgent();
        workflowAgentAdapter = async (input, context) => { const result = await agent.run({ message: input.message, workflow: input.workflow, execute: (runInput) => Workflows.execute(input.workflow.id, runInput, context), browserContext: { sessionId: input.sessionId, mode: input.mode } }, context); return { message: result.output ?? JSON.stringify(result), actions: result.actions ?? ['giga-workflow-agent'], executeInput: result.execution ? undefined : input.mode === 'execute' ? { source: 'workflow-ai' } : undefined }; };
    }
    else if (adapter.runWorkflowAgent) {
        workflowAgentAdapter = async (input, context) => { const result = await adapter.runWorkflowAgent({ prompt: input.message, workflowId: input.workflow?.id, debug: true, execute: /\b(run|execute)\b/i.test(input.message) || input.mode === 'execute' }, context); return { message: JSON.stringify(result.artifact ?? result), actions: ['giga-workflow-agent'], executeInput: input.mode === 'execute' ? { source: 'workflow-ai' } : undefined }; };
    } return Workflows; },
    configurePreservedWorkflowAI(adapter) { if (adapter) {
        if (typeof adapter === 'function')
            workflowAgentAdapter = adapter;
        else
            workflowAgentAdapter = async (input, context) => { const result = await adapter.run({ message: input.message, workflow: input.workflow, execute: (runInput) => Workflows.execute(input.workflow.id, runInput, context), browserContext: { sessionId: input.sessionId, mode: input.mode } }, context); return { message: result.output ?? JSON.stringify(result), actions: result.actions ?? ['giga-workflow-agent'], executeInput: result.execution ? undefined : input.mode === 'execute' ? { source: 'workflow-ai' } : undefined }; };
    } preservedWorkflowAIConfigured = true; return Workflows; },
    getList(pagination = {}, context = {}) { return workflows.list(context, pagination); },
    getObject(id, context = {}) { return workflows.get(id, context); },
    search(term, context = {}) { return workflows.search(term, context, ['name', 'description']); },
    create(input, context = {}) { const wf = workflows.create({ name: input.name, description: input.description, definition: input.definition ?? { nodes: [], edges: [] } }, context); versionsRepo.create({ workflowId: wf.id, definition: wf.definition, version: 1, published: false }, context); void bus.emit('workflow:catalog', wf); return wf; },
    update(id, patch, context = {}) { const wf = workflows.update(id, patch, context); const count = versionsRepo.list(context, { limit: 500 }).items.filter((v) => v.workflowId === id).length; versionsRepo.create({ workflowId: id, definition: wf.definition, version: count + 1, published: false }, context); void bus.emit('workflow:catalog', wf); return wf; },
    delete(id, context = {}) { return workflows.delete(id, context); },
    validate(id, context = {}) { const wf = workflows.get(id, context); if (!wf)
        throw new Error('Workflow not found'); const nodes = nodeArray(wf.definition); const edges = edgeArray(wf.definition); const errors = []; if (!Array.isArray(wf.definition.nodes))
        errors.push('definition.nodes must be an array'); if (!Array.isArray(wf.definition.edges))
        errors.push('definition.edges must be an array'); const nodeIds = new Set(nodes.map((node) => typeof node === 'object' && node ? String(node.id ?? '') : '').filter(Boolean)); for (const edge of edges) {
        if (!edge || typeof edge !== 'object')
            continue;
        const source = String(edge.source ?? '');
        const target = String(edge.target ?? '');
        if (source && !nodeIds.has(source))
            errors.push(`edge source is missing node: ${source}`);
        if (target && !nodeIds.has(target))
            errors.push(`edge target is missing node: ${target}`);
    } return { valid: errors.length === 0, errors, nodes: nodes.length }; },
    async execute(id, input, context = {}) { const wf = workflows.get(id, context); if (!wf)
        throw new Error('Workflow not found'); const validation = Workflows.validate(id, context); if (!validation.valid)
        throw new Error(`Workflow validation failed: ${validation.errors.join('; ')}`); const fallbackPid = `workflow-exec:${makeId('workflow_exec')}`; const proc = processMonitoring?.start?.({ kind: 'Workflows', packageName: '@connectingmatrix/workflow-driver', title: `Workflow ${wf.name}`, targetId: fallbackPid, context, metadata: { workflowId: id } }); const processId = processIdOf(proc, fallbackPid); const execution = execs.create({ workflowId: id, status: 'running', input, logs: ['Execution started'], processId }, context); PackageObservability.track(processId, { label: `Workflow ${wf.name}`, status: 'running', progress: 25, context: { processKind: 'Workflows', workflowId: id, executionId: execution.id } }, context); processMonitoring?.appendLog?.(processId, 'info', 'Workflow execution started', { workflowId: id, executionId: execution.id }); await bus.emit('workflow:execute', execution); try {
        const adapterResult = executorAdapter ? await executorAdapter(wf, input, context) : { output: { ok: true, workflowId: id, nodeCount: validation.nodes }, logs: ['No external executor adapter configured; static validated execution completed'] };
        const done = execs.update(execution.id, { status: 'success', output: adapterResult.output, logs: ['Execution started', ...(adapterResult.logs ?? []), 'Execution completed'] }, context);
        processMonitoring?.complete?.(processId, { workflowId: id, executionId: execution.id });
        PackageObservability.track(processId, { label: `Workflow ${wf.name}`, status: 'completed', progress: 100, context: { processKind: 'Workflows', workflowId: id, executionId: execution.id } }, context);
        await bus.emit('workflow:execute', done);
        return done;
    }
    catch (error) {
        const failed = execs.update(execution.id, { status: 'error', logs: ['Execution started', error instanceof Error ? error.message : String(error)] }, context);
        processMonitoring?.fail?.(processId, error, { workflowId: id, executionId: execution.id });
        PackageObservability.track(processId, { label: `Workflow ${wf.name}`, status: 'failed', progress: 100, context: { processKind: 'Workflows', workflowId: id, executionId: execution.id } }, context);
        await bus.emit('workflow:execute', failed);
        throw error;
    } },
    abortExecution(executionId, context = {}) { const execution = execs.get(executionId, context); if (!execution)
        throw new Error(`Workflow execution not found: ${executionId}`); const row = execs.update(executionId, { status: 'aborted', logs: [...execution.logs, 'Execution aborted'] }, context); processMonitoring?.abort?.(execution.processId, 'workflow execution aborted'); PackageObservability.track(execution.processId, { label: `Workflow execution ${executionId}`, status: 'aborted', progress: 100, context: { processKind: 'Workflows', executionId } }, context); return row; },
    versions(workflowId, context = {}) { return versionsRepo.list(context, { limit: 500 }).items.filter((v) => v.workflowId === workflowId); },
    versionsDelete(workflowId, versionId, context = {}) { const version = versionsRepo.get(versionId, context); if (version?.workflowId !== workflowId)
        return false; return versionsRepo.delete(versionId, context); },
    versionsPublish(workflowId, versionId, context = {}) { const version = versionsRepo.get(versionId, context); if (!version || version.workflowId !== workflowId)
        throw new Error('Version not found'); versionsRepo.update(versionId, { published: true }, context); workflows.update(workflowId, { publishedVersionId: versionId, definition: version.definition }, context); return version; },
    executions: { list(workflowId, context = {}) { const list = execs.list(context, { limit: 500 }).items; return workflowId ? list.filter((e) => e.workflowId === workflowId) : list; } },
    onWorkflowExecute(handler) { return bus.on('workflow:execute', handler); },
    onWorkflowCatalog(handler) { return bus.on('workflow:catalog', handler); },
    openDesigner(id, context = {}) { const wf = workflows.get(id, context); if (!wf)
        throw new Error('Workflow not found'); return { workflow: wf, designer: '@workflow/ui', contract: 'preserved', workflowAIConfigured: preservedWorkflowAIConfigured, panels: ['canvas', 'catalog', 'executions', 'versions', 'workflow-ai'] }; },
    startAISession(workflowId, browserContext = {}, context = {}) { if (workflowId)
        workflows.get(workflowId, context); const session = aiSessions.create({ workflowId, browserContext, messages: 0 }, context); if (workflowId)
        recordDebug(workflowId, session.id, 'system', 'Workflow AI session started', context); return session; },
    async buildWithAI(input, context = {}) { const sessionId = input.sessionId ?? Workflows.startAISession(input.workflowId, {}, context).id; const workflow = input.workflowId ? workflows.get(input.workflowId, context) : undefined; const assistant = workflowAgentAdapter ? await workflowAgentAdapter({ workflow, message: input.message, sessionId, mode: 'build', preservedWorkflowContract: 'workflow-ai' }, context) : defaultWorkflowAgent({ workflow, message: input.message, mode: 'build' }); const wf = workflow ? Workflows.update(workflow.id, { definition: { ...workflow.definition, ...(assistant.definitionPatch ?? {}) } }, context) : Workflows.create({ name: input.name ?? nameFromPrompt(input.message, 'AI Workflow'), description: input.message, definition: assistant.definitionPatch ?? { nodes: [], edges: [] } }, context); recordDebug(wf.id, sessionId, 'assistant', assistant.message, context, { actions: assistant.actions }); return { workflow: wf, sessionId, message: assistant.message, actions: assistant.actions ?? ['workflow-ai-build'] }; },
    async debugWithAI(arg1, arg2, arg3 = {}) { const session = aiSessions.get(arg1, arg3); const workflowId = session?.workflowId ?? arg1; const context = session ? arg3 : arg3; const input = typeof arg2 === 'string' ? { message: arg2, sessionId: session?.id, execute: /\b(run|execute)\b/i.test(arg2) } : arg2; const wf = workflows.get(workflowId, context); if (!wf)
        throw new Error('Workflow not found'); const sessionId = input.sessionId ?? session?.id ?? Workflows.startAISession(workflowId, {}, context).id; recordDebug(workflowId, sessionId, 'user', input.message, context); const mode = input.execute ? 'execute' : (/\b(run|execute)\b/i.test(input.message) ? 'execute' : 'debug'); const assistant = workflowAgentAdapter ? await workflowAgentAdapter({ workflow: wf, message: input.message, sessionId, mode, preservedWorkflowContract: 'workflow-ai' }, context) : defaultWorkflowAgent({ workflow: wf, message: input.message, mode }); if (assistant.definitionPatch)
        Workflows.update(workflowId, { definition: { ...wf.definition, ...assistant.definitionPatch } }, context); const execution = input.execute || assistant.executeInput !== undefined || /\b(run|execute)\b/i.test(input.message) ? await Workflows.execute(workflowId, assistant.executeInput, context) : undefined; recordDebug(workflowId, sessionId, 'assistant', assistant.message, context, { actions: assistant.actions }); if (session)
        aiSessions.update(session.id, { messages: session.messages + 2 }, context); return { sessionId, message: assistant.message, actions: assistant.actions ?? ['workflow-ai-debug'], workflow: Workflows.getObject(workflowId, context), execution }; },
    async runWithAI(workflowId, message, context = {}) { return Workflows.debugWithAI(workflowId, { message, execute: true }, context); },
    async importNodePackage(archive, context = {}) { if (!nodesAdapter?.importNodePackage)
        throw new Error('@connectingmatrix/nodes must be bound through Workflows.bindNodes(...) to import .node packages'); const node = await nodesAdapter.importNodePackage(archive, context); return { importedNode: node, workflowCatalogRefresh: true }; },
    async importNodePackageToWorkflow(workflowId, archive, position = {}, context = {}) { const wf = workflows.get(workflowId, context); if (!wf)
        throw new Error('Workflow not found'); if (!nodesAdapter?.importNodePackage)
        throw new Error('@connectingmatrix/nodes must be bound through Workflows.bindNodes(...) to import .node packages'); const node = await nodesAdapter.importNodePackage(archive, context); const currentNodes = nodeArray(wf.definition); const nextNode = { id: node.id ?? makeId('node'), type: 'user-node', label: node.name ?? 'Imported Node', nodePackageImported: true, ...position }; const updated = Workflows.update(workflowId, { definition: { ...wf.definition, nodes: [...currentNodes, nextNode], edges: edgeArray(wf.definition) } }, context); return { node, workflow: updated }; },
    getDebugEvents(workflowId, context = {}) { const rows = debugEvents.list(context, { limit: 500 }).items; return workflowId ? rows.filter((row) => row.workflowId === workflowId) : rows; },
    slash(args, context = {}) { const [action = 'help', ...rest] = args; if (action === 'list') {
        const rows = Workflows.getList({ limit: 25 }, context).items;
        return rows.length ? rows.map(workflowSummary).join('\n') : 'No workflows found for this scope.';
    } if (action === 'search') {
        const rows = Workflows.search(rest.join(' '), context);
        return rows.length ? rows.map(workflowSummary).join('\n') : 'No workflows matched the search.';
    } if (action === 'validate')
        return Workflows.validate(rest[0] ?? '', context); if (action === 'execute')
        return Workflows.execute(rest[0] ?? '', {}, context); if (action === 'debug')
        return Workflows.debugWithAI(rest[0] ?? '', { message: rest.slice(1).join(' ') || 'Debug workflow' }, context); return 'Workflow commands: /workflow list, /workflow search <term>, /workflow validate <id>, /workflow execute <id>, /workflow debug <id> <message>'; },
    health() { return { name: '@connectingmatrix/workflow-driver', status: 'ok', checkedAt: nowIso(), details: { workflows: workflows.list({ root: true }).total, executions: execs.list({ root: true }).total, debugEvents: debugEvents.list({ root: true }).total, executorAdapter: Boolean(executorAdapter), workflowAgentBound: Boolean(workflowAgentAdapter), preservedWorkflowAIConfigured, nodesAdapterBound: Boolean(nodesAdapter), processMonitoring: Boolean(processMonitoring), ...PackageObservability.healthDetails() } }; },
};
const WorkflowApi = Workflows;
Object.assign(WorkflowApi.versions, { delete: Workflows.versionsDelete, publish: Workflows.versionsPublish });
export const Workflow = WorkflowApi;
export const workflowSlashCommands = [{ command: '/workflow', owner: '@connectingmatrix/workflow-driver', description: 'List/search/validate/execute/debug workflows', handler: (args, context) => Workflows.slash(args, context) }];
export function openDesignerStub(workflowId, context = {}) { return { mode: 'stub', workflowId, title: 'Workflow Designer', context: { userId: context.userId, organizationId: context.organizationId }, panels: ['canvas', 'catalog', 'executions', 'versions', 'workflow-ai'], workflowAIConfigured: preservedWorkflowAIConfigured }; }
export const graphql = { namespace: 'workflows', typeDefs: `type Workflow { id: ID!, name: String!, description: String, createdAt: String!, updatedAt: String! } type WorkflowExecution { id: ID!, workflowId: ID!, status: String!, createdAt: String!, updatedAt: String! } type WorkflowValidation { valid: Boolean!, errors: [String!]!, nodes: Int! } type Query { workflowList(limit: Int, offset: Int): [Workflow!]!, workflowGet(id: ID!): Workflow, workflowHealth: String!, workflowDebugEvents(workflowId: ID): String! } type Mutation { workflowCreate(name: String!, description: String): Workflow!, workflowExecute(id: ID!): WorkflowExecution!, workflowDebugWithAI(id: ID!, message: String!): String!, workflowBuildWithAI(message: String!, workflowId: ID): String!, workflowImportNodePackage(workflowId: ID!, archive: String!): String! }`, resolvers: { Query: { workflowList: (_, args, ctx) => Workflows.getList(args, ctx).items, workflowGet: (_, args, ctx) => Workflows.getObject(args.id, ctx), workflowHealth: () => Workflows.health().status, workflowDebugEvents: (_, args, ctx) => JSON.stringify(Workflows.getDebugEvents(args.workflowId, ctx)) }, Mutation: { workflowCreate: (_, args, ctx) => Workflows.create(args, ctx), workflowExecute: (_, args, ctx) => Workflows.execute(args.id, undefined, ctx), workflowDebugWithAI: async (_, args, ctx) => JSON.stringify(await Workflows.debugWithAI(args.id, { message: args.message }, ctx)), workflowBuildWithAI: async (_, args, ctx) => JSON.stringify(await Workflows.buildWithAI(args, ctx)), workflowImportNodePackage: async (_, args, ctx) => JSON.stringify(await Workflows.importNodePackageToWorkflow(args.workflowId, args.archive, {}, ctx)) } }, migrations: ['migrations/0001_init.sql'] };
export function createPackage() { return { name: '@connectingmatrix/workflow-driver', version: '0.3.0', health: () => Workflows.health(), graphql, migrations: graphql.migrations, launcher: createPackageStatusPanel, runtime: { Workflows, workflowSlashCommands, observability: PackageObservability }, routes: [{ method: 'GET', path: '/workflows/health', handler: () => Workflows.health() }, { method: 'GET', path: '/workflows/launcher', handler: (request) => createPackageStatusPanel(request.context ?? {}) }, { method: 'GET', path: '/workflows', handler: (request) => Workflows.getList({}, request.context ?? {}) }, { method: 'POST', path: '/workflows/debug-with-ai', handler: (request) => Workflows.debugWithAI(String(request.body?.id ?? ''), { message: String(request.body?.message ?? '') }, request.context ?? {}) }, { method: 'POST', path: '/workflows/node/import', handler: (request) => Workflows.importNodePackageToWorkflow(String(request.body?.workflowId ?? ''), request.body?.archive ?? '', {}, request.context ?? {}) }], slashCommands: workflowSlashCommands }; }
export * from './contracts.js';
export * from './package-structure.js';
export * from './observability.js';
export * from './services/package-status.service.js';
