CREATE TABLE IF NOT EXISTS public.ai_workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_execution_id uuid NOT NULL REFERENCES public.ai_workflow_executions (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_workflow_events_execution_id_created_at_idx
  ON public.ai_workflow_events (workflow_execution_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_workflow_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_execution_id uuid NOT NULL REFERENCES public.ai_workflow_executions (id) ON DELETE CASCADE,
  level text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_workflow_logs_execution_id_created_at_idx
  ON public.ai_workflow_logs (workflow_execution_id, created_at DESC);
