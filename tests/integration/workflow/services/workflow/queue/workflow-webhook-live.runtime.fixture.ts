import { EventEmitter } from 'node:events';
import { Kafka, logLevel } from 'kafkajs';

const queueTestBrokers = process.env.WORKFLOW_QUEUE_TEST_BROKERS || 'localhost:19092,localhost:29092,localhost:39092';

const createQueueKafkaClient = () =>
  new Kafka({
    clientId: process.env.WORKFLOW_QUEUE_CLIENT_ID || 'workflow-queue-live-test',
    brokers: (process.env.WORKFLOW_QUEUE_BROKERS || queueTestBrokers)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    logLevel: logLevel.NOTHING,
  });

export const createLiveQueueTestEnvironment = (suffix: string) => {
  process.env.WORKFLOW_QUEUE_CLIENT_ID = `workflow-queue-live-${suffix}`;
  process.env.WORKFLOW_QUEUE_BROKERS = queueTestBrokers;
  process.env.WORKFLOW_QUEUE_SSL = 'false';
  process.env.WORKFLOW_QUEUE_USERNAME = '';
  process.env.WORKFLOW_QUEUE_PASSWORD = '';
  process.env.WORKFLOW_QUEUE_REQUEST_TOPIC = `workflow-execution-requests-live-${suffix}`;
  process.env.WORKFLOW_QUEUE_EVENTS_TOPIC = `workflow-execution-events-live-${suffix}`;
  process.env.WORKFLOW_QUEUE_REQUEST_CONSUMER_GROUP_ID = `workflow-queue-worker-live-${suffix}`;
  process.env.WORKFLOW_QUEUE_EVENT_CONSUMER_GROUP_ID = `workflow-queue-events-live-${suffix}`;
  return {
    eventsTopic: process.env.WORKFLOW_QUEUE_EVENTS_TOPIC,
    requestTopic: process.env.WORKFLOW_QUEUE_REQUEST_TOPIC,
  };
};

export const ensureLiveQueueTopics = async (config: { eventsTopic?: string; requestTopic?: string }) => {
  const kafka = createQueueKafkaClient();
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({
      waitForLeaders: true,
      topics: [
        { topic: config.requestTopic, numPartitions: 3, replicationFactor: 1 },
        { topic: config.eventsTopic, numPartitions: 3, replicationFactor: 1 },
      ],
    });
  } finally {
    await admin.disconnect();
  }
};

export const deleteLiveQueueTopics = async (config: { eventsTopic?: string; requestTopic?: string }) => {
  const kafka = createQueueKafkaClient();
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.deleteTopics({
      topics: [config.requestTopic, config.eventsTopic],
    });
  } catch {
    // Ignore cleanup errors in local integration teardown.
  } finally {
    await admin.disconnect();
  }
};

export const createMockExpressRequest = (params: {
  method?: 'GET' | 'POST';
  path: string;
  secret: string;
  body?: unknown;
  query?: Record<string, unknown>;
}) => {
  const request = new EventEmitter() as EventEmitter & Record<string, unknown>;
  request.method = params.method || 'POST';
  request.originalUrl = params.path;
  request.path = params.path;
  request.protocol = 'http';
  request.query = params.query || {};
  request.body = typeof params.body === 'undefined' ? null : params.body;
  request.headers = {
    host: 'localhost:3001',
    origin: 'http://localhost:3001',
    'x-workflow-secret': params.secret,
  };
  return request;
};

export const createMockExpressResponse = () => {
  const response = new EventEmitter() as EventEmitter & {
    statusCode: number;
    jsonBody: unknown;
    writableEnded: boolean;
    status: (code: number) => any;
    json: (body: unknown) => any;
  };
  response.statusCode = 200;
  response.jsonBody = null;
  response.writableEnded = false;
  response.status = (code: number) => {
    response.statusCode = code;
    return response;
  };
  response.json = (body: unknown) => {
    response.jsonBody = body;
    response.writableEnded = true;
    return response;
  };
  return response;
};

export const waitForCondition = async (predicate: () => Promise<boolean>, timeoutMs = 30_000, intervalMs = 250): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition.`);
};

export const createWorkflowSocketServerRecorder = () => {
  const emissions: Array<{ room: string; event: string; payload: unknown }> = [];
  return {
    server: {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => {
          emissions.push({ room, event, payload });
        },
      }),
    },
    emissions,
  };
};
