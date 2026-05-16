do $$
begin
  if to_regclass('public.ai_workflow_nodes') is null and to_regclass('public.ai_workflow_user_nodes') is not null then
    alter table public.ai_workflow_user_nodes rename to ai_workflow_nodes;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_workflow_nodes' and column_name = 'user_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_workflow_nodes' and column_name = 'created_by'
  ) then
    alter table public.ai_workflow_nodes rename column user_id to created_by;
  end if;
end $$;

alter table public.ai_workflow_nodes add column if not exists scope_type text;
alter table public.ai_workflow_nodes add column if not exists scope_id uuid;

update public.ai_workflow_nodes
set scope_type = 'USER',
    scope_id = created_by
where scope_type is null;

alter table public.ai_workflow_nodes alter column scope_type set default 'USER';
alter table public.ai_workflow_nodes alter column scope_type set not null;

alter table public.ai_workflow_nodes drop constraint if exists ai_workflow_nodes_scope_type_check;
alter table public.ai_workflow_nodes add constraint ai_workflow_nodes_scope_type_check
check (scope_type in ('USER', 'ORGANIZATION', 'GLOBAL'));

alter table public.ai_workflow_nodes drop constraint if exists ai_workflow_nodes_scope_id_check;
alter table public.ai_workflow_nodes add constraint ai_workflow_nodes_scope_id_check
check (
  (scope_type = 'USER' and scope_id = created_by)
  or (scope_type = 'ORGANIZATION' and scope_id is not null)
  or (scope_type = 'GLOBAL' and scope_id is null)
);

alter table public.ai_workflow_nodes drop constraint if exists ai_workflow_user_nodes_user_id_slug_key;
drop index if exists public.ai_workflow_user_nodes_user_id_slug_idx;
drop index if exists public.ai_workflow_user_nodes_slug_user_id_idx;

create unique index if not exists ai_workflow_nodes_scoped_slug_unique
on public.ai_workflow_nodes (scope_type, scope_id, slug)
where scope_type in ('USER', 'ORGANIZATION') and is_active = true;

create unique index if not exists ai_workflow_nodes_global_slug_unique
on public.ai_workflow_nodes (scope_type, slug)
where scope_type = 'GLOBAL' and is_active = true;

create index if not exists ai_workflow_nodes_created_by_idx
on public.ai_workflow_nodes (created_by);

create index if not exists ai_workflow_nodes_scope_idx
on public.ai_workflow_nodes (scope_type, scope_id);
