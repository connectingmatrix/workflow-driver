import { executeWorkflowControlOperation } from '../runtime/workflow-control';
import { buildWorkflowDevelopmentProcess } from './runtime/process';
import type { AdvancedAgentToolInput } from '../../contracts';

export const executeWorkflowAgent = async (input: AdvancedAgentToolInput) => {
  if (!input.operation) throw new Error('agent.workflow operation is required.');
  const operation = input.operation.trim().toLowerCase();
  if (operation === 'workflow.process' || operation === 'process' || operation === 'development_process') {
    return buildWorkflowDevelopmentProcess(input);
  }
  return executeWorkflowControlOperation(input);
};

export * from './runtime/compiler';
export * from './telemetry/node-catalog';
export * from './runtime/process';
export * from './contracts/types';
