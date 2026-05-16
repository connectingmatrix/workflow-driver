import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Executor } from '@workflow/executor';
import { GigaORM } from '@connectingmatrix/orm/orm';
import { WorkflowWebhookController } from '@giga/general/controllers/runtime/workflow-webhook.controller';
import { WorkflowEntity, WorkflowExecutionEntity } from '@connectingmatrix/orm/repositories/entities';
import { ensureEntityOrmInstalled } from '@connectingmatrix/orm/services/graphql/entity-request-context';
import { closeWorkflowQueueRequestProducer } from '../../../../src/services/workflow/queue/write/publishWorkflowQueueRequest';
import {
  consumeBackendWorkflowExecutionEvents,
  runBackendWorkflowExecutionQueue,
} from '../../../../src/services/workflow/queue/write/setupWorkflowQueue';
import { buildExecutableWebhookWorkflow } from './workflow-webhook-live.workflow.fixture';
import {
  createLiveQueueTestEnvironment,
  createMockExpressRequest,
  createMockExpressResponse,
  createWorkflowSocketServerRecorder,
  deleteLiveQueueTopics,
  ensureLiveQueueTopics,
  waitForCondition,
} from './workflow-webhook-live.runtime.fixture';

const controller = new WorkflowWebhookController();
const workflowIds = new Set<string>();
const executionIds = new Set<string>();
const liveSuffix = randomUUID().slice(0, 8);
const queueConfig = createLiveQueueTestEnvironment(liveSuffix);
const worker = runBackendWorkflowExecutionQueue();
const resultConsumer = consumeBackendWorkflowExecutionEvents();
const socketRecorder = createWorkflowSocketServerRecorder();
const offHandlers: Array<() => void> = [];
const runAsRoot = <T>(operation: () => Promise<T>) =>
  GigaORM.run({ caller: { id: 'workflow-live-test', type: 'root' }, scope: { type: 'global', id: 'ROOT' } }, operation);

