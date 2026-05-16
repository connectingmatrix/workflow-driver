import { nowIso } from '../contracts.js';
export function createPackageStatusPanel(context = {}) {
    return {
        packageName: '@connectingmatrix/workflow-driver',
        title: '@connectingmatrix/workflow-driver package status',
        mode: 'connected',
        status: 'ready',
        checkedAt: nowIso(),
        summary: 'Runtime package status panel. Debug/demo stubs live in examples/stub-launcher.ts and examples/playground.mjs.',
        healthPath: '/workflow-driver/health',
        graphqlNamespace: 'workflowdriver',
        routes: [{ method: 'GET', path: '/workflow-driver/health', description: 'Package health endpoint' }],
        owns: { ui: ['src/client'], backend: ['src/backend'], entity: ['src/entity'], migrations: ['migrations'] },
        actions: [{ name: 'open-examples', label: 'Run examples/playground.mjs', method: 'LOCAL', description: 'Launch the package example/debug harness.' }],
        sampleData: { context: 'package-status', userId: context.userId ?? 'example-user' },
        context: context,
        notes: ['Runtime code lives in src/. Example-only stubs and debug launchers live in examples/.']
    };
}
export const Launcher = { open: createPackageStatusPanel, mode: 'connected' };
export const launcher = createPackageStatusPanel;
