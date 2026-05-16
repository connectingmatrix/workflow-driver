# AGENTS.md

## Directory Context

- Path: `packages/apps/workflow/src/services/workflow/agent/runtime`
- This folder owns the production code files in this folder.

## Contract

- Keep all code in this folder aligned with its layer package boundary.
- If any production code file in this folder is updated, update this AGENTS.md in the same change.
- This AGENTS file must document each owned file purpose, input/output shape, role rules, logic gates, functions, exports, and line snippets.

## File Usage Specification

### `agent-runtime-tool-registry.ts`
- Purpose: Defines module behavior owned by this usage folder.
- Owning use cases: Runtime and application flows that import this file through package boundaries.
- Input shape: Typed arguments and imported contracts declared in this file signatures.
- Output shape: Typed return values, thrown errors, and exported contracts declared in this file.
- Role interaction rules:
  - `User`: Allowed through explicit service/resolver authorization and scoped data access only.
  - `Root User`: Can execute elevated flows where caller context resolves root privileges.
  - `Super Admin`: Can execute organization-level privileged flows where membership and role gates pass.
- Logic gates summary:
  - Authorization and scope checks must run before read/write side effects.
  - Entity/ORM boundaries must remain the source of persisted data access.
  - MCP or GraphQL proxy boundaries must avoid duplicated domain validation.
- Functions (all):
  - None detected by static scan.
- Exports:
  - None
- Key snippets and use-case mapping:
  - `L1-L164`: File-level constants/types behavior.
### `entity-operation.ts`
- Purpose: Defines module behavior owned by this usage folder.
- Owning use cases: Runtime and application flows that import this file through package boundaries.
- Input shape: Typed arguments and imported contracts declared in this file signatures.
- Output shape: Typed return values, thrown errors, and exported contracts declared in this file.
- Role interaction rules:
  - `User`: Allowed through explicit service/resolver authorization and scoped data access only.
  - `Root User`: Can execute elevated flows where caller context resolves root privileges.
  - `Super Admin`: Can execute organization-level privileged flows where membership and role gates pass.
- Logic gates summary:
  - Authorization and scope checks must run before read/write side effects.
  - Entity/ORM boundaries must remain the source of persisted data access.
  - MCP or GraphQL proxy boundaries must avoid duplicated domain validation.
- Functions (all):
  - `requireContext` (L47-L47, arrow)
  - `loadRelationManager` (L102-L102, arrow)
  - `callRelation` (L110-L110, arrow)
  - `checkConfirmation` (L147-L147, arrow)
  - `summarizeCapabilityMatch` (L163-L163, arrow)
  - `inferRefetchSignals` (L174-L174, arrow)
  - `buildRelationInput` (L213-L213, arrow)
  - `executeRelationOperation` (L283-L283, arrow)
  - `batchEntityOperations` (L308-L308, arrow)
  - `executeEntityAgentOperation` (L314-L314, arrow)
- Exports:
  - `batchEntityOperations` (L308)
  - `executeEntityAgentOperation` (L314)
- Key snippets and use-case mapping:
  - `L47-L47`: Implements `requireContext` for this module use case.
  - `L102-L102`: Implements `loadRelationManager` for this module use case.
  - `L110-L110`: Implements `callRelation` for this module use case.
  - `L147-L147`: Implements `checkConfirmation` for this module use case.
  - `L163-L163`: Implements `summarizeCapabilityMatch` for this module use case.
  - `L174-L174`: Implements `inferRefetchSignals` for this module use case.
  - `L213-L213`: Implements `buildRelationInput` for this module use case.
  - `L283-L283`: Implements `executeRelationOperation` for this module use case.
  - `L308-L308`: Implements `batchEntityOperations` for this module use case.
  - `L314-L314`: Implements `executeEntityAgentOperation` for this module use case.
### `workflow-compiler.ts`
- Purpose: Defines module behavior owned by this usage folder.
- Owning use cases: Runtime and application flows that import this file through package boundaries.
- Input shape: Typed arguments and imported contracts declared in this file signatures.
- Output shape: Typed return values, thrown errors, and exported contracts declared in this file.
- Role interaction rules:
  - `User`: Allowed through explicit service/resolver authorization and scoped data access only.
  - `Root User`: Can execute elevated flows where caller context resolves root privileges.
  - `Super Admin`: Can execute organization-level privileged flows where membership and role gates pass.
- Logic gates summary:
  - Authorization and scope checks must run before read/write side effects.
  - Entity/ORM boundaries must remain the source of persisted data access.
  - MCP or GraphQL proxy boundaries must avoid duplicated domain validation.
- Functions (all):
  - None detected by static scan.
- Exports:
  - None
- Key snippets and use-case mapping:
  - `L1-L8`: File-level constants/types behavior.
