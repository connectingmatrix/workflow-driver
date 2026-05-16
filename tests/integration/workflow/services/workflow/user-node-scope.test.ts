import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSourceFiles, validateNodeSchema } from '@connectingmatrix/nodes/services/workflow/user-nodes/io/normalize';
import { assertWorkflowNodePackageRules, reviewWorkflowNodeSourceRules } from '@connectingmatrix/nodes/services/workflow/user-nodes/runtime/rules';
import { canChangeRow, inputScope, normalizeScopeType, rowScope } from '@connectingmatrix/nodes/services/workflow/user-nodes/auth/scope';

test('workflow node scope helpers normalize user, organization, and global scopes', () => {
  assert.equal(normalizeScopeType('organization'), 'ORGANIZATION');
  assert.deepEqual(inputScope({}, 'user-1'), { scopeType: 'USER', scopeId: 'user-1' });
  assert.deepEqual(inputScope({ scopeType: 'ORGANIZATION', organizationId: 'org-1' }, 'user-1'), {
    scopeType: 'ORGANIZATION',
    scopeId: 'org-1',
  });
  assert.deepEqual(inputScope({ scopeType: 'GLOBAL' }, 'user-1'), { scopeType: 'GLOBAL', scopeId: null });
  assert.deepEqual(rowScope({ scope_type: 'USER', scope_id: 'user-1' }), { scopeType: 'USER', scopeId: 'user-1' });
});

test('workflow node scoped changes obey user and global ownership rules', async () => {
  assert.equal(
    await canChangeRow({ action: 'update', currentUserId: 'user-1', row: { scope_type: 'USER', scope_id: 'user-1' }, supabase: {} }),
    true,
  );
  assert.equal(
    await canChangeRow({ action: 'delete', currentUserId: 'user-2', row: { scope_type: 'USER', scope_id: 'user-1' }, supabase: {} }),
    false,
  );
  assert.equal(
    await canChangeRow({ action: 'update', currentUserId: 'user-1', effectiveRoot: true, row: { scope_type: 'GLOBAL' }, supabase: {} }),
    true,
  );
  assert.equal(await canChangeRow({ action: 'update', currentUserId: 'user-1', row: { scope_type: 'GLOBAL' }, supabase: {} }), false);
});

test('workflow node source and schema validation rejects malformed packages', () => {
  assert.deepEqual(
    normalizeSourceFiles({ 'worker.ts': 'export const execute = async () => ({ output: true });' })['worker.ts'].includes('execute'),
    true,
  );
  assert.throws(() => normalizeSourceFiles({ 'worker.ts': 'export const run = async () => ({ output: true });' }), /export execute/);
  assert.deepEqual(validateNodeSchema({ id: 'custom-tool' }, 'custom-tool'), { id: 'custom-tool' });
  assert.throws(() => validateNodeSchema({ id: 'other' }, 'custom-tool'), /must match/);
});

test('workflow node source rules reject unsafe worker-owned code', () => {
  const report = reviewWorkflowNodeSourceRules({
    'worker.ts': "import { readFileSync } from 'node:fs'; export const execute = async () => ({ output: true });",
  });
  assert.equal(report.ok, false);
  assert.equal(
    report.errors.some((entry) => entry.code === 'blocked_import'),
    true,
  );
  assert.throws(
    () =>
      assertWorkflowNodePackageRules({
        sourceFiles: { 'worker.ts': "export const execute = async () => ({ query: 'ai_workflowsCollection' });" },
      }),
    /Giga queries/,
  );
});
