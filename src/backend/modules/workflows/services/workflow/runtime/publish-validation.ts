import { BadRequestError } from 'routing-controllers';
import { createRunId } from 'giga-ai-helper/workflow';
import { Executor } from '@workflow/executor';
import { assertExecutableWorkflow } from './validation';
import type { WorkflowDefinition, WorkflowExecutionRequestContext, WorkflowRuntimeSettings } from '@connectingmatrix/workflows/services/workflow/contracts/types';

const validationRunEnabled = () => String(process.env.WORKFLOW_PUBLISH_VALIDATION_RUN || '1').trim() !== '0';
const validationTimeoutSeconds = () => Math.max(5, Math.min(300, Number(process.env.WORKFLOW_PUBLISH_VALIDATION_SECONDS || 45)));

const settingsForPublishValidation = (settings?: WorkflowRuntimeSettings | null): WorkflowRuntimeSettings => ({
  ...(settings || {}),
  authMode: (settings as any)?.authMode || 'auto-from-current-session',
  graphqlUrl: (settings as any)?.graphqlUrl || process.env.GQL_URL || process.env.GRAPHQL_URL || process.env.VITE_GRAPHQL_API_URL || '',
  maxConcurrentExecutionsPerUser: 1,
  maxExecutionSeconds: validationTimeoutSeconds(),
});

const failedMessages = (events: unknown): string[] => {
  const rows = Array.isArray(events) ? events : [];
  return rows
    .filter((event) => {
      const row = event && typeof event === 'object' ? (event as Record<string, unknown>) : {};
      const status = String(row.status || row.state || '').toLowerCase();
      const level = String(row.level || row.logLevel || '').toLowerCase();
      return status.includes('fail') || status.includes('error') || level === 'error';
    })
    .slice(0, 10)
    .map((event) => {
      const row = event && typeof event === 'object' ? (event as Record<string, unknown>) : {};
      return String(row.message || row.error || row.summary || JSON.stringify(row)).slice(0, 500);
    });
};

export async function validateWorkflowBeforePublish(params: {
  requestContext: WorkflowExecutionRequestContext;
  settings?: WorkflowRuntimeSettings | null;
  workflow: WorkflowDefinition;
}) {
  try {
    assertExecutableWorkflow(params.workflow);
  } catch (error) {
    throw new BadRequestError(`Workflow cannot be published because validation failed: ${error instanceof Error ? error.message : 'Unknown workflow validation error.'}`);
  }
  if (!validationRunEnabled()) return { ran: false, stopped: false, logs: [], runId: null };
  const runId = `publish-validation-${createRunId('run')}`;
  const result = await Executor.execute(
    params.requestContext.userId,
    {
      requestContext: params.requestContext,
      runId,
      settings: settingsForPublishValidation(params.settings || null),
    },
    params.workflow as any,
  );
  const failures = failedMessages((result as any).events);
  if ((result as any).stopped || failures.length) {
    throw new BadRequestError(
      `Workflow cannot be published because the publish validation run failed. ${failures[0] || 'Workflow stopped before completion.'}`,
    );
  }
  return { ran: true, stopped: false, logs: (result as any).events || [], runId };
}
