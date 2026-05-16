import { nowIso } from './contracts.js';
export function createConnectingmatrixWorkflowsStubLauncher(context = {}) {
    return {
        packageName: '@connectingmatrix/workflows',
        title: 'Workflow Designer Launcher',
        mode: 'stub',
        status: 'ready',
        checkedAt: nowIso(),
        summary: 'Launches workflow CRUD, designer stub, execution, validation, catalog/execute sockets and version management.',
        healthPath: '/workflows/health',
        graphqlNamespace: 'workflows',
        routes: [
            { method: 'GET', path: '/workflows/health', description: 'Health/status endpoint' },
            { method: 'GET', path: '/workflows/launcher', description: 'Stub launcher panel' }
        ],
        owns: {
            ui: ['dataloaders', 'bindWithServer', 'status/launcher UI'],
            backend: ["workflow designer stub", "execution adapter", "catalog events"],
            entity: ["Workflow", "WorkflowVersion", "WorkflowExecution"],
            migrations: ['migrations/*.sql']
        },
        actions: [
            { name: 'openDesignerStub', label: 'openDesignerStub', method: 'LOCAL', description: 'Run openDesignerStub demo action' },
            { name: 'execute', label: 'execute', method: 'LOCAL', description: 'Run execute demo action' },
            { name: 'validate', label: 'validate', method: 'LOCAL', description: 'Run validate demo action' },
            { name: 'publishVersion', label: 'publishVersion', method: 'LOCAL', description: 'Run publishVersion demo action' }
        ],
        sampleData: { context: 'stub-playground', userId: context.userId ?? 'stub-user' },
        context: { userId: context.userId, organizationId: context.organizationId, root: Boolean(context.root), traceId: context.traceId },
        notes: [
            'This launcher is intentionally stub-mode playable so the package can be tested outside giga-ai-backend.',
            'The launcher exposes this package boundary only; cross-package behavior is injected through adapters.'
        ]
    };
}
export const createStubLauncher = createConnectingmatrixWorkflowsStubLauncher;
export const Launcher = { open: createConnectingmatrixWorkflowsStubLauncher, mode: 'stub' };
export const launcher = createConnectingmatrixWorkflowsStubLauncher;
