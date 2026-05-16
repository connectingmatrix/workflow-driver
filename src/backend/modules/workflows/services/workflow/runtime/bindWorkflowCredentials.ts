import { listCredentials } from '@giga/general/services/credentials/runtime/service';
import { resolveRuntimeCredentialAccess } from '@giga/general/services/credentials/auth/access';
import { parseRecordValue, parseStringValue } from '@connectingmatrix/workflow-driver/services/workflow/runtime/runtime-utils';
import type { WorkflowDefinition, WorkflowNodeModel } from '@connectingmatrix/workflow-driver/services/workflow/contracts/types';

type WorkflowPublishScope = 'user' | 'organization' | 'global';
type PublishCredentialServices = {
  listScopedCredentials: typeof listCredentials;
  resolveScopeAccess: typeof resolveRuntimeCredentialAccess;
};

const defaultServices: PublishCredentialServices = { listScopedCredentials: listCredentials, resolveScopeAccess: resolveRuntimeCredentialAccess };
const organizationId = (workflow: WorkflowDefinition, scopeId?: string | null): string =>
  parseStringValue(
    scopeId ||
      parseRecordValue(workflow.metadata).organizationId ||
      parseRecordValue(parseRecordValue(workflow.metadata).scope).organizationId ||
      parseRecordValue(parseRecordValue(workflow.input).scope).organizationId,
  );
const nodeCredentialId = (node: WorkflowNodeModel): string =>
  parseStringValue(parseRecordValue(node.properties).credentialId || parseRecordValue(node.runtime).credentialId);
const nodeCredentialServiceId = (workflow: WorkflowDefinition, node: WorkflowNodeModel): string =>
  parseStringValue(parseRecordValue(parseRecordValue(workflow.nodeModels)[String(node.modelId || '')]).useCredentials);
const patchNodeCredential = (node: WorkflowNodeModel, credentialId: string): WorkflowNodeModel => ({
  ...node,
  runtime: { ...(node.runtime || {}), credentialId },
  properties: { ...(node.properties || {}), credentialId },
});
const scopeBlocked = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('Insufficient permissions') || message.includes('do not have access');
};
const credentialScopes = (workflowScope: WorkflowPublishScope, workflowOrganizationId: string) =>
  workflowScope === 'global'
    ? [{ scope: 'GLOBAL' as const, organizationId: null }]
    : workflowScope === 'organization' && workflowOrganizationId
    ? [
        { scope: 'ORGANIZATION' as const, organizationId: workflowOrganizationId },
        { scope: 'GLOBAL' as const, organizationId: null },
      ]
    : workflowOrganizationId
    ? [
        { scope: 'ORGANIZATION' as const, organizationId: workflowOrganizationId },
        { scope: 'PERSONAL' as const, organizationId: null },
        { scope: 'GLOBAL' as const, organizationId: null },
      ]
    : [
        { scope: 'PERSONAL' as const, organizationId: null },
        { scope: 'GLOBAL' as const, organizationId: null },
      ];

async function activeCredentialId(input: {
  effectiveRoot: boolean;
  serviceId: string;
  services: PublishCredentialServices;
  supabase: any;
  userId: string;
  workflowOrganizationId: string;
  workflowScope: WorkflowPublishScope;
}): Promise<string> {
  for (const scope of credentialScopes(input.workflowScope, input.workflowOrganizationId)) {
    try {
      const access = await input.services.resolveScopeAccess({
        supabase: input.supabase,
        currentUserId: input.userId,
        effectiveRoot: input.effectiveRoot,
        scope: scope.scope,
        organizationId: scope.organizationId,
      });
      if (!access.canExecute && !access.canReadSecrets) continue;
      const listed = await input.services.listScopedCredentials(
        input.supabase,
        { scope: scope.scope, organizationId: scope.organizationId, serviceId: input.serviceId },
        access,
      );
      const active = listed.rows.find((row) => row.status === 'ACTIVE');
      if (active?.id) return String(active.id);
    } catch (error) {
      if (scopeBlocked(error)) continue;
      throw error;
    }
  }
  return '';
}

export async function bindWorkflowCredentials(
  input: {
    effectiveRoot: boolean;
    organizationId?: string | null;
    scope: WorkflowPublishScope;
    supabase: any;
    userId: string;
    workflow: WorkflowDefinition;
  },
  services: PublishCredentialServices = defaultServices,
): Promise<WorkflowDefinition> {
  const workflowOrganizationId = organizationId(input.workflow, input.organizationId);
  const cache = new Map<string, Promise<string>>();
  let changed = false;
  const nodes = await Promise.all(
    (input.workflow.nodes || []).map(async (node) => {
      if (nodeCredentialId(node)) return node;
      const serviceId = nodeCredentialServiceId(input.workflow, node);
      if (!serviceId) return node;
      const key = `${input.scope}:${workflowOrganizationId}:${serviceId}`;
      const nextCredentialId =
        (await (cache.get(key) ||
          (cache.set(
            key,
            activeCredentialId({
              effectiveRoot: input.effectiveRoot,
              serviceId,
              services,
              supabase: input.supabase,
              userId: input.userId,
              workflowOrganizationId,
              workflowScope: input.scope,
            }),
          ),
          cache.get(key)))) || '';
      if (!nextCredentialId)
        throw new Error(
          `Node "${parseStringValue(
            node.name || node.id || serviceId,
          )}" requires an attached credential or an active ${serviceId} credential before publishing.`,
        );
      changed = true;
      return patchNodeCredential(node, nextCredentialId);
    }),
  );
  return changed ? { ...input.workflow, nodes } : input.workflow;
}
