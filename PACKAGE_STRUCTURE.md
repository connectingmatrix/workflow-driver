# connectingmatrix-workflows folder structure

The repo now uses domain-owned role folders. The package code is no longer parked under migration/transfer labels; it lives where it is owned and executed.

## Canonical layout

```text
connectingmatrix-workflows/
  src/
    index.ts
    package-structure.ts
    ui/
      index.ts
      graphql-client.ts
      dataloaders/
      screens/
      components/
      sockets/
      designer/
    backend/
      index.ts
      modules/
        <capability>/
    entity/
      index.ts
      repository.ts
      entities/
      repositories/
      graphql/
      services/
  migrations/
  tests/
    integration/
```

## Ownership rules

- `ui` contains frontend-facing package clients, dataloaders, screens/components, sockets, and designer launchers.
- `backend` contains server-side non-CRUD package runtime: middleware, GraphQL, APIs, execution services, MCP/status, uploads/webhooks, and package health.
- `entity` contains CRUD/data ownership: entities, repositories, entity GraphQL contracts, tenant scoping, and access-safe persistence.
- `migrations` is flat and package-owned; each package runs its own database scripts.
- `tests` contains independent package tests so the package remains playable outside `giga-ai-backend`.

## Source counts

| Area | Files | Bytes |
|---|---:|---:|
| `ui` | 11 | 51158 |
| `backend` | 126 | 621977 |
| `entity` | 9 | 60671 |
| `migrations` | 5 | 5122 |
| `tests` | 16 | 67671 |

## Final naming moves

- `backend`: `workflow` → `modules/workflows`, `ai-agents` → `modules/agents`
- `ui`: `app/screens` → `screens`, `workflow` → `designer`, `socket` → `sockets`
- `entity`: `repositories/entities` → `entities`, `services/graphql` → `graphql`

The default TypeScript build compiles the package adapter/public API. Full application-source folders are preserved under the role folders and kept out of the adapter build until final external dependency alias conversion is complete.
