import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createNodeExecutorSignature } from '@workflow/executor';

const toBase64 = (source: string): string => Buffer.from(source, 'utf8').toString('base64');

const loadWorkerSource = (modelId: string): string => {
  const workerPath = resolve(process.cwd(), '..', 'workflow-nodes', 'src', 'nodes', modelId, 'worker.ts');
  return readFileSync(workerPath, 'utf8');
};

const buildExecutableNodePayload = (modelIds: string[]) =>
  modelIds.reduce<{ NODE_EXECUTORS: Record<string, string>; NODE_EXECUTOR_SIGNATURES: Record<string, string> }>(
    (acc, modelId) => {
      const workerSource = loadWorkerSource(modelId);
      acc.NODE_EXECUTORS[modelId] = toBase64(workerSource);
      acc.NODE_EXECUTOR_SIGNATURES[modelId] = createNodeExecutorSignature(modelId, workerSource);
      return acc;
    },
    {
      NODE_EXECUTORS: {},
      NODE_EXECUTOR_SIGNATURES: {},
    },
  );

export const buildExecutableWebhookWorkflow = (params: { workflowId: string; waitSeconds: number }) => {
  const nodeExecutors = buildExecutableNodePayload(['start', 'wait', 'merge', 'respond-end']);

  return {
    metadata: {
      id: params.workflowId,
      name: `Live Queue ${params.workflowId}`,
      runtime: {
        settings: {
          graphqlUrl: 'http://localhost:3001/api/v2/graphql',
          httpBaseUrl: 'http://localhost:3001/api/v2',
          authMode: 'auto-from-current-session',
          manualHeaders: {},
          maxExecutionSeconds: 300,
        },
      },
    },
    nodeModels: {
      start: {
        id: 'start',
        outputs: {
          output: { allowMultipleArrows: true },
        },
      },
      wait: {
        id: 'wait',
        inputs: {
          input: { allowMultipleArrows: true },
        },
        outputs: {
          output: { allowMultipleArrows: true },
        },
      },
      merge: {
        id: 'merge',
        inputs: {
          input1: { allowMultipleArrows: true },
          input2: { allowMultipleArrows: true },
        },
        outputs: {
          output: { allowMultipleArrows: true },
        },
      },
      'respond-end': {
        id: 'respond-end',
        inputs: {
          input: { allowMultipleArrows: true },
        },
        outputs: {
          output: { allowMultipleArrows: true },
        },
      },
    },
    nodes: [
      {
        id: 'start-1',
        gigaId: 'StartNode',
        modelId: 'start',
        type: 'workflowStep',
        name: 'Start 1',
        description: 'Webhook start.',
        kind: 'process',
        status: 'stopped',
        position: { x: 0, y: 0 },
        runtime: {
          triggerSource: 'webhook',
          webhookMethod: 'POST',
        },
        ports: { in: { input: {} }, out: {} },
      },
      {
        id: 'wait-1',
        gigaId: 'WaitNode',
        modelId: 'wait',
        type: 'workflowStep',
        name: 'Wait 1',
        description: 'Wait node.',
        kind: 'process',
        status: 'stopped',
        position: { x: 260, y: 0 },
        runtime: {
          time: params.waitSeconds,
          unit: 'seconds',
          value: '{{start-1}}',
        },
        ports: { in: {}, out: {} },
      },
      {
        id: 'respond-end-1',
        gigaId: 'RespondEndNode',
        modelId: 'respond-end',
        type: 'workflowStep',
        name: 'Respond / End 1',
        description: 'End node.',
        kind: 'output',
        status: 'stopped',
        position: { x: 520, y: 0 },
        runtime: {
          response: '{{merge-1}}',
        },
        ports: { in: {}, out: {} },
      },
      {
        id: 'merge-1',
        gigaId: 'MergeNode',
        modelId: 'merge',
        type: 'workflowStep',
        name: 'Merge 1',
        description: 'Merge start payload with wait metadata.',
        kind: 'process',
        status: 'stopped',
        position: { x: 520, y: 0 },
        runtime: {
          input1Value: '{{start-1}}',
          input2Value: '{{wait-1}}',
        },
        ports: { in: {}, out: {} },
      },
    ],
    connections: [
      {
        id: 'connection-start-wait',
        name: 'start->wait',
        from: 'start-1',
        to: 'wait-1',
        sourceHandle: 'out:output',
        targetHandle: 'in:input',
      },
      {
        id: 'connection-start-merge',
        name: 'start->merge',
        from: 'start-1',
        to: 'merge-1',
        sourceHandle: 'out:output',
        targetHandle: 'in:input1',
      },
      {
        id: 'connection-wait-merge',
        name: 'wait->merge',
        from: 'wait-1',
        to: 'merge-1',
        sourceHandle: 'out:output',
        targetHandle: 'in:input2',
      },
      {
        id: 'connection-merge-end',
        name: 'merge->respond-end',
        from: 'merge-1',
        to: 'respond-end-1',
        sourceHandle: 'out:output',
        targetHandle: 'in:input',
      },
    ],
    ...nodeExecutors,
  };
};
