ALTER TABLE public.ai_workflow_executions
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS input_payload jsonb,
  ADD COLUMN IF NOT EXISTS output_payload jsonb,
  ADD COLUMN IF NOT EXISTS error_payload jsonb;

CREATE INDEX IF NOT EXISTS ai_workflow_executions_started_at_idx
  ON public.ai_workflow_executions (started_at DESC);
