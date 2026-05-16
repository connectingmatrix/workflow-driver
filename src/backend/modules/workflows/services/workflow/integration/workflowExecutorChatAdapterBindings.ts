export const executeWorkflowChatAdapterAction = async (name: string, runtime: unknown, input?: Record<string, unknown>) => {
  if (name === 'fetch_all_workflows')
    return (await import('@connectingmatrix/chat/services/chat/actions/read/workflow-read')).runFetchAllWorkflows(runtime as any, input as any) as any;
  if (name === 'fetch_workflow')
    return (await import('@connectingmatrix/chat/services/chat/actions/read/workflow-read')).runFetchWorkflow(runtime as any, input as any) as any;
  if (name === 'fetch_workflow_runs')
    return (await import('@connectingmatrix/chat/services/chat/actions/read/workflow-history-read')).runFetchWorkflowRuns(runtime as any, input as any) as any;
  if (name === 'fetch_workflow_revisions')
    return (await import('@connectingmatrix/chat/services/chat/actions/read/workflow-history-read')).runFetchWorkflowRevisions(
      runtime as any,
      input as any,
    ) as any;
  if (name === 'create_workflow_from_cypher')
    return (await import('@connectingmatrix/chat/services/chat/actions/runtime/workflow-cypher')).runCreateWorkflowFromCypher(
      runtime as any,
      input as any,
    ) as any;
  if (name === 'update_workflow_from_cypher')
    return (await import('@connectingmatrix/chat/services/chat/actions/write/workflow-cypher-update')).runUpdateWorkflowFromCypher(
      runtime as any,
      input as any,
    ) as any;
  if (name === 'create_workflow' || name === 'update_workflow' || name === 'delete_workflow') {
    const workflow = await import('@connectingmatrix/chat/services/chat/actions/runtime/workflow');
    if (name === 'create_workflow') return workflow.runCreateWorkflow(runtime as any, input as any) as any;
    if (name === 'update_workflow') return workflow.runUpdateWorkflow(runtime as any, input as any) as any;
    return workflow.runDeleteWorkflow(runtime as any, input as any) as any;
  }
  if (name === 'execute_workflow' || name === 'get_workflow_output') {
    const workflow = await import('@connectingmatrix/chat/services/chat/actions/runtime/workflow-execute');
    if (name === 'execute_workflow') return workflow.runExecuteWorkflow(runtime as any, input as any) as any;
    return workflow.runGetWorkflowOutput(runtime as any, input as any) as any;
  }
  throw new Error(`Unsupported workflow chat action ${name}.`);
};
