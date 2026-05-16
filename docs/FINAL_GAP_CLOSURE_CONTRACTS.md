# Final Gap Closure Contracts

Package: `@connectingmatrix/workflows`

This document records the final implementation pass for the package-segregated architecture. Each package keeps its own `src/ui`, `src/backend`, `src/entity`, migrations, GraphQL/API contracts, health/status, launcher and tests. Backend/UI shells only wire or render package surfaces.

## Offered contracts

- Workflow CRUD/search/validate/execute
- versions/list/delete/publish
- workflow-ai build/debug/run/execute
- .node import to workflow canvas
- workflow execution sockets/process tracking

## Observability

Packages that create runtime work bind to `@connectingmatrix/logger` and publish process snapshots/logs through the shared process monitor. The shared API surface is:

```ts
processMonitoring.list();
processMonitoring.live();
processMonitoring.logs.live('PROCESS_ID');
processMonitoring.abort('PROCESS_ID', 'reason');
```

Processes are normalized into Workflows, Ai Agents, Swarm, Projects, Nodes, Files, Drive, Server and package/runtime rows.

## Stub launcher

Run the package locally with:

```bash
npm run build
npm test
node playground.mjs
```

The launcher intentionally runs in stub/playground mode so the repo can be opened and tested independently.
