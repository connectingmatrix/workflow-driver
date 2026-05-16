import { Request } from 'express';
import { cloneJson, toSafeString } from 'giga-ai-helper';
import { OrganisationEntity, WorkflowEntity } from '@connectingmatrix/orm/repositories/entities';
import { EnvLoader } from '@giga/shared/lib/env';
import { normalizeWorkflowSnapshotIdentity } from '@connectingmatrix/workflow-driver/services/workflow/runtime/workflow-identity';
import { WorkflowAuthModeEnum, WorkflowDefinition, WorkflowRuntimeSettings } from '@connectingmatrix/workflow-driver/services/workflow/contracts/types';
import type { PersistedWorkflowRecord, WorkflowRecordScope, WorkflowWebhookRequestPayload } from '@giga/shared/types/contracts/workflow.types';

export type { PersistedWorkflowRecord, WorkflowWebhookRequestPayload } from '@giga/shared/types/contracts/workflow.types';

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function normalizeHeaders(headers: Request['headers']): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    next[key.toLowerCase()] = value;
  });
  return next;
}

const flattenStartEnvelope = (value: unknown): unknown => {
  const record = toRecord(value);
  if (!Object.keys(record).length || Object.prototype.hasOwnProperty.call(record, 'request')) {
    return value;
  }

  const nestedStartEntry = Object.entries(record).find(([, entry]) => {
    const nested = toRecord(entry);
    return Object.prototype.hasOwnProperty.call(nested, 'request') && Object.prototype.hasOwnProperty.call(nested, 'input');
  });

  if (!nestedStartEntry) {
    return value;
  }

  const [, nestedStartValue] = nestedStartEntry;
  const nestedStartRecord = toRecord(nestedStartValue);

  return {
    ...record,
    ...Object.fromEntries(
      Object.entries(nestedStartRecord).filter(([key]) => key === 'request' || key === 'input' || key === 'started' || key === 'startedAt'),
    ),
  };
};

function resolveBaseUrl(request: Request): string {
  const origin = String(request.headers?.origin || '').trim();
  if (origin) return origin.replace(/\/+$/g, '');

  const host = String(request.headers?.['x-forwarded-host'] || request.headers?.host || '').trim();
  if (!host) {
    return String(EnvLoader.get('BASE_URL') || 'http://localhost:4000').replace(/\/+$/g, '');
  }

  const protocol =
    String(
      request.headers?.['x-forwarded-proto'] || request.protocol || (String(request.headers?.origin || '').startsWith('https://') ? 'https' : 'http'),
    ).trim() || 'http';

  return `${protocol}://${host}`.replace(/\/+$/g, '');
}

export function resolveWorkflowRuntimeSettings(
  request: Request,
  workflow: WorkflowDefinition,
  runtimeLimits?: { maxConcurrentExecutionsPerUser?: number; maxExecutionSeconds?: number },
): WorkflowRuntimeSettings {
  const metadataSettings =
    workflow?.metadata?.runtime?.settings && typeof workflow.metadata.runtime.settings === 'object'
      ? (workflow.metadata.runtime.settings as Partial<WorkflowRuntimeSettings>)
      : {};
  const baseUrl = resolveBaseUrl(request);

  return {
    graphqlUrl: String(metadataSettings.graphqlUrl || '').trim() || `${baseUrl}/api/v2/graphql`,
    httpBaseUrl: String(metadataSettings.httpBaseUrl || '').trim() || baseUrl,
    authMode: metadataSettings.authMode || WorkflowAuthModeEnum.AutoFromCurrentSession,
    manualHeaders: metadataSettings.manualHeaders || {},
    maxConcurrentExecutionsPerUser: Number(runtimeLimits?.maxConcurrentExecutionsPerUser) || undefined,
    maxExecutionSeconds: Math.min(
      Number(metadataSettings.maxExecutionSeconds) || Number(runtimeLimits?.maxExecutionSeconds) || 300,
      Number(runtimeLimits?.maxExecutionSeconds) || 300,
    ),
  };
}

export function buildWorkflowWebhookRequest(request: Request, routeType: 'test' | 'published'): WorkflowWebhookRequestPayload {
  return {
    method: String(request.method || '')
      .trim()
      .toUpperCase(),
    headers: normalizeHeaders(request.headers),
    query: toRecord(request.query),
    body: typeof request.body === 'undefined' ? null : request.body,
    path: String(request.originalUrl || request.path || '').trim(),
    routeType,
  };
}

export function requiresWorkflowWebhookSecret(routeType: 'test' | 'published'): boolean {
  return routeType === 'published';
}

export function resolveStartNodeWebhookConfig(workflow: WorkflowDefinition): {
  enabled: boolean;
  method: 'GET' | 'POST' | null;
} {
  const startNode = Array.isArray(workflow?.nodes) ? workflow.nodes.find((node) => node.modelId === 'start') : null;
  const runtime = toRecord(startNode?.runtime);
  const triggerSource = toSafeString(runtime.triggerSource).toLowerCase();
  const method = toSafeString(runtime.webhookMethod).toUpperCase();

  return {
    enabled: triggerSource === 'webhook' && (method === 'GET' || method === 'POST'),
    method: method === 'GET' || method === 'POST' ? (method as 'GET' | 'POST') : null,
  };
}

