# Final Workflow QA Score

## Scoring Contract

- Requirement Coverage: 15
- Node/Workflow Completeness: 20
- Data Engineering Correctness: 20
- Backend/API/Database Completeness: 10
- Security/Privacy/Compliance: 15
- AI/ML Correctness: 10
- Testing/Validation: 5
- Documentation/Delivery: 5

## Caps

- Cap at 60 if no executable node graph exists.
- Cap at 60 if PHI/PII controls are missing for medical billing.
- Cap at 65 if data quality gates are missing.
- Cap at 70 if custom nodes lack tests.
- Cap at 75 if Workflow Cypher was not validated.
- Cap at 80 if final artifacts are not saved to SharedSpace.
- Cap at 80 if implied backend/API/database requirements are not implemented or documented.

## Current Implementation Status

`workflow.process` applies validation caps and returns `valueScore` plus `definitionOfDone`. Full production scoring still depends on runtime workflow validation and execution evidence.
