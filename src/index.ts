import { LocalEventBus, makeId, nowIso, type PackageHealth, type PackageModule, type PaginationOptions, type RequestContext } from './contracts.js';
import { InMemoryRepository, type BaseRecord } from './entity/repository.js';

export interface WorkflowRecord extends BaseRecord { name: string; description?: string; definition: Record<string, unknown>; publishedVersionId?: string; }
export interface WorkflowVersion extends BaseRecord { workflowId: string; definition: Record<string, unknown>; version: number; published: boolean; }
export interface WorkflowExecution extends BaseRecord { workflowId: string; status: 'queued' | 'running' | 'success' | 'error'; input?: unknown; output?: unknown; logs: string[]; }
export interface WorkflowValidation { valid: boolean; errors: string[]; nodes: number; }

const workflows = new InMemoryRepository<WorkflowRecord>('workflow');
const versionsRepo = new InMemoryRepository<WorkflowVersion>('workflow_version');
const execs = new InMemoryRepository<WorkflowExecution>('workflow_exec');
const bus = new LocalEventBus();

type ExecutorAdapter = (workflow: WorkflowRecord, input: unknown, context: RequestContext) => Promise<{ output?: unknown; logs?: string[] }>;
let executorAdapter: ExecutorAdapter | undefined;

function workflowSummary(workflow: WorkflowRecord): string {
  return `${workflow.id} :: ${workflow.name}${workflow.description ? ` — ${workflow.description}` : ''}`;
}

export const Workflows = {
  bindWithServer(_endpoint: string) { return Workflows; },
  setExecutorAdapter(adapter: ExecutorAdapter) { executorAdapter = adapter; return Workflows; },
  getList(pagination: PaginationOptions = {}, context: RequestContext = {}) { return workflows.list(context, pagination); },
  getObject(id: string, context: RequestContext = {}) { return workflows.get(id, context); },
  search(term: string, context: RequestContext = {}) { return workflows.search(term, context, ['name', 'description']); },
  create(input: { name: string; description?: string; definition?: Record<string, unknown> }, context: RequestContext = {}) {
    const wf = workflows.create({ name: input.name, description: input.description, definition: input.definition ?? { nodes: [], edges: [] } }, context);
    versionsRepo.create({ workflowId: wf.id, definition: wf.definition, version: 1, published: false }, context);
    void bus.emit('workflow:catalog', wf);
    return wf;
  },
  update(id: string, patch: Partial<WorkflowRecord>, context: RequestContext = {}) {
    const wf = workflows.update(id, patch, context);
    const count = versionsRepo.list(context, { limit: 500 }).items.filter((v) => v.workflowId === id).length;
    versionsRepo.create({ workflowId: id, definition: wf.definition, version: count + 1, published: false }, context);
    void bus.emit('workflow:catalog', wf);
    return wf;
  },
  delete(id: string, context: RequestContext = {}) { return workflows.delete(id, context); },
  validate(id: string, context: RequestContext = {}): WorkflowValidation {
    const wf = workflows.get(id, context);
    if (!wf) throw new Error('Workflow not found');
    const nodes = Array.isArray(wf.definition.nodes) ? wf.definition.nodes : [];
    const edges = Array.isArray(wf.definition.edges) ? wf.definition.edges : [];
    const errors: string[] = [];
    if (!Array.isArray(wf.definition.nodes)) errors.push('definition.nodes must be an array');
    if (!Array.isArray(wf.definition.edges)) errors.push('definition.edges must be an array');
    const nodeIds = new Set(nodes.map((node) => typeof node === 'object' && node ? String((node as { id?: unknown }).id ?? '') : '').filter(Boolean));
    for (const edge of edges) {
      if (!edge || typeof edge !== 'object') continue;
      const source = String((edge as { source?: unknown }).source ?? '');
      const target = String((edge as { target?: unknown }).target ?? '');
      if (source && !nodeIds.has(source)) errors.push(`edge source is missing node: ${source}`);
      if (target && !nodeIds.has(target)) errors.push(`edge target is missing node: ${target}`);
    }
    return { valid: errors.length === 0, errors, nodes: nodes.length };
  },
  async execute(id: string, input?: unknown, context: RequestContext = {}) {
    const wf = workflows.get(id, context);
    if (!wf) throw new Error('Workflow not found');
    const validation = Workflows.validate(id, context);
    if (!validation.valid) throw new Error(`Workflow validation failed: ${validation.errors.join('; ')}`);
    const execution = execs.create({ workflowId: id, status: 'running', input, logs: ['Execution started'] }, context);
    await bus.emit('workflow:execute', execution);
    try {
      const adapterResult = executorAdapter ? await executorAdapter(wf, input, context) : { output: { ok: true, workflowId: id, nodeCount: validation.nodes }, logs: ['No external executor adapter configured; static validated execution completed'] };
      const done = execs.update(execution.id, { status: 'success', output: adapterResult.output, logs: ['Execution started', ...(adapterResult.logs ?? []), 'Execution completed'] }, context);
      await bus.emit('workflow:execute', done);
      return done;
    } catch (error) {
      const failed = execs.update(execution.id, { status: 'error', logs: ['Execution started', error instanceof Error ? error.message : String(error)] }, context);
      await bus.emit('workflow:execute', failed);
      throw error;
    }
  },
  versions(workflowId: string, context: RequestContext = {}) { return versionsRepo.list(context, { limit: 500 }).items.filter((v) => v.workflowId === workflowId); },
  versionsDelete(workflowId: string, versionId: string, context: RequestContext = {}) { const version = versionsRepo.get(versionId, context); if (version?.workflowId !== workflowId) return false; return versionsRepo.delete(versionId, context); },
  versionsPublish(workflowId: string, versionId: string, context: RequestContext = {}) { const version = versionsRepo.get(versionId, context); if (!version || version.workflowId !== workflowId) throw new Error('Version not found'); versionsRepo.update(versionId, { published: true }, context); workflows.update(workflowId, { publishedVersionId: versionId, definition: version.definition }, context); return version; },
  executions: { list(workflowId?: string, context: RequestContext = {}) { const list = execs.list(context, { limit: 500 }).items; return workflowId ? list.filter((e) => e.workflowId === workflowId) : list; } },
  onWorkflowExecute(handler: (execution: WorkflowExecution) => void | Promise<void>) { return bus.on('workflow:execute', handler); },
  onWorkflowCatalog(handler: (workflow: WorkflowRecord) => void | Promise<void>) { return bus.on('workflow:catalog', handler); },
  openDesigner(id: string, context: RequestContext = {}) { const wf = workflows.get(id, context); if (!wf) throw new Error('Workflow not found'); return { workflow: wf, designer: '@workflow/ui', contract: 'preserved' }; },
  slash(args: string[], context: RequestContext = {}) {
    const [action = 'help', ...rest] = args;
    if (action === 'list') {
      const rows = Workflows.getList({ limit: 25 }, context).items;
      return rows.length ? rows.map(workflowSummary).join('\n') : 'No workflows found for this scope.';
    }
    if (action === 'search') {
      const rows = Workflows.search(rest.join(' '), context);
      return rows.length ? rows.map(workflowSummary).join('\n') : 'No workflows matched the search.';
    }
    if (action === 'validate') return Workflows.validate(rest[0] ?? '', context);
    if (action === 'execute') return Workflows.execute(rest[0] ?? '', {}, context);
    return 'Workflow commands: /workflow list, /workflow search <term>, /workflow validate <id>, /workflow execute <id>';
  },
  health(): PackageHealth { return { name: '@connectingmatrix/workflows', status: 'ok', checkedAt: nowIso(), details: { workflows: workflows.list({ root: true }).total, executions: execs.list({ root: true }).total, executorAdapter: Boolean(executorAdapter) } }; },
};

