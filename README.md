# @connectingmatrix/workflow-driver

Workflow CRUD, versioning, validation, execution events, slash commands, dataloaders, and designer launcher. Imports preserved workflow/executor contracts instead of replacing them.

## Ownership

This package owns its `src/client`, `src/backend`, `src/entity`, GraphQL bundle, migrations, health/status, launcher, and package contracts. It can be included in backend or UI without assuming a monorepo.

## Public contracts

- `Workflows.getList/getObject/search/create/update/delete`
- `Workflows.validate/execute/setExecutorAdapter`
- `Workflows.versions/list/delete/publish`
- `Workflows.executions.list`
- `Workflows.onWorkflowExecute/onWorkflowCatalog`
- `workflowSlashCommands /workflow list/search/validate/execute`


## Basic usage

```ts
import { Workflows } from '@connectingmatrix/workflow-driver';
const wf = Workflows.create({ name: 'Demo', definition: { nodes: [], edges: [] } }, ctx);
await Workflows.execute(wf.id, { input: {} }, ctx);
```

## Server usage

```ts
import { createPackage } from '@connectingmatrix/workflow-driver';
const pkg = createPackage();
await pkg.health?.();
// register pkg.routes as middleware and merge pkg.graphql into /graphql
```

## UI usage

Package UI modules expose `bindWithServer('/graphql')` where applicable. Domain packages own their dataloaders; the thin UI only renders/binds.

## Observability and process monitor

All packages expose `PackageObservability`. The server wires logger and sockets into every package. Logger registers package health probes and exposes `/logger/process-monitor` plus `/server/process-monitor`.

## Launcher

Run locally:

```bash
npm run build
node playground.mjs
```

The launcher opens in stub mode so the package can be tested independently, similar to workflow designer stub mode.

## GraphQL and routes

GraphQL namespace and routes are returned by `createPackage()`. Routes include health and launcher endpoints when needed.

## Exports

- `.`
- `./backend`
- `./ui`
- `./entity`
- `./package.json`
- `./package-structure`
- `./services/package-status.service`
- `./observability`

## Folder counts

- `src/client`: 11 files
- `src/backend`: 126 files
- `src/entity`: 9 files
- `migrations`: 5 files
- `tests`: 16 files



## Final gap closure

See `docs/FINAL_GAP_CLOSURE_CONTRACTS.md` for the final process-monitor, project, node, workflow, and package-owned contract audit.

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

## Final runtime contracts

See `docs/FINAL_RUNTIME_CONTRACTS.md` for the final package-owned API, routes, launcher, observability, and wiring contracts.


## Final package contracts

- `Workflows.getList/getObject/search/create/update/delete`
- `Workflows.validate/execute/abortExecution`
- `Workflows.versions.list/delete/publish`
- `Workflows.executions.list`
- `Workflows.debugWithAI/buildWithAI/runWithAI/configurePreservedWorkflowAI`
- `Workflows.importNodePackageToWorkflow(workflowId, archive, position)`

See `docs/AUTO_GENERATED_CONTRACTS.md` and `docs/OBSERVABILITY.md` for generated operational docs.


## Examples

Debug/demo launchers live in `examples/`. Run `npm run play` after `npm run build`.

## Package documentation

See `docs/INDEX.md` for the final clean workspace contract and `examples/` launcher/debug notes.
