# Auto-generated contracts for `@connectingmatrix/workflows`

This document is generated from the final package audit. The package owns its `src/client`, `src/backend`, `src/entity`, migrations, GraphQL/API surfaces, health/status, launcher, and tests unless this is a thin shell repo.

## Public contracts

- `Workflows.getList/getObject/search/create/update/delete`
- `Workflows.validate/execute/abortExecution`
- `Workflows.versions.list/delete/publish`
- `Workflows.executions.list`
- `Workflows.debugWithAI/buildWithAI/runWithAI/configurePreservedWorkflowAI`
- `Workflows.importNodePackageToWorkflow(workflowId, archive, position)`

## Package use

```ts
import { createPackage } from '@connectingmatrix/workflows';
const pkg = createPackage();
await pkg.health?.();
```

## Backend registration

Register `pkg.routes`, merge `pkg.graphql`, run `pkg.migrations`, and keep auth/signature handling delegated to `@connectingmatrix/orm`.

## Frontend binding

UI adapters expose `bindWithServer('/graphql')` or route-specific helpers. Domain logic remains in the owning package.

## Launcher

```bash
npm run build
npm test
node playground.mjs
```
