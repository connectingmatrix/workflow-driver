import { parseRecordValue, parseStringValue } from 'giga-ai-helper/workflow';
import { EntityRequestContext } from '@connectingmatrix/orm/orm/request-entity-context';
import { withEntityRequestContext } from '@connectingmatrix/orm/services/graphql/entity-request-context';
import { runOpenAIAgentsSdkAgent } from '@connectingmatrix/ai-agents/services/ai-agents/runtime/openai-agents-sdk';
import { runStoredAIAgent } from '@connectingmatrix/ai-agents/services/ai-agents/runtime/agent-service';
import { executeBackendAgentCommand } from '@giga/execute-backend/services/agent/execute-backend';
import { WorkflowNodeStatusEnum } from '@connectingmatrix/workflows/services/workflow/contracts/types';
import type { WorkflowNodeHandlerContext, WorkflowNodeHandlerResult } from '@connectingmatrix/workflows/services/workflow/contracts/types';
import type { GraphqlResolverContext } from '@giga/shared/types/contracts/graphql.types';
import type { AgentActionPlan, AgentToolExecution, AgentToolSpec } from '@workflow/nodes/nodes/ai-agent/runtime';

const text = (value: unknown): string => parseStringValue(value).trim();
const record = (value: unknown): Record<string, unknown> => parseRecordValue(value);

const toolResolverContext = (
  context: WorkflowNodeHandlerContext,
  operationName: string,
  payload: Record<string, unknown>,
): GraphqlResolverContext => {
  const request = context.requestContext.request as unknown as Record<string, unknown>;
  const effectiveRoot = request.effectiveRoot === true;
  return {
    request: context.requestContext.request,
    supabase: context.requestContext.supabase,
    body: { operationName, query: '', variables: payload },
    graphqlContext: null,
    userId: context.requestContext.userId,
    effectiveRoot,
  };
};

const toExecution = (
  action: AgentActionPlan,
  result: Awaited<ReturnType<typeof executeBackendAgentCommand>>,
  startedAt: number,
): AgentToolExecution => ({
  action,
  status: result.status === 'failed' ? 'failed' : result.status === 'confirmation_required' ? 'confirmation_required' : 'completed',
  output: result.output,
  error: result.error || null,
  logs: result.logs || [],
  files: result.files || [],
  durationMs: Date.now() - startedAt,
});

type SharedAgentRuntimeInput = {
  message: string;
  systemPrompt?: string | null;
  knowledge?: string | string[] | Record<string, unknown>[] | null;
  attachments?: Record<string, unknown>[];
  context?: Record<string, unknown>;
  confirmed?: boolean;
  maxActionsPerPass?: number;
  maxPasses?: number;
  outputFormatSeed?: string | null;
  pendingPlan?: Record<string, unknown> | null;
  requestId?: string | null;
  surface?: 'chat' | 'workflow';
};
type SharedAgentRuntimeOutput = {
  status: 'completed' | 'confirmation_required' | 'failed';
  message: string;
  markdown: string;
  plan: { intent: string; actions: AgentActionPlan[] };
  passes: Array<{ toolResults: AgentToolExecution[]; plan: { intent: string; actions: AgentActionPlan[] } }>;
  actionResults: AgentToolExecution[];
  files: unknown[];
  logs: string[];
  carryContext: Record<string, unknown>;
  pendingPlan?: Record<string, unknown> | null;
};

export const executeBackendAgentTool = async (input: {
  action: AgentActionPlan;
  tool: AgentToolSpec;
  context: WorkflowNodeHandlerContext;
  previousResults?: AgentToolExecution[];
}): Promise<AgentToolExecution> => {
  const startedAt = Date.now();
  const request = input.context.requestContext.request as unknown as Record<string, unknown>;
  const payload = record(input.action.input);
  if (!request.userId && text(input.context.requestContext.userId)) request.userId = input.context.requestContext.userId;
  return EntityRequestContext.fromRequest({ request, supabase: input.context.requestContext.supabase }, async () =>
    withEntityRequestContext(toolResolverContext(input.context, 'workflow.agent.execute_backend_tool', payload), payload, async () => {
      const result = await executeBackendAgentCommand({
        tool: input.tool,
        operation: text(payload.operation || payload.action),
        input: payload,
        context: { previousResults: input.previousResults || [], surface: record(payload).surface || 'workflow' },
      });
      return toExecution(input.action, result, startedAt);
    }),
  );
};

export const executeSharedAgentRuntime = async (
  context: WorkflowNodeHandlerContext,
  input: SharedAgentRuntimeInput & { tools?: AgentToolSpec[] },
): Promise<SharedAgentRuntimeOutput> => {
  const request = context.requestContext.request as unknown as Record<string, unknown>;
  if (!request.userId && text(context.requestContext.userId)) request.userId = context.requestContext.userId;
  return EntityRequestContext.fromRequest({ request, supabase: context.requestContext.supabase }, async () =>
    withEntityRequestContext(toolResolverContext(context, 'workflow.agent.shared_runtime', record(input)), record(input), async () => {
      const runtime = record(input.context).agentId
        ? await runStoredAIAgent({
            agentId: text(record(input.context).agentId),
            message: input.message,
            sessionId: input.requestId || undefined,
            customPrompt: input.systemPrompt || undefined,
          })
        : await runOpenAIAgentsSdkAgent({
            agent: {
              id: input.requestId || null,
              name: 'Workflow Sandbox Agent',
              instructions: input.systemPrompt || 'Use workflow-builder skills and respond with actionable workflow output.',
              runtime_kind: 'openai_agents_sdk_sandbox',
            },
            runtime: {
              agentId: input.requestId || 'workflow-sandbox-agent',
              message: input.message,
              sessionId: input.requestId || undefined,
              customPrompt: text(input.knowledge) || undefined,
            },
          });
      const message = text(runtime.text) || 'Workflow Sandbox Agent completed.';
      return {
        status: 'completed',
        message,
        markdown: message,
        plan: { intent: input.message, actions: [] },
        passes: [],
        actionResults: [],
        files: [],
        logs: ['OpenAI SandboxAgent runtime completed.'],
        carryContext: { runtime },
        pendingPlan: input.pendingPlan || null,
      };
    }),
  );
};

export const toWorkflowNodeHandlerResult = (output: SharedAgentRuntimeOutput): WorkflowNodeHandlerResult => ({
  output: {
    markdown: output.markdown,
    text: output.message,
    status: output.status,
    plan: output.plan,
    action_results: output.actionResults,
    passes: output.passes,
    files: output.files,
    logs: output.logs,
    carryContext: output.carryContext,
    pendingPlan: output.pendingPlan || null,
  },
  status:
    output.status === 'failed'
      ? WorkflowNodeStatusEnum.Failed
      : output.status === 'confirmation_required'
      ? WorkflowNodeStatusEnum.Warning
      : WorkflowNodeStatusEnum.Passed,
  logs: output.logs,
  skipCommandPeerAutoRun: true,
});
