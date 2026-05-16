import { Executor } from '@workflow/executor';
import { GigaORM } from '@connectingmatrix/orm/orm';
import { getScopedLogger, toErrorMeta } from '@connectingmatrix/logger/lib/logger';
import { forwardWorkflowQueueEventToChatDebug } from '@connectingmatrix/chat/services/chat/workflow/integration/chat-debug-bridge';
import { WorkflowExecutionEntity } from '@connectingmatrix/orm/repositories/entities/runtime/WorkflowExecutionEntity';
import { WorkflowLogEntity } from '@connectingmatrix/orm/repositories/entities/telemetry/WorkflowLogEntity';
import { logger } from '@connectingmatrix/logger/lifecycle-jsonl';
import { emitWorkflowLogEvent } from '@connectingmatrix/sockets/workflow/event-bus';

const scopedLogger = getScopedLogger('workflow-queue-chat-debug');
const loadResponsePayload = async (params: { executionId: string; store: any }) => {
  const current = await WorkflowExecutionEntity.readResponsePayloadRowById(params.executionId);
  return current?.response_payload || null;
};

export const createWorkflowQueueEventApplier = (overrides: Record<string, unknown> = {}) => {
  const applyEvent = Executor.createWorkflowQueueEventApplier({
    emitLogEvent: emitWorkflowLogEvent,
    finalizeRecord: async ({ store: targetStore, ...params }: any) => {
      const currentPayload = await loadResponsePayload({ executionId: params.executionId, store: targetStore }).catch(() => null);
      await WorkflowExecutionEntity.finalize({
        id: params.executionId,
        status: params.status,
        finishedAt: new Date().toISOString(),
        output: Executor.mergeWorkflowQueueTimingPayload(params.responsePayload, currentPayload) as Record<string, unknown>,
        error: params.errorMessage ? { message: params.errorMessage } : null,
      });
    },
    appendLog: async ({ store: targetStore, executionId, log }: any) => {
      if (process.env.GIGA_WORKFLOW_QUEUE_SKIP_LOG_APPEND === '1') return;
      void WorkflowLogEntity.append({
        executionId,
        level: String(log?.level || 'info'),
        message: String(log?.message || log?.event || 'workflow event'),
        data: log || {},
      }).catch((error: any) => {
        scopedLogger.error('workflow.queue.log_append_failed', {
          error: toErrorMeta(error),
          execution_id: executionId,
        });
      });
    },
    loadResponsePayload,
    resolveCompletion: Executor.resolveWorkflowQueueCompletion,
    transitionRecord: async ({ ...params }: any) => {
      await WorkflowExecutionEntity.transition({
        id: params.executionId,
        status: params.status,
        patch: params.extraFields || {},
      });
    },
    ...overrides,
  });

  return async (store: any, event: any) => {
    await GigaORM.run(
      {
        caller: { id: 'workflow-queue', type: 'root' },
        scope: { type: 'global', id: 'ROOT' },
        meta: { supabase: store as Record<string, unknown> },
      },
      async () => {
        if (event?.type === 'started' || event?.type === 'completed' || event?.type === 'failed') {
          const timing = Executor.resolveWorkflowQueueTiming({
            responsePayload: event?.type === 'completed' ? event?.result?.responsePayload : event?.responsePayload,
            completedAt: event?.timestamp,
          });
          // prettier-ignore
          logger.info({ layer: 'workflow.queue', event: 'workflow.backend.execution', phase: event.type === 'started' ? 'start' : 'end', transport: 'workflow_queue', request_id: event.executionId || null, run_id: event.runId || null, status: event.type === 'completed' ? 'passed' : event.type === 'failed' ? 'failed' : 'running', duration_ms: timing.timeElapsed * 1000, since_prev_ms: 0, meta: { queue_time_s: timing.timeElapsed - timing.executionTime, execution_time_s: timing.executionTime, total_time_s: timing.timeElapsed }, });
        }
        await applyEvent(store, event);
        void forwardWorkflowQueueEventToChatDebug({ event, supabase: store }).catch((error: any) => {
          scopedLogger.error('workflow.queue.chat_debug.forward_failed', {
            error: toErrorMeta(error),
            event_type: event?.type,
            execution_id: event?.executionId,
          });
        });
      },
    );
  };
};

export const applyWorkflowQueueEvent = createWorkflowQueueEventApplier();
