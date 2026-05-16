import { executeWorkflowOperation, workflowCatalogRecordsOperation, workflowRecordOperation } from '@/orm';
import type { EntityListResult, EntityMutationInput, EntityRecord, JsonObject } from '@/orm';
import type { UiDataContext } from '@/dataloaders/context';
import { assertCanPerform } from '@/dataloaders/permissions.loader';
import { readStoredTokens } from '@/graphql/helper';
import { WorkflowSocketClient, type WorkflowSocketEvent } from '@/socket/workflow/WorkflowSocketClient';

export const listWorkflows = async (context: UiDataContext): Promise<EntityListResult> => {
    assertCanPerform(context.policy, 'Workflow', 'list');
    return workflowCatalogRecordsOperation({
        first: 25,
        offset: 0,
        organizationIds: context.policy.scope.kind === 'organization' ? [context.policy.scope.id] : []
    });
};

export const loadWorkflow = async (context: UiDataContext, id: string): Promise<EntityRecord> => {
    assertCanPerform(context.policy, 'Workflow', 'read');
    return workflowRecordOperation(id);
};

export const createWorkflow = async (context: UiDataContext, input: EntityMutationInput): Promise<EntityRecord> => {
    assertCanPerform(context.policy, 'Workflow', 'create');
    return context.orm.entity('Workflow').create(input);
};

const executionSettings = (): JsonObject => ({
    graphqlUrl: import.meta.env.VITE_GRAPHQL_API_URL,
    httpBaseUrl: import.meta.env.VITE_API_ORIGIN,
    authMode: 'auto',
});

export const executeWorkflow = async (context: UiDataContext, id: string): Promise<EntityRecord> => {
    assertCanPerform(context.policy, 'Workflow', 'execute');
    const record = await loadWorkflow(context, id);
    const workflow = record.data.payload || record.data.workflow;
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw new Error(`Workflow ${id} does not include an executable workflow payload.`);
    const execution = await executeWorkflowOperation({ workflow: workflow as JsonObject, settings: executionSettings(), mode: 'wait' });
    return { ...record, status: String(execution.stopped ? 'stopped' : 'running'), data: { ...record.data, execution } };
};

export const publishWorkflow = async (context: UiDataContext, id: string): Promise<EntityRecord> => {
    assertCanPerform(context.policy, 'Workflow', 'publish');
    const record = await loadWorkflow(context, id);
    return context.orm.entity('Workflow').load(id).update({ title: record.title, slug: record.slug, description: record.subtitle, data: { ...record.data.payload, status: 'published' } });
};

export const subscribeWorkflowCatalog = (_context: UiDataContext, handler: (event: WorkflowSocketEvent) => void): (() => void) => {
    const tokens = readStoredTokens();
    if (!tokens?.accessToken) throw new Error('Workflow catalog subscription requires an authenticated session.');
    return new WorkflowSocketClient(tokens.accessToken).connect(handler);
};

export interface WorkflowQueueStatusRow {
    processId: string;
    executionId: string;
    runId: string;
    workflowId: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted';
    progress: number;
    source: string;
    updatedAt: string;
    logs: string[];
}

export const loadWorkflowQueueStatus = async (context: UiDataContext, workflowId?: string): Promise<WorkflowQueueStatusRow[]> => {
    assertCanPerform(context.policy, 'Workflow', 'read');
    const tokens = readStoredTokens();
    const url = `${import.meta.env.VITE_GRAPHQL_API_URL}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(tokens?.accessToken ? { authorization: `Bearer ${tokens.accessToken}` } : {}) },
        body: JSON.stringify({ query: 'query WorkflowQueueStatus($workflowId: ID){ workflowQueueStatus(workflowId: $workflowId) }', variables: { workflowId } }),
    });
    const payload = await response.json();
    if (!response.ok || payload.errors?.length) throw new Error(JSON.stringify(payload.errors || payload));
    return JSON.parse(payload.data.workflowQueueStatus || '[]') as WorkflowQueueStatusRow[];
};

export const subscribeWorkflowQueueStatus = (_context: UiDataContext, workflowId: string, handler: (row: WorkflowQueueStatusRow) => void): (() => void) => {
    const tokens = readStoredTokens();
    if (!tokens?.accessToken) throw new Error('Workflow queue status subscription requires an authenticated session.');
    return new WorkflowSocketClient(tokens.accessToken).connect((event) => {
        if (event.eventName !== 'workflow:execution:update' && event.eventName !== 'workflow:event') return;
        const row = event.payload as WorkflowQueueStatusRow;
        if (!workflowId || row.workflowId === workflowId) handler(row);
    });
};


export const importNodePackageToWorkflow = async (context: UiDataContext, workflowId: string, archive: string): Promise<unknown> => {
    assertCanPerform(context.policy, 'Workflow', 'update');
    const tokens = readStoredTokens();
    const response = await fetch(import.meta.env.VITE_GRAPHQL_API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(tokens?.accessToken ? { authorization: `Bearer ${tokens.accessToken}` } : {}) },
        body: JSON.stringify({ query: 'mutation WorkflowImportNodePackage($workflowId: ID!, $archive: String!) { workflowImportNodePackage(workflowId: $workflowId, archive: $archive) }', variables: { workflowId, archive } }),
    });
    const payload = await response.json();
    if (!response.ok || payload.errors?.length) throw new Error(JSON.stringify(payload.errors || payload));
    return JSON.parse(payload.data.workflowImportNodePackage || '{}');
};
