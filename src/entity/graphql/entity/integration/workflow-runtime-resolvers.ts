import { executeWorkflowControlOperation } from '@connectingmatrix/ai-agents/services/ai-agents/advanced/runtime/workflow-control';
import { listenWorkflowLiveEvents } from '@connectingmatrix/workflows/services/workflow/agent/runtime/workflow-operation';
import { EntityRequestContext } from '@connectingmatrix/orm/orm/request-entity-context';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string => String(value ?? '').trim();

const withGraphqlEntityContext = async <T>(context: Record<string, unknown>, callback: () => Promise<T>): Promise<T> => {
  if (EntityRequestContext.maybeCurrent()) return callback();
  return EntityRequestContext.fromRequest(
    {
      request: record(context.req || context.request),
      supabase: context.supabase as never,
      requestId: text(context.requestId || context.request_id) || null,
    },
    callback,
  );
};

export const workflowRuntimeResolvers = {
  Query: {
    workflowCatalog: async (_parent: unknown, args: Record<string, unknown>, context: Record<string, unknown>) =>
      withGraphqlEntityContext(context, async () => executeWorkflowControlOperation({ ...record(args.input || args), operation: 'workflow.list' })),
    workflowRunning: async (_parent: unknown, args: Record<string, unknown>, context: Record<string, unknown>) =>
      withGraphqlEntityContext(context, async () =>
        executeWorkflowControlOperation({ ...record(args.input || args), operation: 'workflow.running' }),
      ),
    workflowLogs: async (_parent: unknown, args: Record<string, unknown>, context: Record<string, unknown>) =>
      withGraphqlEntityContext(context, async () => executeWorkflowControlOperation({ ...record(args.input || args), operation: 'workflow.logs' })),
    workflowEvents: async (_parent: unknown, args: Record<string, unknown>, context: Record<string, unknown>) =>
      withGraphqlEntityContext(context, async () => executeWorkflowControlOperation({ ...record(args.input || args), operation: 'workflow.events' })),
  },
  Mutation: {
    executeWorkflowOperation: async (_parent: unknown, args: Record<string, unknown>, context: Record<string, unknown>) =>
      withGraphqlEntityContext(context, async () => executeWorkflowControlOperation(record(args.input || args))),
  },
  Subscription: {
    workflowLiveEvents: {
      subscribe: async (_parent: unknown, args: Record<string, unknown>, context: Record<string, unknown>) =>
        withGraphqlEntityContext(context, async () => {
          const input = record(args.input || args);
          return listenWorkflowLiveEvents(
            {
              workflowId: text(input.workflowId || input.workflow_id),
              executionId: text(input.executionId || input.execution_id),
              runId: text(input.runId || input.run_id),
            },
            { timeoutMs: Number(input.timeoutMs || 0) || null },
          );
        }),
      resolve: (event: unknown) => event,
    },
  },
  WorkflowExecution: {
    logs: async (parent: Record<string, unknown>, args: Record<string, unknown>, context: Record<string, unknown>) =>
      withGraphqlEntityContext(context, async () =>
        executeWorkflowControlOperation({ ...record(args.input || args), operation: 'workflow.logs', executionId: text(parent.id) }),
      ),
    events: async (parent: Record<string, unknown>, args: Record<string, unknown>, context: Record<string, unknown>) =>
      withGraphqlEntityContext(context, async () =>
        executeWorkflowControlOperation({ ...record(args.input || args), operation: 'workflow.events', executionId: text(parent.id) }),
      ),
  },
};
