import type { WorkflowDefinition } from '@giga/shared/types/contracts/workflow.types';

function workflowNodes(workflow: WorkflowDefinition) {
  return Array.isArray(workflow?.nodes) ? workflow.nodes : [];
}

function workflowConnections(workflow: WorkflowDefinition) {
  return Array.isArray(workflow?.connections) ? workflow.connections : [];
}

function reachableNodeIds(workflow: WorkflowDefinition, startId: string) {
  const outgoing = new Map<string, string[]>();
  workflowConnections(workflow).forEach((connection) => {
    const from = String(connection.from || '').trim();
    const next = String(connection.to || '').trim();
    if (!from || !next) return;
    outgoing.set(from, [...(outgoing.get(from) || []), next]);
  });
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift() as string;
    (outgoing.get(current) || []).forEach((next) => {
      if (seen.has(next)) return;
      seen.add(next);
      queue.push(next);
    });
  }
  return seen;
}

export function workflowValidationErrors(workflow: WorkflowDefinition) {
  const nodes = workflowNodes(workflow);
  const connections = workflowConnections(workflow);
  const errors: string[] = [];
  if (!nodes.length) errors.push('Workflow must contain executable nodes.');
  if (!connections.length) errors.push('Workflow must contain node connections.');
  const ids = new Set(nodes.map((node) => String(node.id || '').trim()).filter(Boolean));
  nodes.forEach((node) => {
    if (!String(node.id || '').trim()) errors.push('Workflow nodes must have ids.');
    if (!String(node.modelId || '').trim()) errors.push(`Workflow node ${String(node.id || 'unknown')} must have a modelId.`);
  });
  connections.forEach((connection) => {
    const from = String(connection.from || '').trim();
    const target = String(connection.to || '').trim();
    if (!ids.has(from)) errors.push(`Workflow connection ${String(connection.id || 'unknown')} has an unknown source node.`);
    if (!ids.has(target)) errors.push(`Workflow connection ${String(connection.id || 'unknown')} has an unknown target node.`);
  });
  const starts = nodes.filter((node) => node.modelId === 'start');
  const ends = nodes.filter((node) => node.modelId === 'respond-end');
  if (starts.length !== 1) errors.push('Executable workflows must contain exactly one Start node.');
  if (!ends.length) errors.push('Executable workflows must contain at least one Respond End node.');
  if (starts.length === 1 && ends.length) {
    const reachable = reachableNodeIds(workflow, starts[0].id);
    if (!ends.some((node) => reachable.has(node.id))) errors.push('At least one Respond End node must be reachable from Start.');
  }
  return errors;
}

export function assertExecutableWorkflow(workflow: WorkflowDefinition) {
  const errors = workflowValidationErrors(workflow);
  if (errors.length) throw new Error(errors.join(' '));
}
