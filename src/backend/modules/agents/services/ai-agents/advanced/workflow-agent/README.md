# Canonical Workflow Agent

This is the scoped operating system for `agent.workflow`. It merges advanced workflow control, chat/runtime workflow-agent behavior, and the heuristic workflow compiler into one backend advanced-agent surface.

Use `workflow.process` for matrix-first planning and `workflow.compile/create/execute/publish/debug/logs` for runtime workflow operations.

`workflow.process` loads node capabilities dynamically from `/Users/abeer/dev/giga/workflow-nodes/src/nodes` through `loadWorkflowNodeCatalog()`. The checked-in node matrix is a durable snapshot for review, while the live catalog is the runtime source of truth for existing-node matching and custom-node gap detection.
