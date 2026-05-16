import util from 'node:util';
import { Executor } from '@workflow/executor';
import { SupabaseClientAdmin } from '@giga/general/decorators/integration/supabase-admin-client';
import { buildSocketSession } from '@connectingmatrix/sockets/core/build-session.socket';
import { executeWorkflow, executeWorkflowStep } from '@connectingmatrix/nodes/services/workflow/executor';
import {
  closeWorkflowEditorSession,
  closeWorkflowEditorSessionBySocket,
  createPendingWebhookTestRequest,
  getWorkflowEditorSession,
  heartbeatWorkflowEditorSession,
  registerWorkflowEditorSession,
  rejectPendingWebhookTestRequest,
  resolvePendingWebhookTestRequest,
} from '@connectingmatrix/sockets/workflow/editor-presence';
import { createWorkflowReferenceHostContext } from '@connectingmatrix/workflow-driver/services/workflow/contracts/execution-reference';
import { applyWorkflowQueueEvent } from '../queue/write/applyWorkflowQueueEvent';
import { executeQueuedWorkflowRequest } from '../queue/write/executeQueuedWorkflowRequest';
import { executeWorkflowChatAdapterAction } from '../integration/workflowExecutorChatAdapterBindings';
import { createWorkflowExecutorRequestContext } from './workflowExecutorRequestContext';

const record = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

Executor.setup({
  callbacks: {
    chatAdapter: {
      execute: executeWorkflowChatAdapterAction,
    },
    transport: {
      authorize: async (_request, token) => {
        const session = await buildSocketSession(token);
        return { accessToken: session.accessToken, mode: session.mode, userId: session.userId };
      },
      closeEditorSession: ({ connectionId, workflowId }) => closeWorkflowEditorSession({ socketId: connectionId, workflowId }),
      closeEditorSessionByConnection: closeWorkflowEditorSessionBySocket,
      createPendingWebhookTestRequest,
      getWorkflowEditorSession: (workflowId) => {
        const session = getWorkflowEditorSession(workflowId);
        return session ? { connectionId: session.socketId } : null;
      },
      heartbeatEditorSession: ({ connectionId, editable, workflowId }) => {
        const session = heartbeatWorkflowEditorSession({ socketId: connectionId, editable, workflowId });
        return session ? { connectionId: session.socketId } : null;
      },
      readRequestContext: ({ request, session }) => createWorkflowExecutorRequestContext(request, session),
      registerEditorSession: ({ connectionId, editable, userId, workflowId }) => {
        const session = registerWorkflowEditorSession({ socketId: connectionId, editable, userId, workflowId });
        if (!session.accepted) return { accepted: false };
        return { accepted: true, session: { editable: session.session.editable } };
      },
      rejectPendingWebhookTestRequest,
      resolvePendingWebhookTestRequest,
    },
  },
  executeBackend: {
    execute: async (_id, options, workflow, signal) => {
      const result = await executeWorkflow(
        workflow as any,
        {
          hostContext: options.hostContext || createWorkflowReferenceHostContext(options.requestContext as any),
          logger: options.logger,
          onNodeFinish: options.onNodeFinish as any,
          onNodeStart: options.onNodeStart as any,
          requestContext: options.requestContext,
          runId: String(options.runId || '').trim() || undefined,
          settings: options.settings,
          signal,
        } as any,
      );
      return { events: result.logs as any, stopped: result.stopped, workflow: result.workflow as any };
    },
    executeStep: async (_id, options, signal) => {
      const result = await executeWorkflowStep({
        hostContext: options.hostContext || createWorkflowReferenceHostContext(options.requestContext as any),
        logger: options.logger,
        nodeId: options.nodeId,
        onPreviewLogLine: options.onPreviewLogLine as any,
        onPreviewState: options.onPreviewState as any,
        overrides: options.overrides,
        requestContext: options.requestContext as any,
        runId: options.runId,
        settings: options.settings,
        signal,
        workflow: options.workflow as any,
      } as any);
      return { events: [], node: result.node as any, result: result.result as any, workflow: result.workflow as any };
    },
    workflowExecutionQueue: {
      applyExecutionEvent: (event) => applyWorkflowQueueEvent(SupabaseClientAdmin(), event),
      createExecutionRequest: (_id, options) => record(options.request) as any,
      runExecutionRequest: executeQueuedWorkflowRequest,
      handleExecutionEventError: async ({ error, event }) => {
        const message = error instanceof Error ? error.stack || error.message : util.inspect(error, { breakLength: 120, depth: 10 });
        console.error('[workflow-queue-result-consumer] failed to apply event', {
          eventType: event.type,
          executionId: event.executionId,
          runId: event.runId,
          workflowId: event.workflowId,
          message,
        });
      },
    },
  },
});

export {};
