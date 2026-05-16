import { Executor } from '@workflow/executor';

export type CompiledWorkflowNode = ReturnType<typeof Executor.compileWorkflow>['workflow']['nodes'][number];
export type CompiledWorkflowEdge = ReturnType<typeof Executor.compileWorkflow>['workflow']['edges'][number];
export type CompiledWorkflowDraft = ReturnType<typeof Executor.compileWorkflow>;

export const compileWorkflowFromAgentPrompt = (input: Record<string, unknown>): CompiledWorkflowDraft => Executor.compileWorkflow(input);
