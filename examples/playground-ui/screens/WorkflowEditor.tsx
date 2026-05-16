import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { DesignerDialog } from '@workflow/ui';
import type { WorkflowDefinition, WorkflowRunLogEvent } from '@workflow/ui/workflow/types';
import { loadWorkflow } from '@giga/dataloader/client/legacy/dataloaders';
import { emptyNodeCatalog, emptyWorkflow, workflowFromRecord, workflowUiDriver } from '@/workflow/workflow-ui-driver';
import { useUiDataContext } from '../contexts/AuthSessionContext';
import { useToast } from '../components/Toast';

const executionLogs = (executionId: string | null): WorkflowRunLogEvent[] => {
  if (!executionId) return [];
  return [{ timestamp: new Date().toISOString(), level: 'info', event: 'execution.loaded', workflowId: '', runId: executionId, message: `Loaded execution ${executionId}` }];
};

export default function WorkflowEditor() {
  const context = useUiDataContext();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const workflowId = searchParams.get('id');
  const executionId = searchParams.get('executionId');
  const readonly = searchParams.get('mode') === 'readonly';
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(workflowId ? null : emptyWorkflow());
  const driver = useMemo(() => workflowUiDriver(context), [context]);
  const nodeCatalog = useMemo(() => emptyNodeCatalog(), []);

  useEffect(() => {
    if (!workflowId) return;
    let active = true;
    loadWorkflow(context, workflowId)
      .then((record) => active && setWorkflow(workflowFromRecord(record)))
      .catch((error) => showToast('error', error instanceof Error ? error.message : 'Workflow could not be loaded.'));
    return () => {
      active = false;
    };
  }, [context, workflowId, showToast]);

  return (
    <div className="h-full bg-background">
      <DesignerDialog
        visible
        workflow={workflow}
        driver={driver}
        nodeCatalog={nodeCatalog}
        mode={readonly ? 'execution' : 'design'}
        initialEditable={!readonly}
        executionRunId={executionId}
        executionWorkflowId={workflowId}
        executionLogs={executionLogs(executionId)}
        onHide={() => navigate('/workflows')}
        onWorkflowChange={setWorkflow}
      />
    </div>
  );
}
