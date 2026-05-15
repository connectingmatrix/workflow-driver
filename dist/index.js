import { LocalEventBus, nowIso } from './contracts.js';
import { InMemoryRepository } from './entity/repository.js';
const workflows = new InMemoryRepository('workflow');
const versionsRepo = new InMemoryRepository('workflow_version');
const execs = new InMemoryRepository('workflow_exec');
const bus = new LocalEventBus();
let executorAdapter;
function workflowSummary(workflow) {
    return `${workflow.id} :: ${workflow.name}${workflow.description ? ` — ${workflow.description}` : ''}`;
}
export const Workflows = {
    bindWithServer(_endpoint) { return Workflows; },
    setExecutorAdapter(adapter) { executorAdapter = adapter; return Workflows; },
    getList(pagination = {}, context = {}) { return workflows.list(context, pagination); },
    getObject(id, context = {}) { return workflows.get(id, context); },
    search(term, context = {}) { return workflows.search(term, context, ['name', 'description']); },
    create(input, context = {}) {
        const wf = workflows.create({ name: input.name, description: input.description, definition: input.definition ?? { nodes: [], edges: [] } }, context);
        versionsRepo.create({ workflowId: wf.id, definition: wf.definition, version: 1, published: false }, context);
        void bus.emit('workflow:catalog', wf);
        return wf;
    },
    update(id, patch, context = {}) {
        const wf = workflows.update(id, patch, context);
        const count = versionsRepo.list(context, { limit: 500 }).items.filter((v) => v.workflowId === id).length;
        versionsRepo.create({ workflowId: id, definition: wf.definition, version: count + 1, published: false }, context);
        void bus.emit('workflow:catalog', wf);
        return wf;
    },
    delete(id, context = {}) { return workflows.delete(id, context); },
    validate(id, context = {}) {
        const wf = workflows.get(id, context);
        if (!wf)
            throw new Error('Workflow not found');
        const nodes = Array.isArray(wf.definition.nodes) ? wf.definition.nodes : [];
        const edges = Array.isArray(wf.definition.edges) ? wf.definition.edges : [];
        const errors = [];
        if (!Array.isArray(wf.definition.nodes))
            errors.push('definition.nodes must be an array');
        if (!Array.isArray(wf.definition.edges))
            errors.push('definition.edges must be an array');
        const nodeIds = new Set(nodes.map((node) => typeof node === 'object' && node ? String(node.id ?? '') : '').filter(Boolean));
        for (const edge of edges) {
            if (!edge || typeof edge !== 'object')
                continue;
            const source = String(edge.source ?? '');
            const target = String(edge.target ?? '');
            if (source && !nodeIds.has(source))
                errors.push(`edge source is missing node: ${source}`);
            if (target && !nodeIds.has(target))
                errors.push(`edge target is missing node: ${target}`);
        }
        return { valid: errors.length === 0, errors, nodes: nodes.length };
    },
    async execute(id, input, context = {}) {
        const wf = workflows.get(id, context);
        if (!wf)
            throw new Error('Workflow not found');
        const validation = Workflows.validate(id, context);
        if (!validation.valid)
            throw new Error(`Workflow validation failed: ${validation.errors.join('; ')}`);
        const execution = execs.create({ workflowId: id, status: 'running', input, logs: ['Execution started'] }, context);
        await bus.emit('workflow:execute', execution);
        try {
            const adapterResult = executorAdapter ? await executorAdapter(wf, input, context) : { output: { ok: true, workflowId: id, nodeCount: validation.nodes }, logs: ['No external executor adapter configured; static validated execution completed'] };
            const done = execs.update(execution.id, { status: 'success', output: adapterResult.output, logs: ['Execution started', ...(adapterResult.logs ?? []), 'Execution completed'] }, context);
            await bus.emit('workflow:execute', done);
            return done;
        }
        catch (error) {
            const failed = execs.update(execution.id, { status: 'error', logs: ['Execution started', error instanceof Error ? error.message : String(error)] }, context);
            await bus.emit('workflow:execute', failed);
            throw error;
        }
    },
    versions(workflowId, context = {}) { return versionsRepo.list(context, { limit: 500 }).items.filter((v) => v.workflowId === workflowId); },
    versionsDelete(workflowId, versionId, context = {}) { const version = versionsRepo.get(versionId, context); if (version?.workflowId !== workflowId)
        return false; return versionsRepo.delete(versionId, context); },
    versionsPublish(workflowId, versionId, context = {}) { const version = versionsRepo.get(versionId, context); if (!version || version.workflowId !== workflowId)
        throw new Error('Version not found'); versionsRepo.update(versionId, { published: true }, context); workflows.update(workflowId, { publishedVersionId: versionId, definition: version.definition }, context); return version; },
    executions: { list(workflowId, context = {}) { const list = execs.list(context, { limit: 500 }).items; return workflowId ? list.filter((e) => e.workflowId === workflowId) : list; } },
    onWorkflowExecute(handler) { return bus.on('workflow:execute', handler); },
    onWorkflowCatalog(handler) { return bus.on('workflow:catalog', handler); },
    openDesigner(id, context = {}) { const wf = workflows.get(id, context); if (!wf)
        throw new Error('Workflow not found'); return { workflow: wf, designer: '@workflow/ui', contract: 'preserved' }; },
    slash(args, context = {}) {
        const [action = 'help', ...rest] = args;
        if (action === 'list') {
            const rows = Workflows.getList({ limit: 25 }, context).items;
            return rows.length ? rows.map(workflowSummary).join('\n') : 'No workflows found for this scope.';
        }
        if (action === 'search') {
            const rows = Workflows.search(rest.join(' '), context);
            return rows.length ? rows.map(workflowSummary).join('\n') : 'No workflows matched the search.';
        }
        if (action === 'validate')
            return Workflows.validate(rest[0] ?? '', context);
        if (action === 'execute')
            return Workflows.execute(rest[0] ?? '', {}, context);
        return 'Workflow commands: /workflow list, /workflow search <term>, /workflow validate <id>, /workflow execute <id>';
    },
    health() { return { name: '@connectingmatrix/workflows', status: 'ok', checkedAt: nowIso(), details: { workflows: workflows.list({ root: true }).total, executions: execs.list({ root: true }).total, executorAdapter: Boolean(executorAdapter) } }; },
};
const WorkflowApi = Workflows;
Object.assign(WorkflowApi.versions, { delete: Workflows.versionsDelete, publish: Workflows.versionsPublish });
export const Workflow = WorkflowApi;
export const workflowSlashCommands = [
    { command: '/workflow', owner: '@connectingmatrix/workflows', description: 'List/search/validate/execute workflows', handler: (args, context) => Workflows.slash(args, context) },
];
export const graphql = {
    namespace: 'workflows',
    typeDefs: `type Workflow { id: ID!, name: String!, description: String, createdAt: String!, updatedAt: String! } type WorkflowExecution { id: ID!, workflowId: ID!, status: String!, createdAt: String!, updatedAt: String! } type WorkflowValidation { valid: Boolean!, errors: [String!]!, nodes: Int! } type Query { workflowList(limit: Int, offset: Int): [Workflow!]!, workflowGet(id: ID!): Workflow, workflowHealth: String! } type Mutation { workflowCreate(name: String!, description: String): Workflow!, workflowExecute(id: ID!): WorkflowExecution! }`,
    resolvers: { Query: { workflowList: (_, args, ctx) => Workflows.getList(args, ctx).items, workflowGet: (_, args, ctx) => Workflows.getObject(args.id, ctx), workflowHealth: () => Workflows.health().status }, Mutation: { workflowCreate: (_, args, ctx) => Workflows.create(args, ctx), workflowExecute: (_, args, ctx) => Workflows.execute(args.id, undefined, ctx) } },
    migrations: ['migrations/0001_init.sql'],
};
export function createPackage() { return { name: '@connectingmatrix/workflows', version: '0.1.0', health: () => Workflows.health(), graphql, migrations: graphql.migrations, routes: [{ method: 'GET', path: '/workflows/health', handler: () => Workflows.health() }, { method: 'GET', path: '/workflows', handler: (request) => Workflows.getList({}, request.context ?? {}) }], slashCommands: workflowSlashCommands }; }
export * from './contracts.js';