const createPublishedWorkflowRecord = async (params: { workflowId: string; secret: string; waitSeconds: number }) => {
  const workflow = buildExecutableWebhookWorkflow({
    workflowId: params.workflowId,
    waitSeconds: params.waitSeconds,
  });
  const now = new Date().toISOString();
  const row = {
    id: params.workflowId,
    user_id: null,
    organization_id: null,
    is_global: true,
    is_org_default: null,
    name: `Live Queue ${params.workflowId}`,
    description: 'Live workflow queue integration test.',
    metadata: {},
    workflow,
    published_workflow: workflow,
    published_at: now,
    search_text: `Live Queue ${params.workflowId}`,
    status: 'published',
    webhook_secret: params.secret,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
  await runAsRoot(() => WorkflowEntity.create(row));
  workflowIds.add(params.workflowId);
};

const deleteCreatedRows = async () => {
  await runAsRoot(async () => {
    if (executionIds.size > 0) {
      await WorkflowExecutionEntity.deleteByIds(Array.from(executionIds));
      executionIds.clear();
    }

    if (workflowIds.size > 0) {
      await WorkflowExecutionEntity.deleteByWorkflowIds(Array.from(workflowIds));
    }

    if (workflowIds.size > 0) {
      for (const workflowId of workflowIds) {
        await WorkflowEntity.deleteById(workflowId);
      }
      workflowIds.clear();
    }
  });
};

const submitAsyncPublished = async (params: { workflowId: string; secret: string; body: unknown }) => {
  const request = createMockExpressRequest({
    method: 'POST',
    path: `/api/v2/workflows/${params.workflowId}/webhook/published/async`,
    secret: params.secret,
    body: params.body,
  });
  const response = createMockExpressResponse();
  await runAsRoot(() => controller.postPublishedAsync(params.workflowId, request as any, response as any));
  return response;
};

const getExecutionStatus = async (params: { workflowId: string; secret: string; executionId: string }) => {
  const request = createMockExpressRequest({
    method: 'GET',
    path: `/api/v2/workflows/${params.workflowId}/webhook/executions/${params.executionId}`,
    secret: params.secret,
  });
  const response = createMockExpressResponse();
  await runAsRoot(() => controller.getPublishedExecutionStatus(params.workflowId, params.executionId, request as any, response as any));
  return response;
};

const submitBlockingPublished = async (params: { workflowId: string; secret: string; body: unknown }) => {
  const request = createMockExpressRequest({
    method: 'POST',
    path: `/api/v2/workflows/${params.workflowId}/webhook/published`,
    secret: params.secret,
    body: params.body,
  });
  const response = createMockExpressResponse();
  await runAsRoot(() => controller.postPublished(params.workflowId, request as any, response as any));
  return response;
};

before(async () => {
  await ensureEntityOrmInstalled();
  await ensureLiveQueueTopics(queueConfig);
  offHandlers.push(
    Executor.on('workflow:catalog:status', (event) =>
      socketRecorder.emissions.push({ event: event.eventName, payload: event.payload, room: event.roomName }),
    ),
  );
  offHandlers.push(
    Executor.on('workflow:execution:update', (event) =>
      socketRecorder.emissions.push({ event: event.eventName, payload: event.payload, room: event.roomName }),
    ),
  );
  offHandlers.push(
    Executor.on('workflow:event', (event) => socketRecorder.emissions.push({ event: event.eventName, payload: event.payload, room: event.roomName })),
  );
  await worker.start();
  await resultConsumer.start();
});

after(async () => {
  await closeWorkflowQueueRequestProducer();
  await resultConsumer.stop({ force: true });
  await worker.stop({ force: true });
  await deleteCreatedRows();
  await deleteLiveQueueTopics(queueConfig);
  offHandlers.splice(0).forEach((off) => off());
});

test('published async webhook returns created immediately and status route reports queued, running, and completed states', async () => {
  const workflowId = randomUUID();
  const webhookSecret = `secret-${randomUUID()}`;
  await createPublishedWorkflowRecord({
    workflowId,
    secret: webhookSecret,
    waitSeconds: 2,
  });

  const firstResponse = await submitAsyncPublished({
    workflowId,
    secret: webhookSecret,
    body: { label: 'first' },
  });
  const secondResponse = await submitAsyncPublished({
    workflowId,
    secret: webhookSecret,
    body: { label: 'second' },
  });
  const thirdResponse = await submitAsyncPublished({
    workflowId,
    secret: webhookSecret,
    body: { label: 'third' },
  });

  assert.equal(firstResponse.statusCode, 202);
  assert.equal(secondResponse.statusCode, 202);
  assert.equal(thirdResponse.statusCode, 202);
  assert.equal((firstResponse.jsonBody as any)?.status, 'created');

  const firstExecutionId = String((firstResponse.jsonBody as any)?.executionId || '');
  const secondExecutionId = String((secondResponse.jsonBody as any)?.executionId || '');
  const thirdExecutionId = String((thirdResponse.jsonBody as any)?.executionId || '');
  executionIds.add(firstExecutionId);
  executionIds.add(secondExecutionId);
  executionIds.add(thirdExecutionId);

  const initialQueuedStatus = await getExecutionStatus({
    workflowId,
    secret: webhookSecret,
    executionId: thirdExecutionId,
  });
  assert.equal(initialQueuedStatus.statusCode, 200);
  assert.equal((initialQueuedStatus.jsonBody as any)?.status, 'queued');
  assert.equal((initialQueuedStatus.jsonBody as any)?.executionTime, 0);

  await waitForCondition(async () => {
    const statusResponse = await getExecutionStatus({
      workflowId,
      secret: webhookSecret,
      executionId: firstExecutionId,
    });
    return ['running', 'completed'].includes(String((statusResponse.jsonBody as any)?.status || ''));
  });

  await waitForCondition(
    async () => {
      const statusResponse = await getExecutionStatus({
        workflowId,
        secret: webhookSecret,
        executionId: firstExecutionId,
      });
      return String((statusResponse.jsonBody as any)?.status || '') === 'completed';
    },
    45_000,
    500,
  );

  await waitForCondition(
    async () => {
      const statusResponse = await getExecutionStatus({
        workflowId,
        secret: webhookSecret,
        executionId: thirdExecutionId,
      });
      return String((statusResponse.jsonBody as any)?.status || '') === 'completed';
    },
    45_000,
    500,
  );

  const firstCompleted = await getExecutionStatus({
    workflowId,
    secret: webhookSecret,
    executionId: firstExecutionId,
  });
  const thirdCompleted = await getExecutionStatus({
    workflowId,
    secret: webhookSecret,
    executionId: thirdExecutionId,
  });

  assert.equal((firstCompleted.jsonBody as any)?.status, 'completed');
  assert.equal(typeof (firstCompleted.jsonBody as any)?.timeElapsed, 'number');
  assert.equal(typeof (firstCompleted.jsonBody as any)?.executionTime, 'number');
  assert.equal((thirdCompleted.jsonBody as any)?.status, 'completed');
  assert.equal((thirdCompleted.jsonBody as any)?.output?.request?.body?.label, 'third');
  assert.equal(typeof (thirdCompleted.jsonBody as any)?.output?.wait?.applied?.elapsedMilliseconds, 'number');
});

test('published blocking webhook still returns the final workflow output after queue execution completes', async () => {
  const workflowId = randomUUID();
  const webhookSecret = `secret-${randomUUID()}`;
  await createPublishedWorkflowRecord({
    workflowId,
    secret: webhookSecret,
    waitSeconds: 1,
  });

  const response = await submitBlockingPublished({
    workflowId,
    secret: webhookSecret,
    body: { label: 'blocking' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal((response.jsonBody as any)?.accepted, true);
  assert.equal((response.jsonBody as any)?.route_type, 'published');
  assert.equal((response.jsonBody as any)?.output?.request?.body?.label, 'blocking');
  assert.equal(typeof (response.jsonBody as any)?.output?.wait?.applied?.elapsedMilliseconds, 'number');
});
