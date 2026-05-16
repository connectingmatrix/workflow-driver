export type {
  WorkflowConnectionModel,
  WorkflowDefinition,
  WorkflowExecuteMutationInput,
  WorkflowExecuteMutationPayload,
  WorkflowExecutionRequestContext,
  WorkflowExecutionResult,
  WorkflowExecutionRunOptions,
  WorkflowGovernorActionSummary,
  WorkflowGovernorTraceOutput,
  WorkflowMergeArrayEntry,
  WorkflowMergeOutput,
  WorkflowMetadata,
  WorkflowNodeFileValue,
  WorkflowNodeHandler,
  WorkflowNodeHandlerContext,
  WorkflowNodeHandlerResult,
  WorkflowNodeInstructionConfig,
  WorkflowNodeModel,
  WorkflowNodePorts,
  WorkflowNodeRenderConfig,
  WorkflowNodeSchema,
  WorkflowNodeStatus,
  WorkflowRunLogEvent,
  WorkflowRuntimeSettings,
  WorkflowStepExecutionArgs,
  WorkflowStepExecutionResult,
} from '@giga/shared/types/contracts/workflow.types';

export enum WorkflowNodeStatusEnum {
  Passed = 'passed',
  Failed = 'failed',
  Warning = 'warning',
  Running = 'running',
  Stopped = 'stopped',
}

export enum WorkflowNodeKindEnum {
  Process = 'process',
  Output = 'output',
  Error = 'error',
}

export enum WorkflowViewerTypeEnum {
  Json = 'json',
  Markdown = 'markdown',
  Raw = 'raw',
  Table = 'table',
}

export enum WorkflowAuthModeEnum {
  AutoFromCurrentSession = 'auto-from-current-session',
  Manual = 'manual',
  None = 'none',
}

export enum WorkflowLogLevelEnum {
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

export enum WorkflowExecutionModeEnum {
  Wait = 'WAIT',
  Async = 'ASYNC',
}

export enum WorkflowGovernorInputPortEnum {
  Input = 'input',
  Llm = 'llm',
  Tools = 'tools',
}

export enum WorkflowGovernorOutputPortEnum {
  Output = 'output',
}

export enum WorkflowMergeCombineModeEnum {
  Array = 'array',
  ByNodeId = 'by-node-id',
}

export enum WorkflowEventNameEnum {
  WorkflowStarted = 'workflow.started',
  NodeStarted = 'node.started',
  NodeLog = 'node.log',
  NodeFinished = 'node.finished',
  NodeFailed = 'node.failed',
  WorkflowStopped = 'workflow.stopped',
  WorkflowCompleted = 'workflow.completed',
  WorkflowValidationFailed = 'workflow.validation_failed',
}

export enum WorkflowOutputFormatEnum {
  Json = 'json',
  Markdown = 'markdown',
  Raw = 'raw',
  Table = 'table',
}

export enum WorkflowRemoteNodeIdEnum {
  AiGovernor = 'ai-governor',
  McpRuntime = 'mcp-runtime',
  SerpSearch = 'serp-search',
  AnalyzeTextWithModel = 'analyze-text-with-model',
  RunChannelAction = 'run-channel-action',
  RunCategoryAction = 'run-category-action',
  RunSubjectAction = 'run-subject-action',
  RunPostAction = 'run-post-action',
  RunUserTreeAction = 'run-user-tree-action',
  RunChatAction = 'run-chat-action',
  CurrentChat = 'current-chat',
  TextAnalysis = 'text-analysis',
  ActionRouter = 'action-router',
  ChatPlanPolicy = 'chat-plan-policy',
  ValidateWorkflowCypher = 'validate-workflow-cypher',
  Workflow = 'workflow',
  ExecuteWorkflow = 'execute-workflow',
  OutputFormat = 'output-format',
  OpenAI = 'openai',
  Claude = 'claude',
  Gemini = 'gemini',
  Groq = 'groq',
  DeepSeek = 'deepseek',
  Perplexity = 'perplexity',
  Mistral = 'mistral',
  Merge = 'merge',
}
