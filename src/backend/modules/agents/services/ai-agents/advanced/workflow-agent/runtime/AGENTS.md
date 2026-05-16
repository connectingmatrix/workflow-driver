# AGENTS.md

## Directory Context

- Path: `packages/apps/ai-agents/src/services/ai-agents/advanced/workflow-agent/runtime`
- This folder owns the production code files in this folder.

## Contract

- Keep all code in this folder aligned with its layer package boundary.
- If any production code file in this folder is updated, update this AGENTS.md in the same change.
- This AGENTS file must document each owned file purpose, input/output shape, role rules, logic gates, functions, exports, and line snippets.

## File Usage Specification

### `compiler.ts`
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
  - `validate` (L13-L13, arrow)
- Exports:
  - None
- Key snippets and use-case mapping:
  - `L13-L13`: Implements `validate` for this module use case.
### `process-sections.ts`
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
  - `buildCustomNodePlan` (L3-L3, arrow)
  - `buildSourceSystemMatrix` (L13-L13, arrow)
  - `buildDomainEntityMatrix` (L23-L23, arrow)
  - `buildArtifactPackage` (L36-L36, arrow)
  - `buildTestPlan` (L42-L42, arrow)
  - `buildFinalDeliveryReport` (L47-L47, arrow)
- Exports:
  - `buildCustomNodePlan` (L3)
  - `buildSourceSystemMatrix` (L13)
  - `buildDomainEntityMatrix` (L23)
  - `buildArtifactPackage` (L36)
  - `buildTestPlan` (L42)
  - `buildFinalDeliveryReport` (L47)
- Key snippets and use-case mapping:
  - `L3-L3`: Implements `buildCustomNodePlan` for this module use case.
  - `L13-L13`: Implements `buildSourceSystemMatrix` for this module use case.
  - `L23-L23`: Implements `buildDomainEntityMatrix` for this module use case.
  - `L36-L36`: Implements `buildArtifactPackage` for this module use case.
  - `L42-L42`: Implements `buildTestPlan` for this module use case.
  - `L47-L47`: Implements `buildFinalDeliveryReport` for this module use case.
### `process.ts`
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
  - `L1-L99`: File-level constants/types behavior.
### `strategies.ts`
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
  - `nestedWorkflowNodes` (L12-L12, arrow)
  - `cleanupNodes` (L20-L20, arrow)
  - `chartNodes` (L29-L29, arrow)
  - `rcmNodes` (L37-L37, arrow)
  - `taxonomyNodes` (L49-L49, arrow)
  - `genericNodes` (L57-L57, arrow)
- Exports:
  - `nestedWorkflowNodes` (L12)
  - `cleanupNodes` (L20)
  - `chartNodes` (L29)
  - `rcmNodes` (L37)
  - `taxonomyNodes` (L49)
  - `genericNodes` (L57)
- Key snippets and use-case mapping:
  - `L12-L12`: Implements `nestedWorkflowNodes` for this module use case.
  - `L20-L20`: Implements `cleanupNodes` for this module use case.
  - `L29-L29`: Implements `chartNodes` for this module use case.
  - `L37-L37`: Implements `rcmNodes` for this module use case.
  - `L49-L49`: Implements `taxonomyNodes` for this module use case.
  - `L57-L57`: Implements `genericNodes` for this module use case.

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
