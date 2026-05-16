import { createRequestId } from '@/graphql/client';
import { GRAPHQL_API_URL, API_ORIGIN } from '@/graphql/env';
import type { UiDataContext } from '@/dataloaders';
import { createUserNode, deleteUserNode, executeWorkflow, listUserNodes, listWorkflows, updateUserNode } from '@/dataloaders';
import type { EntityRecord, JsonObject, UserNodeRecord, WorkflowUserNodeInput } from '@/orm';
import { createGigaNodeCatalog } from '@workflow/nodes';
import type { WorkflowDefinition, WorkflowNodeSchema, WorkflowSourceFiles } from '@workflow/ui/workflow/types';
import type { WorkflowNodeCatalog, WorkflowRealtimeClient, WorkflowUiDriver } from '@workflow/ui/workflow/driver';

const unsupported = (operation: string): never => {
    throw new Error(`${operation} is not exposed through the UI dataloader contract yet.`);
};

export const emptyWorkflow = (id = 'draft'): WorkflowDefinition => ({
    metadata: { id, name: 'Untitled workflow', description: null },
    nodes: [],
    connections: []
});

export const workflowFromRecord = (record: EntityRecord): WorkflowDefinition => {
    const payload = record.data.payload || record.data.workflow;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`Workflow ${record.id} does not include a workflow payload.`);
    return payload as unknown as WorkflowDefinition;
};

export const emptyNodeCatalog = (): WorkflowNodeCatalog => createGigaNodeCatalog();

const workflowUserNode = (context: UiDataContext, row: UserNodeRecord) => ({
    id: row.id,
    userId: row.userId || context.policy.scope.id,
    name: row.name,
    slug: row.slug,
    description: row.description || null,
    groupName: row.groupName || null,
    nodeSchema: row.nodeSchema as WorkflowNodeSchema,
    sourceFiles: row.sourceFiles as WorkflowSourceFiles,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    modelId: row.modelId
});

const workflowUserNodeInput = (input: {
    name: string;
    slug?: string | null;
    description?: string | null;
    groupName?: string | null;
    nodeSchema: WorkflowNodeSchema;
    sourceFiles: WorkflowSourceFiles;
    isActive?: boolean | null;
}): WorkflowUserNodeInput => ({
    name: input.name,
    slug: input.slug || input.name,
    description: input.description || null,
    groupName: input.groupName || null,
    nodeSchema: input.nodeSchema as JsonObject,
    sourceFiles: input.sourceFiles as JsonObject,
    isActive: input.isActive !== false
});

const realtimeClient = (): WorkflowRealtimeClient => ({
    connect: async () => undefined,
    disconnect: () => undefined,
    joinRun: async () => undefined,
    subscribeWorkflowExecution: async () => undefined,
    unsubscribeWorkflowExecution: () => undefined,
    addEventHandler: () => () => undefined,
    addWebhookTestInvokeHandler: () => () => undefined,
    emitWebhookTestResult: () => undefined,
    emitWebhookTestError: () => undefined,
    openEditorSession: async () => undefined,
    heartbeatEditorSession: async () => undefined,
    closeEditorSession: () => undefined,
    executeStep: async () => unsupported('workflow.executeStep'),
    startPreview: async () => unsupported('workflow.startPreview'),
    cancelPreview: () => undefined,
    addPreviewLogHandler: () => () => undefined,
    addPreviewStateHandler: () => () => undefined,
    addPreviewResultHandler: () => () => undefined,
    addPreviewStopHandler: () => () => undefined,
    addPreviewErrorHandler: () => () => undefined
});

export const workflowUiDriver = (context: UiDataContext): WorkflowUiDriver => ({
    createRequestId,
    getDefaultRuntimeSettings: () => ({ graphqlUrl: GRAPHQL_API_URL, httpBaseUrl: API_ORIGIN, authMode: 'auto', manualHeaders: {}, maxExecutionSeconds: 300 }),
    createRealtimeClient: realtimeClient,
    buildWorkflowWebhookUrls: (workflowId) => ({ testUrl: `${API_ORIGIN}/api/workflows/${workflowId}/test`, publishedUrl: `${API_ORIGIN}/api/workflows/${workflowId}` }),
    executeWorkflowOnServer: async ({ workflow }) => {
        const recordId = workflow.metadata.workflowRecordId || workflow.metadata.id;
        const record = await executeWorkflow(context, recordId);
        return { accepted: true, run_id: String(record.data.executionRunId || record.data.executionId || record.id), stopped: record.status === 'stopped', workflow, logs: [] };
    },
    requestWorkflowAi: async () => unsupported('workflow.requestWorkflowAi'),
    fetchCredentials: async (serviceId) =>
        (await context.orm.entity('Credential').list({ first: 50, offset: 0, search: serviceId, scope: context.policy.scope })).rows.map((row) => ({
            id: row.id,
            credentialId: row.id,
            credentialName: row.title,
            serviceId,
            serviceName: row.subtitle || null,
            serviceIcon: null,
            scope: 'PERSONAL',
            scopeTag: 'User',
            status: row.status
        })),
    fetchCredentialById: async (credentialId) => {
        const row = await context.orm.entity('Credential').single(credentialId);
        return { id: row.id, credentialId: row.id, credentialName: row.title, serviceId: row.slug, serviceName: row.subtitle || null, serviceIcon: null, scope: 'PERSONAL', values: row.data };
    },
    openCredentialManager: () => window.open('/credentials', '_blank'),
    fetchExecutableWorkflows: async () => (await listWorkflows(context)).rows.map((row) => ({ workflowId: row.id, workflowName: row.title, scope: 'user', scopeTag: 'User', status: row.status })),
    listWorkflowUserNodes: async () => (await listUserNodes(context)).rows.map((row) => workflowUserNode(context, row)),
    createWorkflowUserNode: async (input) => workflowUserNode(context, await createUserNode(context, workflowUserNodeInput(input))),
    updateWorkflowUserNode: async (id, input) => workflowUserNode(context, await updateUserNode(context, id, workflowUserNodeInput(input))),
    deleteWorkflowUserNode: async (id) => {
        await deleteUserNode(context, id);
        return true;
    }
});
