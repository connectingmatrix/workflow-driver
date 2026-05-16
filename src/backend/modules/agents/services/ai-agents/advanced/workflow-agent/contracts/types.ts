export type WorkflowAgentInput = {
  prompt?: string;
  message?: string;
  description?: string;
  name?: string;
  organizationId?: string;
  userId?: string;
  sourceFile?: string;
  target?: string;
  scenario?: string;
  bucket?: string;
  domain?: string;
  workflowKind?: string;
};

export type WorkflowAgentNode = {
  id: string;
  modelId: string;
  type: string;
  name: string;
  runtime: Record<string, unknown>;
  position?: { x: number; y: number };
};

export type WorkflowAgentEdge = { from: string; to: string };

export type WorkflowNodeCapability = {
  nodeId: string;
  nodeName: string;
  filePath: string;
  category: string;
  runtimeOwnership: string;
  workerOrBackend: string;
  inputs: string[];
  outputs: string[];
  commandPorts: string[];
  fields: string[];
  supportedOperations: string[];
  requiredCredentials: string[];
  sharedSpaceUsage: string;
  phiPiiSafetyLevel: string;
  dataVolumeSuitability: string;
  streamingSuitability: string;
  batchSuitability: string;
  retrySemantics: string;
  failureModes: string[];
  recommendedPatterns: string[];
  antiPatterns: string[];
  exampleUsage: string;
  testsAvailable: boolean;
  docsAvailable: boolean;
};

export type WorkflowNodeCatalogMatrix = {
  generatedAt: string;
  catalogRoot: string;
  dynamicSource: string;
  nodeCount: number;
  nodes: WorkflowNodeCapability[];
};

export type WorkflowAgentDraft = {
  id: string;
  name: string;
  description: string;
  workflow: { nodes: WorkflowAgentNode[]; edges: WorkflowAgentEdge[]; metadata: Record<string, unknown> };
  metadata: Record<string, unknown>;
  validation: { ok: boolean; errors: string[]; warnings: string[] };
};

export type WorkflowDevelopmentProcess = {
  status: 'ready';
  workflowKind: string;
  requirementBreakdown: Record<string, unknown>;
  dataStories: Record<string, unknown>[];
  workflowPatternMap: Record<string, unknown>[];
  nodeCatalog: WorkflowNodeCatalogMatrix;
  existingNodeMatches: string[];
  customNodePlan: Record<string, unknown>[];
  sourceSystemMatrix: Record<string, unknown>[];
  domainEntityMatrix: Record<string, unknown>[];
  dataContracts: Record<string, unknown>[];
  qualityGates: string[];
  sharedSpaceArtifactPlan: Record<string, unknown>;
  artifactPackage: Record<string, unknown>;
  workflowDag: WorkflowAgentDraft;
  workflowCypherValidation: Record<string, unknown>;
  backendApiPlan: Record<string, unknown>[];
  databaseProvisioningPlan: Record<string, unknown>[];
  securityPrivacyPlan: Record<string, unknown>;
  observabilityLineagePlan: Record<string, unknown>;
  modelEvaluationPlan: Record<string, unknown>;
  testPlan: Record<string, unknown>;
  implementationTasks: Record<string, unknown>[];
  valueScore: { total: number; capsApplied: string[] };
  definitionOfDone: { passed: boolean; checks: string[] };
  finalDeliveryReport: Record<string, unknown>;
  finalReport: string;
};
