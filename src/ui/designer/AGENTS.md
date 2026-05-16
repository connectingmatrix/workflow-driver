# src/workflow

## Purpose
Workflow package shims needed by the browser UI.

## Allowed Imports
- Workflow package types and ORM types for explicit boundary errors.

## Forbidden Imports
- Generic entity operation commands, direct backend handlers, raw database clients.

## Global Rules
- Product data flows only as Screen -> Dataloader -> ORM -> Backend.
- Do not add .gql or .graphql files; GraphQL strings live only in ORM, auth, or runtime infrastructure.
- Do not call fetch, graphqlRequest, or frontendGraphqlRequest from screens or components.
- Do not add mock fallbacks for product data. If the backend contract is broken, surface the exact failing operation.
- Do not create alternate CRUD paths, proxy files, shape-shifting helpers, or generated-output hand edits.
- Keep files focused and small; split by domain when a file grows beyond the local purpose.

## Local Rules
- Browser preview must not pretend it can run server-only backend handlers.
- Execute persisted workflows through workflow dataloaders/backend runtime.

## Validation
- Run yarn build after wiring changes.
- Run yarn test:orm when ORM metadata or query construction changes.
- Run yarn test:dataloaders when loaders, auth, or screen data contracts change.
