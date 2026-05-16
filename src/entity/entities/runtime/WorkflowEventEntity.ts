import { ENTITY, FIELD, PERMISSIONS, Entity } from '@connectingmatrix/orm/orm';

export type WorkflowEventRow = {
  id: string;
  workflow_execution_id: string;
  event_type: string;
  event_payload?: Record<string, unknown> | null;
  created_at?: string | null;
};

@ENTITY({ table: 'ai_workflow_events', label: 'WorkflowEvent', store: 'supabase', primaryKey: 'id' })
@PERMISSIONS({ read: 'WORKFLOW_EVENT_READ', list: 'WORKFLOW_EVENT_LIST', create: 'WORKFLOW_EVENT_CREATE' })
export class WorkflowEventEntity extends Entity<WorkflowEventRow> {
  @FIELD({ type: 'string', required: true, index: true }) public declare id: string | null;

  @FIELD({ type: 'string', required: true, index: true }) public declare workflow_execution_id: string | null;

  @FIELD({ type: 'string', required: true }) public declare event_type: string | null;

  @FIELD({ type: 'object', column: 'payload', default: {} }) public declare event_payload: Record<string, unknown> | null;

  @FIELD({ type: 'string' }) public declare created_at: string | null;
}
