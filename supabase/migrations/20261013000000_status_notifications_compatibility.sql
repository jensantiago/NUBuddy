begin;

alter table public.notifications
  add column if not exists id uuid default gen_random_uuid();
alter table public.notifications
  alter column id set default gen_random_uuid(),
  alter column id set not null;
create unique index if not exists notifications_id_uidx on public.notifications(id);

alter table public.notifications
  add column if not exists title text;
update public.notifications
   set title = 'Report status updated'
 where title is null;
alter table public.notifications
  alter column title set default 'Report status updated',
  alter column title set not null;


drop function public.update_report_status(uuid, text, text);

create function public.update_report_status(
  p_report_id uuid,
  p_status text,
  p_note text default null
)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.reports%rowtype;
  v_previous text;
  v_role text;
  v_old_status_column text;
  v_statuses text[] := array['Submitted', 'Under Review', 'In Progress', 'Resolved'];
  v_title text := 'Report status updated';
  v_message text;
begin
  if not public.is_active_staff() then
    raise exception 'Approved staff access is required.';
  end if;
  select role into v_role from public.profiles where user_id = auth.uid();
  if v_role not in ('facility_admin', 'security_guard') then
    raise exception 'Approved staff access is required.';
  end if;
  if p_status is null or not (p_status = any(v_statuses)) then
    raise exception 'Invalid report status.';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'Update notes cannot exceed 2,000 characters.';
  end if;

  select * into v_report from public.reports where id = p_report_id for update;
  if not found then raise exception 'Report not found.'; end if;
  v_previous := v_report.status;
  if array_position(v_statuses, p_status) < array_position(v_statuses, v_previous) then
    raise exception 'Report status cannot move backwards.';
  end if;
  if p_status = v_previous and nullif(btrim(p_note), '') is null then
    raise exception 'Add a note or choose a new status.';
  end if;

  update public.reports
     set status = p_status,
         resolved_at = case when p_status = 'Resolved' then coalesce(resolved_at, now()) else resolved_at end
   where id = p_report_id
   returning * into v_report;

  select case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'report_history' and column_name = 'old_status'
    ) then 'old_status'
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'report_history' and column_name = 'previous_status'
    ) then 'previous_status'
  end into v_old_status_column;
  if v_old_status_column is null then
    raise exception 'report_history must have an old_status or previous_status column.';
  end if;
  execute format(
    'insert into public.report_history(report_id, %I, new_status, changed_by, note) values ($1, $2, $3, $4, $5)',
    v_old_status_column
  ) using v_report.id, v_previous, p_status, auth.uid(), nullif(btrim(p_note), '');

  if p_status is distinct from v_previous then
    v_message := case p_status
      when 'Under Review' then 'is now under review.'
      when 'In Progress' then 'is now in progress.'
      when 'Resolved' then 'has been resolved.'
      else 'was updated.'
    end;
    insert into public.notifications(recipient_id, report_id, title, message)
    values (
      v_report.owner_id,
      v_report.id,
      v_title,
      'Your facility report ' || v_report.report_number || ' ' || v_message
    );
  end if;
  return v_report;
end;
$$;

revoke all on function public.update_report_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_report_status(uuid, text, text) to authenticated;
grant select (id, recipient_id, report_id, title, message, is_read, created_at)
  on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication
    where pubname = 'supabase_realtime' and not puballtables
  ) then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reports'
    ) then
      alter publication supabase_realtime add table public.reports;
    end if;
  end if;
end;
$$;

commit;
