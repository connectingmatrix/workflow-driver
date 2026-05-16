# Workflow executor pub/sub

This package follows the runtime gap-closure contract:

- package owns its UI dataloaders, backend runtime adapter, entity layer, health/status, docs, and launcher;
- live process state is queue/process-monitor backed, not DB-authoritative;
- logs and aborts surface through `@connectingmatrix/logger` process monitoring;
- front-end dataloaders call package GraphQL/API surfaces and do not infer live status from stale DB rows.
