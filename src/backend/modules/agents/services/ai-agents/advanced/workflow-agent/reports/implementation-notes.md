# Implementation Notes

The canonical public advanced tool is `agent.workflow`. Legacy workflow-control public IDs are intentionally removed.

Node capability discovery now runs through `loadWorkflowNodeCatalog()`, which scans the sibling `workflow-nodes/src/nodes` tree at runtime. The static node matrix remains a durable snapshot for review, not the runtime source of truth.