### `workflow-operation.ts`
- Purpose: Defines module behavior owned by this usage folder.
- Owning use cases: Runtime and application flows that import this file through package boundaries.
- Input shape: Typed arguments and imported contracts declared in this file signatures.
- Output shape: Typed return values, thrown errors, and exported contracts declared in this file.
- Role interaction rules:
  - `User`: Allowed through explicit service/resolver authorization and scoped data access only.
  - `Root User`: Can execute elevated flows where caller context resolves root privileges.
  - `Super Admin`: Can execute organization-level privileged flows where membership and role gates pass.
- Logic gates summary:
  - Authorization and scope checks must run before read/write side effects.
  - Entity/ORM boundaries must remain the source of persisted data access.
  - MCP or GraphQL proxy boundaries must avoid duplicated domain validation.
- Functions (all):
  - `workflowPayloadFromDraft` (L40-L40, arrow)
  - `confirmationRequired` (L61-L61, arrow)
  - `currentCatalogInput` (L68-L68, arrow)
  - `createWorkflow` (L82-L82, arrow)
  - `executeWorkflow` (L99-L99, arrow)
  - `publishWorkflow` (L108-L108, arrow)
  - `updateWorkflow` (L117-L117, arrow)
  - `stopWorkflowExecution` (L134-L134, arrow)
  - `attachWorkflow` (L148-L148, arrow)
  - `debugWorkflow` (L165-L165, arrow)
  - `liveLogSnapshot` (L208-L208, arrow)
  - `executeWorkflowAgentOperation` (L229-L229, arrow)
  - `launchWorkflowSwarm` (L310-L310, arrow)
  - `deleteWorkflow` (L345-L345, arrow)
- Exports:
  - `executeWorkflowAgentOperation` (L229)
  - `listenWorkflowLiveEvents` (L354)
- Key snippets and use-case mapping:
  - `L40-L40`: Implements `workflowPayloadFromDraft` for this module use case.
  - `L61-L61`: Implements `confirmationRequired` for this module use case.
  - `L68-L68`: Implements `currentCatalogInput` for this module use case.
  - `L82-L82`: Implements `createWorkflow` for this module use case.
  - `L99-L99`: Implements `executeWorkflow` for this module use case.
  - `L108-L108`: Implements `publishWorkflow` for this module use case.
  - `L117-L117`: Implements `updateWorkflow` for this module use case.
  - `L134-L134`: Implements `stopWorkflowExecution` for this module use case.
  - `L148-L148`: Implements `attachWorkflow` for this module use case.
  - `L165-L165`: Implements `debugWorkflow` for this module use case.
  - `L208-L208`: Implements `liveLogSnapshot` for this module use case.
  - `L229-L229`: Implements `executeWorkflowAgentOperation` for this module use case.
  - `L310-L310`: Implements `launchWorkflowSwarm` for this module use case.
  - `L345-L345`: Implements `deleteWorkflow` for this module use case.

## Non-Negotiable Coding Standards

- Never ever write supabase.from we have entities always load data through it
- Do not use `supabase.from` or `input.from` directly. Load data through entities and the ORM.
- Do not add autofills
- Do not add placeholder, do not add normalisation.
- Find and fix the root cause instead of adding the fallback.
- Do not add fallbacks. Fix the logic.
- Everything should be typed dont use unknown, never, any
- Do not use JS-style safe/coercion helper functions.
- Do not use `to*` functions like `toPayload`.
- Do not create map functions.
- Do not check types like `type === Array` or `type === string`.
- Use the `||` operator for comparison.
- Do not write a code file bigger than 70-100 lines.
- Try to generalise multiple lines of code into fewer lines.
- After writing code, recheck patterns across the workspace to remove duplications.
- Do not invent functionality. Ask the user if it already exists somewhere.
- Prefer the smallest correct change over broad refactors.
- Preserve the repo's existing style, structure, and package manager.
- Avoid destructive git commands unless explicitly requested.
- Keep memory entries concise, factual, and tied to the files or behavior that changed.
- Entity table name should come from the Entity and not direct usage.
- Function naming should be .create, .delete .find .update .find .findBy .deleteBy
- Disallowed naming conventions are createRows, listRows and any programatic name for the entity.
- Importing supabase in the entities is disallowed. Upgrade the ORM file is something is not supported by entity. Orm is present at @gigav2/orm
- If Create, Update, Delete, Find is unable to do any thing stop the coding and inform the user of your updates first.
- Do not create proxy or additional functions for create, update, delete
- Keep ORM generic do not add Entity functions in the ORM
- MCP.ts will execute inner graphql for the operations they will not implement any
- JSON is disallowed in the Graphql Schema use proper types only
- Dont use zod for typing
