import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflows } from './index.js';
test('workflow execute validates and runs through package-owned API and process tracking', async () => {
    const w = Workflows.create({ name: 'wf', definition: { nodes: [], edges: [] } }, { userId: 'u' });
    const e = await Workflows.execute(w.id, {}, { userId: 'u' });
    assert.equal(e.status, 'success');
});
test('/workflow list is owned by workflow package and returns real scoped rows', () => {
    Workflows.create({ name: 'slash-wf' }, { userId: 'slash-u' });
    const out = Workflows.slash(['list'], { userId: 'slash-u' });
    assert.equal(typeof out, 'string');
    assert.match(out, /slash-wf/);
});
test('workflow AI configures preserved workflow-ai and can debug/execute current workflow', async () => {
    const ctx = { userId: 'ai-u' };
    Workflows.configurePreservedWorkflowAI(async () => ({ message: 'workflow agent ok', executeInput: { ok: true } }));
    const w = Workflows.create({ name: 'ai-wf', definition: { nodes: [], edges: [] } }, ctx);
    const debug = await Workflows.debugWithAI(w.id, { message: 'debug current workflow', execute: true }, ctx);
    assert.equal(typeof debug.message, 'string');
    assert.equal(debug.execution?.status, 'success');
    assert.equal(Workflows.health().details?.preservedWorkflowAIConfigured, true);
});
test('workflow imports .node packages through bound node adapter', async () => {
    let imported = false;
    Workflows.bindNodes({ importNodePackage: () => { imported = true; return { id: 'node-1' }; } });
    const result = await Workflows.importNodePackage('node-package', { userId: 'u' });
    assert.equal(imported, true);
    assert.equal(Boolean(result.importedNode), true);
});
