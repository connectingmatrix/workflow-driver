import { loadWorkflowNodeCatalog } from '../telemetry/node-catalog';
import { compileWorkflowAgentDraft } from './compiler';
import {
  buildArtifactPackage,
  buildCustomNodePlan,
  buildDomainEntityMatrix,
  buildFinalDeliveryReport,
  buildSourceSystemMatrix,
  buildTestPlan,
} from './process-sections';
import type { WorkflowAgentInput, WorkflowDevelopmentProcess } from '../contracts/types';

const RCM_EXISTING_NODES = [
  'shared-space',
  'rcm-csv-stream-profiler',
  'rcm-feature-builder',
  'rcm-decision-tree-trainer',
  'rcm-neural-net-trainer',
  'rcm-model-scorer',
  'rcm-knowledge-publisher',
  'evaluator',
  'respond-end',
];

const hasMedicalRisk = (text: string): boolean => /rcm|claim|remittance|billing|patient|denial|837|835|fhir/i.test(text);

export const buildWorkflowDevelopmentProcess = (input: WorkflowAgentInput): WorkflowDevelopmentProcess => {
  const prompt = (input.prompt || input.message || input.description || input.name || '').trim();
  if (!prompt) throw new Error('workflow.process requires prompt, message, description, or name.');
  const medical = hasMedicalRisk(prompt);
  const draft = compileWorkflowAgentDraft(input);
  const nodeCatalog = loadWorkflowNodeCatalog();
  const catalogNodeIds = new Set(nodeCatalog.nodes.map((node) => node.nodeId));
  const requestedKind = (input.workflowKind || input.domain || '').trim();
  const workflowKind = requestedKind || (medical ? 'medical-billing-rcm' : 'general-workflow');
  const requestedNodes = medical ? RCM_EXISTING_NODES : draft.workflow.nodes.map((node) => node.modelId);
  const existingNodeMatches = requestedNodes.filter((nodeId) => catalogNodeIds.has(nodeId));
  const missingNodes = requestedNodes.filter((nodeId) => !catalogNodeIds.has(nodeId));
  const qualityGates = ['schema conformance', 'required fields', 'checksum', 'record count', 'lineage'];
  const securityControls = medical
    ? ['phi/ephi classification', 'redaction before logs', 'no raw PHI in prompts', 'organization-scoped SharedSpace']
    : ['credential safety', 'organization scope'];
  const valueCaps = draft.validation.ok ? [] : ['75 without Workflow Cypher validation'];
  const artifactRoot = '/drive/{organizationId}/workflow-agent/{workflowSlug}/runs/{runId}/';
  const sharedSpaceAvailable = catalogNodeIds.has('shared-space');
  return {
    status: 'ready',
    workflowKind,
    requirementBreakdown: {
      prompt,
      outputs: ['workflow DAG', 'contracts', 'quality gates', 'SharedSpace artifacts', 'tests', 'final report'],
      nodeCatalogSource: nodeCatalog.catalogRoot,
    },
    dataStories: [
      {
        id: 'WF-001',
        role: medical ? 'RCM analyst' : 'workflow operator',
        outcome: 'validated executable workflow',
        value: 'repeatable operational execution',
      },
      { id: 'WF-002', role: 'compliance reviewer', outcome: 'safe artifacts and logs', value: 'audit-ready delivery' },
    ],
    workflowPatternMap: [
      {
        storyId: 'WF-001',
        patterns: medical ? ['RCM_CSV_PROFILE_AND_FEATURES', 'RCM_DENIAL_PREDICTION'] : ['BATCH_FILE_ETL', 'AI_AGENT_DRIVEN_WORKFLOW'],
      },
    ],
    nodeCatalog,
    existingNodeMatches,
    customNodePlan: buildCustomNodePlan(medical, missingNodes),
    sourceSystemMatrix: buildSourceSystemMatrix(input, medical, sharedSpaceAvailable),
    domainEntityMatrix: buildDomainEntityMatrix(medical),
    dataContracts: [
      { name: 'source-schema', required: ['organizationId', 'sourceFile'] },
      { name: 'standard-node-output', required: ['ok', 'summary', 'artifacts', 'metrics', 'warnings', 'errors', 'lineage', 'security'] },
    ],
    qualityGates: medical ? [...qualityGates, 'PHI redaction check', 'model label leakage check', 'model performance threshold'] : qualityGates,
    sharedSpaceArtifactPlan: {
      root: artifactRoot,
      reports: ['run-manifest.json', 'validation-report.json', 'lineage-events.jsonl', 'final-report.md'],
    },
    artifactPackage: buildArtifactPackage(artifactRoot),
    workflowDag: draft,
    workflowCypherValidation: draft.validation,
    backendApiPlan: medical ? [{ route: 'POST /api/workflows/rcm-denial/run', authRequired: true }] : [],
    databaseProvisioningPlan: medical ? [{ tableName: 'workflow_runs' }, { tableName: 'workflow_artifacts' }, { tableName: 'lineage_events' }] : [],
    securityPrivacyPlan: { classification: medical ? ['phi', 'ephi', 'financial', 'regulated'] : ['internal'], controls: securityControls },
    observabilityLineagePlan: { events: ['run.started', 'node.completed', 'quality.checked', 'run.completed'], checksums: true },
    modelEvaluationPlan: medical ? { required: true, metrics: ['precision', 'recall', 'F1', 'PR-AUC'], modelCard: true } : { required: false },
    testPlan: buildTestPlan(medical),
    implementationTasks: [{ id: 'WF-TASK-001', name: 'Validate DAG and contracts', completionCriteria: ['validation ok', 'tests pass'] }],
    valueScore: { total: valueCaps.length ? 75 : medical ? 95 : 90, capsApplied: valueCaps },
    definitionOfDone: { passed: draft.validation.ok, checks: ['node graph', 'contracts', 'quality gates', 'security gates', 'lineage', 'tests'] },
    finalDeliveryReport: buildFinalDeliveryReport(missingNodes),
    finalReport: `agent.workflow process ready for ${workflowKind}. Matched live nodes: ${existingNodeMatches.join(', ')}.`,
  };
};
