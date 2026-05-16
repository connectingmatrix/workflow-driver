import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { WorkflowNodeCapability, WorkflowNodeCatalogMatrix } from '../contracts/types';

type NodeSchema = {
  id?: string;
  group?: string;
  executorKey?: string;
  fields?: Record<string, { options?: Array<string | { value?: string }> }>;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  commands?: Record<string, unknown>;
};

const rootPath = (): string => process.env.WORKFLOW_NODES_ROOT || join(process.cwd(), '../workflow-nodes/src/nodes');
const words = (value: string): string => value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const schemaPath = (root: string, id: string): string => join(root, id, `${id}-schema.json`);
const read = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const keys = (value: Record<string, unknown> | undefined, prefix = ''): string[] => Object.keys(value || {}).map((key) => `${prefix}${key}`);

const category = (id: string, group: string): string => {
  const text = `${id} ${group}`.toLowerCase();
  if (/rcm|claim|remittance|billing/.test(text)) return 'medical-billing';
  if (/shared|file|drive|excel|sheet|artifact/.test(text)) return 'shared-space';
  if (/database|graphql|http|api|mcp/.test(text)) return 'api';
  if (/trainer|model|sentiment|churn|feature|evaluator|analysis/.test(text)) return 'ml-training';
  if (/agent|swarm/.test(text)) return 'agent';
  if (/workflow|start|respond|merge|loop|wait|stop/.test(text)) return 'orchestration';
  return 'integration';
};

const operations = (schema: NodeSchema, source: string): string[] => {
  const configured = (schema.fields?.operation?.options || []).map((item) => `${(item as { value?: string }).value || item}`);
  const literal = (source.match(/options:\s*\[([^\]]+)\]/)?.[1] || '').match(/['"][^'"]+['"]/g) || [];
  return [...new Set([...configured, ...literal.map((item) => item.slice(1, -1))])];
};

const entry = (root: string, id: string): WorkflowNodeCapability => {
  const raw = read(schemaPath(root, id));
  const schema = (raw ? JSON.parse(raw) : {}) as NodeSchema;
  const nodeSource = read(join(root, id, `${id}-node.ts`));
  const workerSource = read(join(root, id, 'worker.ts'));
  const group = schema.group || '';
  const cat = category(id, group);
  const backend = /createBackendToolWorker|executeBackend|backend-tool|server-only/i.test(`${nodeSource}\n${workerSource}`);
  const fields = keys(schema.fields as Record<string, unknown> | undefined);
  const commandPorts = [...keys(schema.commands), ...keys(schema.inputs, 'in:'), ...keys(schema.outputs, 'out:')].filter((item) =>
    /command/i.test(item),
  );
  return {
    nodeId: schema.id || id,
    nodeName: words(schema.id || id),
    filePath: relative(process.cwd(), join(root, id)),
    category: cat,
    runtimeOwnership: backend ? 'backend-tool' : 'workflow-node',
    workerOrBackend: backend ? 'backend' : 'worker.ts',
    inputs: keys(schema.inputs, 'in:'),
    outputs: keys(schema.outputs, 'out:'),
    commandPorts,
    fields: fields.length ? fields : ['runtime'],
    supportedOperations: operations(schema, nodeSource),
    requiredCredentials: /credential|apiKey|token|secret/i.test(`${raw}\n${nodeSource}\n${workerSource}`) ? ['node credential fields'] : [],
    sharedSpaceUsage: /shared-space|artifact|file|drive|sourceFile|outputPath/i.test(`${id}\n${raw}`) ? 'reads-or-writes-artifacts' : 'not-primary',
    phiPiiSafetyLevel: /rcm|claim|patient|phi|pii|fhir|837|835/i.test(`${id}\n${raw}`) ? 'high-review' : 'standard',
    dataVolumeSuitability: /stream|bulk|large|csv|parquet|database/i.test(`${id}\n${raw}`) ? 'large-batch' : 'standard',
    streamingSuitability: /stream|event|webhook/i.test(`${id}\n${raw}`) ? 'supported' : 'limited',
    batchSuitability: 'supported',
    retrySemantics: 'workflow-executor-policy',
    failureModes: ['validation_error', 'runtime_error', 'credential_or_permission_error'],
    recommendedPatterns: [cat],
    antiPatterns: ['Do not log secrets or raw PHI', 'Do not bypass workflow validation'],
    exampleUsage: `${schema.id || id} in a validated workflow DAG`,
    testsAvailable: existsSync(join(root, id, '__tests__')),
    docsAvailable: existsSync(join(root, id, 'README.md')),
  };
};

export const loadWorkflowNodeCatalog = (root = rootPath()): WorkflowNodeCatalogMatrix => {
  const names = readdirSync(root)
    .filter((name) => !name.startsWith('.') && statSync(join(root, name)).isDirectory())
    .sort();
  const nodes = names.map((name) => entry(root, name));
  return { generatedAt: new Date().toISOString(), catalogRoot: root, dynamicSource: 'workflow-nodes/src/nodes', nodeCount: nodes.length, nodes };
};
