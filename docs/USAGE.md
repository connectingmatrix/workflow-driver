# Usage for @connectingmatrix/workflow-driver

```ts
import { Workflows } from '@connectingmatrix/workflow-driver';
const wf = Workflows.create({ name: 'Demo', definition: { nodes: [], edges: [] } }, ctx);
await Workflows.execute(wf.id, { input: {} }, ctx);
```

See `../README.md` for the full contract list.

## Eighth pass workflow AI and `.node` import contract

`@connectingmatrix/workflow-driver` owns workflow CRUD, validation, execution, versions, execution sockets/events, workflow AI sessions, and import of user `.node` packages into workflows. It binds the preserved workflow/executor packages through adapters and does not rewrite their contracts.

Public contracts:

```ts
Workflows.bindProcessMonitor(processMonitoring);
Workflows.bindNodes(Nodes);
Workflows.bindGigaAgents(GigaAgents);
await Workflows.debugWithAI(workflowId, { message: 'build debug execute current workflow' });
await Workflows.importNodePackageToWorkflow(workflowId, nodePackage, { x: 100, y: 200 });
await Workflows.execute(workflowId);
await Workflows.abortExecution(executionId, 'user aborted');
```

Dragging a `.node` package onto a workflow routes through `Workflows.importNodePackageToWorkflow(...)`, which delegates the package unpack/import to `@connectingmatrix/nodes`, then adds a user-node entry to the workflow definition for later edit/debug.
