import assert from 'node:assert/strict';
import test from 'node:test';
import { bindWorkflowCredentials } from '@connectingmatrix/workflow-driver/services/workflow/runtime/bindWorkflowCredentials';

const workflow = (credentialId = '') =>
  ({
    metadata: { id: 'wf-1', scope: { organizationId: 'org-1' } },
    input: { scope: { organizationId: 'org-1' } },
    nodeModels: { openai: { useCredentials: 'openai' } },
    nodes: [
      {
        id: 'openai-1',
        name: 'OpenAI',
        modelId: 'openai',
        runtime: credentialId ? { credentialId } : {},
        properties: credentialId ? { credentialId } : {},
      },
    ],
  } as any);

test('bindWorkflowCredentials prefers the organization namespace before personal and global', async () => {
  const scopes: string[] = [];
  const result = await bindWorkflowCredentials(
    { workflow: workflow(), scope: 'user', organizationId: 'org-1', supabase: {}, userId: 'user-1', effectiveRoot: false },
    {
      resolveScopeAccess: async (input) => ({
        scope: input.scope,
        organizationId: input.organizationId || null,
        userId: input.scope === 'PERSONAL' ? input.currentUserId : null,
        canCreate: false,
        canReadSecrets: false,
        canUpdate: false,
        canDelete: false,
        canExecute: true,
        canActivate: false,
      }),
      listScopedCredentials: async (_supabase, input) => {
        scopes.push(String(input.scope));
        return { access: {} as any, rows: input.scope === 'ORGANIZATION' ? [{ id: 'cred-org', status: 'ACTIVE' }] : [] } as any;
      },
    },
  );
  assert.deepEqual(scopes, ['ORGANIZATION']);
  assert.equal(result.nodes[0].runtime.credentialId, 'cred-org');
});

test('bindWorkflowCredentials preserves an attached credential', async () => {
  const result = await bindWorkflowCredentials(
    { workflow: workflow('cred-attached'), scope: 'user', organizationId: 'org-1', supabase: {}, userId: 'user-1', effectiveRoot: false },
    {
      resolveScopeAccess: async () => {
        throw new Error('should not resolve');
      },
      listScopedCredentials: async () => {
        throw new Error('should not list');
      },
    },
  );
  assert.equal(result.nodes[0].runtime.credentialId, 'cred-attached');
});

test('bindWorkflowCredentials fails when no active credential is available', async () => {
  await assert.rejects(
    bindWorkflowCredentials(
      { workflow: workflow(), scope: 'user', organizationId: 'org-1', supabase: {}, userId: 'user-1', effectiveRoot: false },
      {
        resolveScopeAccess: async (input) => ({
          scope: input.scope,
          organizationId: input.organizationId || null,
          userId: input.scope === 'PERSONAL' ? input.currentUserId : null,
          canCreate: false,
          canReadSecrets: false,
          canUpdate: false,
          canDelete: false,
          canExecute: true,
          canActivate: false,
        }),
        listScopedCredentials: async () => ({ access: {} as any, rows: [] } as any),
      },
    ),
    /requires an attached credential or an active openai credential before publishing/,
  );
});
