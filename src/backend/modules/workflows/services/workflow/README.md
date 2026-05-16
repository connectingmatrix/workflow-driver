# Workflow Service (Backend)

This folder contains backend workflow orchestration integration points and server node handlers.

## Architecture

- Shared runtime orchestration is implemented in `@workflow/executor`.
- Backend adapter wiring and wrappers live under:
  - `executor/` (see `executor/README.md` for full architecture contract).
- Wrapper compatibility keeps both executor contracts active:
  - legacy logger contract (`logger.push` + `logger.entries`)
  - current callback contract (`onEvent` / `events`)
- Backend-specific responsibilities remain local:
  - `nodes/node-handlers.ts`
  - `service.ts` GraphQL mutation orchestration
  - socket event integration

## Update Sequence

1. Update shared runtime package in `giga-wf-executor`.
2. Upgrade backend dependency: `yarn upgrade @workflow/executor`.
   - Keep `#main` refs in `package.json`.
   - Commit refreshed lockfiles so frontend/backend use the same resolved revision.
3. Validate backend:
   - `yarn run tsc -p tsconfig.json --noEmit`
   - `yarn build`
   - `yarn test workflow:compat`
4. Run workflow GraphQL/socket smoke checks.
