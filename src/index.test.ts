import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflows } from './index.js';

test('workflow execute validates and runs through package-owned API', async () => {
  const w = Workflows.create({ name: 'wf', definition: { nodes: [], edges: [] } }, { userId: 'u' });
  const e = await Workflows.execute(w.id, {}, { userId: 'u' });
  assert.equal(e.status, 'success');
});

test('/workflow list is owned by workflow package and returns real scoped rows', () => {
  Workflows.create({ name: 'slash-wf' }, { userId: 'slash-u' });
  const out = Workflows.slash(['list'], { userId: 'slash-u' });
  assert.equal(typeof out, 'string');
  assert.match(out as string, /slash-wf/);
});
