import { executeWorkflowOperation, workflowCatalogRecordsOperation, workflowRecordOperation } from '@giga/dataloader/client/legacy/orm';
import type { EntityListResult, EntityMutationInput, EntityRecord, JsonObject } from '@giga/dataloader/client/legacy/orm';
import type { UiDataContext } from '@giga/dataloader/client/legacy/dataloaders/context';
import { assertCanPerform } from '@giga/dataloader/client/legacy/dataloaders/permissions.loader';
import { readStoredTokens } from '@giga/dataloader/client/legacy/graphql/helper';
import { WorkflowSocketClient, type WorkflowSocketEvent } from '@giga/dataloader/client/legacy/socket/workflow/WorkflowSocketClient';

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
