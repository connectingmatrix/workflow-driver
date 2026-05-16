import type { GraphqlOperationContract, RoleGateContract } from '@giga/shared/types/contracts/integration-contract.types';

const roles: RoleGateContract[] = [
  { actor: 'User', canInvoke: true, constraints: ['Workflow read/execute permissions required by resolver access matrix.'] },
  { actor: 'Root User', canInvoke: true, constraints: ['Root scope still enforces plan-policy limits and scope checks.'] },
  { actor: 'Super Admin', canInvoke: true, constraints: ['Super-admin can operate across org/global workflows where policy allows.'] },
];

const sources = [
  'packages/apps/general/src/services/graphql/resolvers/integration/workflow.resolver.ts',
  'packages/apps/workflow/src/services/workflow',
];

const item = (
  operationName: string,
  kind: 'QUERY' | 'MUTATION',
  inputType: string,
  outputType: string,
  required: string[],
  optional: string[],
  notes: string[],
) => ({
  packageName: '@connectingmatrix/workflow-driver',
  operationName,
  kind,
  inputType,
  outputType,
  description: 'Workflow API surface composed by general GraphQL resolver and workflow runtime/services.',
  parameters: [
    ...required.map((name) => ({ name, type: 'field', required: true, description: 'Required argument.' })),
    ...optional.map((name) => ({ name, type: 'field', required: false, description: 'Optional argument.' })),
  ],
  combinations: [
    { name: 'default', required, optional, constraints: ['Workflow resolver validates keys and permission matrix before runtime calls.'] },
  ],
  roleGates: roles,
  sourcePaths: sources,
  notes,
});

export const GRAPHQL_CONTRACTS: GraphqlOperationContract[] = [
  item(
    'workflowCatalogRecords',
    'QUERY',
    'WorkflowCatalogRecordsInput',
    'WorkflowCatalogRecordsPayload',
    [],
    ['input.first', 'input.offset', 'input.scope', 'input.search', 'input.organizationIds'],
    ['Workflow selector/catalog list surface.'],
  ),
  item('workflowRecord', 'QUERY', 'id', 'JSON', ['id'], [], ['Detailed workflow record retrieval.']),
  item(
    'workflowExecutions',
    'QUERY',
    'workflowId/scope args',
    '[WorkflowExecutionPayload!]',
    ['workflowId', 'scope'],
    ['first', 'offset', 'organizationId'],
    ['Execution history list surface.'],
  ),
  item(
    'workflowVersions',
    'QUERY',
    'workflowId/scope args',
    '[WorkflowVersionRecordPayload!]',
    ['workflowId', 'scope'],
    ['organizationId'],
    ['Version history and selection surface.'],
  ),
  item(
    'workflowExecute',
    'MUTATION',
    'WorkflowExecutionInput',
    'WorkflowExecutionPayload',
    ['input.workflow'],
    ['input.workflowId', 'input.organizationId', 'input.chatId'],
    ['Runs workflow execution through backend queue.'],
  ),
  item('workflowDeleteVersions', 'MUTATION', 'versionIds', 'WorkflowDeleteVersionsPayload', ['versionIds'], [], ['Bulk delete workflow versions.']),
];

export const NO_GRAPHQL_SURFACE_REASON = '';
