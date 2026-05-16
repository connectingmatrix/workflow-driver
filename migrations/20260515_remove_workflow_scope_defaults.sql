begin;

delete from public.ai_workflow_assignments
where scope_id is null;

alter table public.ai_workflow_assignments
alter column scope_id set not null;

alter table public.ai_workflow_assignments
drop constraint if exists ai_workflow_assignments_owner_required;

alter table public.ai_workflow_assignments
add constraint ai_workflow_assignments_owner_required
check (user_id is not null or organization_id is not null);

commit;