export function validateWorkflowWebhookInvocation(
  workflow: WorkflowDefinition,
  method: string,
): { ok: true } | { ok: false; status: number; error: string } {
  const config = resolveStartNodeWebhookConfig(workflow);
  if (!config.enabled) {
    return {
      ok: false,
      status: 404,
      error: 'Webhook execution is not enabled on the Start node.',
    };
  }

  if (
    !config.method ||
    config.method !==
      String(method || '')
        .trim()
        .toUpperCase()
  ) {
    return {
      ok: false,
      status: 405,
      error: 'Webhook method does not match the Start node configuration.',
    };
  }

  return { ok: true };
}

export function applyWebhookRequestToWorkflow(workflow: WorkflowDefinition, requestPayload: WorkflowWebhookRequestPayload): WorkflowDefinition {
  const nextWorkflow = cloneJson(workflow);
  const timestamp = new Date().toISOString();
  const requestRecord = requestPayload as unknown as Record<string, unknown>;

  nextWorkflow.input = requestRecord as any;
  nextWorkflow.metadata = {
    ...(nextWorkflow.metadata || { id: '', name: 'Workflow' }),
    webhook: {
      ...toRecord(nextWorkflow.metadata?.webhook),
      lastInvocation: requestPayload,
    },
  } as WorkflowDefinition['metadata'];

  nextWorkflow.nodes = (nextWorkflow.nodes || []).map((node) => {
    if (node.modelId !== 'start') {
      return node;
    }

    const runtime = {
      ...toRecord(node.runtime),
      source: 'webhook',
      timestamp,
    };

    const ports = {
      in: {
        ...toRecord(node.ports?.in),
        input: requestRecord,
      },
      out: toRecord(node.ports?.out),
    };

    return {
      ...node,
      runtime,
      properties: runtime,
      input: {
        input: requestRecord,
      },
      inspector: node.inspector
        ? {
            ...node.inspector,
            input: {
              input: requestRecord,
            },
            properties: {
              ...toRecord(node.inspector.properties),
              source: 'webhook',
              timestamp,
            },
          }
        : node.inspector,
      ports,
    };
  });

  return nextWorkflow;
}

export function extractWorkflowTerminalPayload(workflow: WorkflowDefinition): unknown {
  const endNodes = (workflow.nodes || []).filter((node) => node.modelId === 'respond-end');
  const endNode = endNodes[endNodes.length - 1];
  const output =
    endNode?.ports?.out && Object.prototype.hasOwnProperty.call(endNode.ports.out, 'output') ? endNode.ports.out.output : endNode?.output;

  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    const payloadKeys = Object.keys(record).filter((key) => key !== '__workflow');
    if (payloadKeys.length === 1 && payloadKeys[0] === 'input') {
      return record.input;
    }
  }

  return flattenStartEnvelope(output);
}

export async function loadPersistedWorkflowRecord(supabase: any, workflowId: string): Promise<PersistedWorkflowRecord | null> {
  const workflowRow = await WorkflowEntity.readActiveRowById(workflowId);
  if (!workflowRow?.id) {
    return null;
  }

  const organizationId = toSafeString(workflowRow.organization_id) || null;
  if (organizationId && !(await OrganisationEntity.isActive(organizationId))) {
    return null;
  }
  const scope: WorkflowRecordScope = workflowRow.is_global === true ? 'default' : organizationId ? 'organization' : 'user';

  return {
    id: String(workflowRow.id),
    scope,
    tableName: 'ai_workflows',
    userId: toSafeString(workflowRow.user_id) || null,
    organizationId,
    name: toSafeString(workflowRow.name) || 'Workflow',
    description: toSafeString(workflowRow.description),
    workflow: normalizeWorkflowSnapshotIdentity({
      workflow: (workflowRow.workflow || null) as WorkflowDefinition,
      workflowId: String(workflowRow.id),
      workflowName: toSafeString(workflowRow.name) || 'Workflow',
      workflowDescription: toSafeString(workflowRow.description),
      workflowScope: scope === 'default' ? 'global' : scope,
    }) as WorkflowDefinition,
    publishedWorkflow: normalizeWorkflowSnapshotIdentity({
      workflow: (workflowRow.published_workflow || null) as WorkflowDefinition | null,
      workflowId: String(workflowRow.id),
      workflowName: toSafeString(workflowRow.name) || 'Workflow',
      workflowDescription: toSafeString(workflowRow.description),
      workflowScope: scope === 'default' ? 'global' : scope,
    }),
    status: toSafeString(workflowRow.status).toLowerCase() === 'published' ? 'published' : 'draft',
    webhookSecret: toSafeString((workflowRow as Record<string, unknown>).webhook_secret),
    isActive: workflowRow.is_active !== false,
  };
}

export function resolveExecutionWorkflow(record: PersistedWorkflowRecord, routeType: 'test' | 'published'): WorkflowDefinition | null {
  if (routeType === 'published') {
    if (record.status !== 'published' || !record.publishedWorkflow) return null;
    return cloneJson(record.publishedWorkflow as WorkflowDefinition);
  }

  return cloneJson(record.workflow);
}

export function verifyWorkflowSecret(record: PersistedWorkflowRecord, providedSecret: string | null | undefined): boolean {
  return toSafeString(record.webhookSecret) === toSafeString(providedSecret);
}
