# Auto-generated API

```json
{
  "package": "@connectingmatrix/workflow-driver",
  "summary": "Workflow CRUD, versioning, validation, execution events, slash commands, dataloaders, and designer launcher. Imports preserved workflow/executor contracts instead of replacing them.",
  "contracts": [
    "Workflows.getList/getObject/search/create/update/delete",
    "Workflows.validate/execute/setExecutorAdapter",
    "Workflows.versions/list/delete/publish",
    "Workflows.executions.list",
    "Workflows.onWorkflowExecute/onWorkflowCatalog",
    "workflowSlashCommands /workflow list/search/validate/execute"
  ],
  "exports": [
    ".",
    "./backend",
    "./ui",
    "./entity",
    "./package.json",
    "./package-structure",
    "./launcher",
    "./observability"
  ],
  "folderCounts": {
    "src/client": 11,
    "src/backend": 126,
    "src/entity": 9,
    "migrations": 5,
    "tests": 16
  },
  "launcher": "playground.mjs",
  "observability": true
}
```

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
