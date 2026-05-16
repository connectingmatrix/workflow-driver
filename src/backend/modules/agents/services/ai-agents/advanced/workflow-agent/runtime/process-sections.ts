import type { WorkflowAgentInput } from '../contracts/types';

export const buildCustomNodePlan = (medical: boolean, missingNodes: string[]) => [
  ...(medical
    ? [
        { nodeId: 'phi-redaction-gate', reason: 'Use if source artifacts can emit PHI downstream.' },
        { nodeId: 'model-evaluation-gate', reason: 'Use before model-backed scoring is approved for review.' },
      ]
    : []),
  ...missingNodes.map((nodeId) => ({ nodeId, reason: 'Missing from live workflow-nodes catalog.' })),
];

export const buildSourceSystemMatrix = (input: WorkflowAgentInput, medical: boolean, sharedSpaceAvailable: boolean) => [
  {
    sourceType: medical ? 'RCM_CSV_OR_X12' : 'workflow_input',
    sourceFile: input.sourceFile || '{sourceFile}',
    connectorNode: sharedSpaceAvailable ? 'shared-space' : 'file',
    checkpointStrategy: 'artifact checksum + run manifest',
    phiPiiRisk: medical ? 'high' : 'standard',
  },
];

export const buildDomainEntityMatrix = (medical: boolean) =>
  medical
    ? [
        {
          entity: 'Claim',
          commonFields: ['claimId', 'payerId', 'providerId', 'serviceDate', 'billedAmount'],
          sensitiveFields: ['patientName', 'memberId', 'dateOfBirth'],
        },
        { entity: 'Denial', commonFields: ['claimId', 'denialCode', 'denialReason', 'appealDeadline'], sensitiveFields: ['rawClaimText'] },
        { entity: 'Model Score', commonFields: ['claimId', 'riskBucket', 'confidence', 'topFactors'], sensitiveFields: [] },
      ]
    : [{ entity: 'Workflow Run', commonFields: ['workflowId', 'runId', 'status', 'artifactRoot'], sensitiveFields: [] }];

export const buildArtifactPackage = (artifactRoot: string) => ({
  root: artifactRoot,
  paths: ['contracts/source-schema.json', 'quality/validation-report.json', 'lineage/lineage-events.jsonl', 'final-report.md'],
  rawPhiAllowed: false,
});

export const buildTestPlan = (medical: boolean) => ({
  required: ['node catalog loading', 'workflow pattern mapping', 'data story generation', 'quality gates', 'PHI redaction rules', 'value score caps'],
  fixtures: medical ? ['synthetic-rcm-claims.csv'] : ['synthetic-workflow-input.json'],
});

export const buildFinalDeliveryReport = (missingNodes: string[]) => ({
  reportPath: 'src/services/ai-agents/advanced/workflow-agent/reports/final-workflow-delivery-report.md',
  qaScorePath: 'src/services/ai-agents/advanced/workflow-agent/reports/final-workflow-qa-score.md',
  knownLimitations: missingNodes,
});
