import type { WorkflowAgentNode } from '../contracts/types';

const node = (id: string, modelId: string, name: string, runtime: Record<string, unknown>, index: number): WorkflowAgentNode => ({
  id,
  modelId,
  type: modelId,
  name,
  runtime,
  position: { x: 100 + index * 280, y: 160 + (index % 2) * 120 },
});

export const nestedWorkflowNodes = (prompt: string) => [
  node('start', 'start', 'Start', { prompt }, 0),
  node('compile_child_workflow', 'workflow', 'Compile child workflow', { operation: 'compile', prompt }, 1),
  node('create_child_workflow', 'workflow', 'Create child workflow', { operation: 'create', fromPrevious: true }, 2),
  node('confirmation_gate', 'if-else', 'Confirm risky action', { confirmationRequired: /delete|remove|cleanup/.test(prompt) }, 3),
  node('end', 'respond-end', 'Respond End', { response: '{{create_child_workflow.output}}' }, 4),
];

export const cleanupNodes = (prompt: string) => [
  node('start', 'start', 'Start', { prompt }, 0),
  node('fetch_tree', 'run-user-tree-action', 'Fetch tree', { operation: 'list', includeChats: true, includePosts: true }, 1),
  node('filter_empty', 'code', 'Find empty paths', { codeIntent: 'Find branches without content.' }, 2),
  node('confirm', 'if-else', 'Confirm removal', { confirmationRequired: true }, 3),
  node('delete_empty', 'run-user-tree-action', 'Delete empty paths', { operation: 'delete', destructive: true }, 4),
  node('end', 'respond-end', 'Respond End', { response: '{{delete_empty.output}}' }, 5),
];

export const chartNodes = (prompt: string) => [
  node('start', 'start', 'Start', { prompt }, 0),
  node('load_data', 'file', 'Load or synthesize data', { requiredData: /pakistan|map/.test(prompt) ? 'map-region-population' : 'chart-data' }, 1),
  node('chart', 'chart', 'Render chart', { prompt, colorScale: /blue/.test(prompt) ? 'blue-choropleth' : 'auto' }, 2),
  node('publish', 'artifact-publish', 'Publish chart artifact', { type: 'chart' }, 3),
  node('end', 'respond-end', 'Respond End', { response: '{{publish.output}}' }, 4),
];

export const rcmNodes = (prompt: string) => [
  node('start', 'start', 'Start', { prompt }, 0),
  node('cache', 'shared-space', 'Ensure input cached', { operation: 'ensure_cached' }, 1),
  node('profile', 'rcm-csv-stream-profiler', 'Profile RCM CSV', { phiSafe: true }, 2),
  node('features', 'rcm-feature-builder', 'Build features', { target: '{{workflow.input.target}}' }, 3),
  node('tree', 'rcm-decision-tree-trainer', 'Train decision tree', { maxDepth: 5 }, 4),
  node('neural', 'rcm-neural-net-trainer', 'Train neural net', { hashSize: 4096, learningRate: 0.05 }, 5),
  node('score', 'rcm-model-scorer', 'Score scenario', { scenario: '{{workflow.input.scenario}}' }, 6),
  node('publish', 'rcm-knowledge-publisher', 'Publish knowledge', { channelName: 'RCM Denial Intelligence' }, 7),
  node('end', 'respond-end', 'Respond End', { response: '{{publish.output}}' }, 8),
];

export const taxonomyNodes = (prompt: string) => [
  node('start', 'start', 'Start', { prompt }, 0),
  node('taxonomy', 'ai-agent', 'Build taxonomy', { prompt, todo: 'Create or link taxonomy without duplication.' }, 1),
  node('lookup_existing', 'run-user-tree-action', 'Find existing tree nodes', { operation: 'find' }, 2),
  node('create_missing', 'run-user-tree-action', 'Create missing nodes', { operation: 'create_or_get' }, 3),
  node('end', 'respond-end', 'Respond End', { response: '{{create_missing.output}}' }, 4),
];

export const genericNodes = (prompt: string) => [
  node('start', 'start', 'Start', { prompt }, 0),
  node('agent', 'ai-agent', 'AI Agent', { prompt, mode: 'capability-driven' }, 1),
  node('end', 'respond-end', 'Respond End', { response: '{{agent.output}}' }, 2),
];