const WorkflowApi = Workflows as typeof Workflows & { versions: typeof Workflows.versions & { delete: typeof Workflows.versionsDelete; publish: typeof Workflows.versionsPublish } };
Object.assign(WorkflowApi.versions, { delete: Workflows.versionsDelete, publish: Workflows.versionsPublish });
export const Workflow = WorkflowApi;

export const workflowSlashCommands = [
  { command: '/workflow', owner: '@connectingmatrix/workflows', description: 'List/search/validate/execute workflows', handler: (args: string[], context: RequestContext) => Workflows.slash(args, context) },
];

export const graphql = {
  namespace: 'workflows',
  typeDefs: `type Workflow { id: ID!, name: String!, description: String, createdAt: String!, updatedAt: String! } type WorkflowExecution { id: ID!, workflowId: ID!, status: String!, createdAt: String!, updatedAt: String! } type WorkflowValidation { valid: Boolean!, errors: [String!]!, nodes: Int! } type Query { workflowList(limit: Int, offset: Int): [Workflow!]!, workflowGet(id: ID!): Workflow, workflowHealth: String! } type Mutation { workflowCreate(name: String!, description: String): Workflow!, workflowExecute(id: ID!): WorkflowExecution! }`,
  resolvers: { Query: { workflowList: (_: unknown, args: PaginationOptions, ctx: RequestContext) => Workflows.getList(args, ctx).items, workflowGet: (_: unknown, args: { id: string }, ctx: RequestContext) => Workflows.getObject(args.id, ctx), workflowHealth: () => Workflows.health().status }, Mutation: { workflowCreate: (_: unknown, args: { name: string; description?: string }, ctx: RequestContext) => Workflows.create(args, ctx), workflowExecute: (_: unknown, args: { id: string }, ctx: RequestContext) => Workflows.execute(args.id, undefined, ctx) } },
  migrations: ['migrations/0001_init.sql'],
};
export function createPackage(): PackageModule & { slashCommands: typeof workflowSlashCommands } { return { name: '@connectingmatrix/workflows', version: '0.1.0', health: () => Workflows.health(), graphql, migrations: graphql.migrations, routes: [{ method: 'GET', path: '/workflows/health', handler: () => Workflows.health() }, { method: 'GET', path: '/workflows', handler: (request) => Workflows.getList({}, (request as { context?: RequestContext }).context ?? {}) }], slashCommands: workflowSlashCommands }; }
export * from './contracts.js';
