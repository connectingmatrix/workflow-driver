import { randomUUID } from 'node:crypto';
import { chartNodes, cleanupNodes, genericNodes, nestedWorkflowNodes, rcmNodes, taxonomyNodes } from './strategies';
import type { WorkflowAgentDraft, WorkflowAgentEdge, WorkflowAgentInput, WorkflowAgentNode } from '../contracts/types';

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90) || 'workflow';
const edges = (nodes: WorkflowAgentNode[]): WorkflowAgentEdge[] => nodes.slice(1).map((item, index) => ({ from: nodes[index].id, to: item.id }));

const validate = (nodes: WorkflowAgentNode[], links: WorkflowAgentEdge[]) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  for (const item of nodes) {
    if (!item.id) errors.push('Workflow node is missing id.');
    if (ids.has(item.id)) errors.push(`Duplicate node id: ${item.id}`);
    ids.add(item.id);
    if (!item.modelId) errors.push(`Node ${item.id} is missing modelId.`);
  }
  for (const link of links) {
    if (!ids.has(link.from)) errors.push(`Edge references missing source ${link.from}.`);
    if (!ids.has(link.to)) errors.push(`Edge references missing target ${link.to}.`);
  }
  if (!nodes.length) errors.push('Workflow must have at least one node.');
  if (nodes.length > 1 && !links.length) warnings.push('Workflow has multiple nodes but no edges.');
  return { ok: errors.length === 0, errors, warnings };
};

const nodesForPrompt = (prompt: string): WorkflowAgentNode[] => {
  const lower = prompt.toLowerCase();
  if (/create.*workflow.*create.*workflow|workflow.*to.*create.*workflow/.test(lower)) return nestedWorkflowNodes(lower);
  if (/empty.*channel|empty.*tree|remove.*empty|clean.*tree/.test(lower)) return cleanupNodes(lower);
  if (/chart|plot|map|population|blue shades|visual/.test(lower)) return chartNodes(lower);
  if (/rcm|medical billing|denial|claim|remittance|training|train/.test(lower)) return rcmNodes(lower);
  if (/world politics|region|country|genre|tree structure|content structure|taxonomy/.test(lower)) return taxonomyNodes(lower);
  return genericNodes(prompt);
};

export const compileWorkflowAgentDraft = (input: WorkflowAgentInput): WorkflowAgentDraft => {
  const prompt = (input.prompt || input.message || input.description || input.name || '').trim();
  if (!prompt) throw new Error('workflow compiler requires prompt, message, description, or name.');
  const name = (input.name || prompt.slice(0, 70)).trim();
  const nodes = nodesForPrompt(prompt);
  const links = edges(nodes);
  return {
    id: randomUUID(),
    name,
    description: prompt,
    workflow: { nodes, edges: links, metadata: { generatedBy: 'agent.workflow', prompt } },
    metadata: { generatedBy: 'agent.workflow', prompt, slug: slug(name) },
    validation: validate(nodes, links),
  };
};
