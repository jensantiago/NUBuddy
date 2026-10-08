begin;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create sequence if not exists public.report_number_seq;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 120),
  school_email text not null unique check (school_email = lower(school_email)),
  user_identifier text not null unique check (char_length(user_identifier) between 1 and 40),
  campus text not null check (char_length(campus) between 1 and 80),
  academic_program text check (academic_program is null or char_length(academic_program) between 1 and 120),
  role text not null check (role in ('student', 'facility_admin', 'security_guard')),
  account_status text not null check (account_status in ('pending', 'approved', 'rejected')),
  check ((role = 'student' and academic_program is not null) or (role <> 'student' and academic_program is null)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  report_number text not null unique,
  owner_id uuid not null references public.profiles(user_id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120),
  category text not null check (category in ('Broken Air Conditioner', 'Damaged Chair', 'Electrical Problem', 'Locked Classroom', 'Missing Equipment', 'Damaged Facility', 'Safety / Security', 'Other')),
  description text not null check (char_length(description) between 1 and 3000),
  building text not null check (char_length(building) between 1 and 100),
  floor text not null check (char_length(floor) between 1 and 20),
  room text not null check (char_length(room) between 1 and 120),
  photo_path text check (photo_path is null or char_length(photo_path) <= 500),
  status text not null default 'Submitted' check (status in ('Submitted', 'Under Review', 'In Progress', 'Resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.report_history (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports(id) on delete cascade,
  previous_status text check (previous_status is null or previous_status in ('Submitted', 'Under Review', 'In Progress', 'Resolved')),
  new_status text not null check (new_status in ('Submitted', 'Under Review', 'In Progress', 'Resolved')),
  changed_by uuid references public.profiles(user_id) on delete set null,
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(user_id) on delete cascade,
  report_id uuid not null references public.reports(id) on delete cascade,
  message text not null check (char_length(message) between 1 and 500),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists reports_owner_created_idx on public.reports(owner_id, created_at desc);
create index if not exists reports_status_created_idx on public.reports(status, created_at desc);
create index if not exists reports_category_idx on public.reports(category);
create index if not exists report_history_report_created_idx on public.report_history(report_id, created_at);
create index if not exists notifications_recipient_created_idx on public.notifications(recipient_id, created_at desc);
create index if not exists profiles_role_status_idx on public.profiles(role, account_status);

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function app_private.set_updated_at();
drop trigger if exists reports_set_updated_at on public.reports;
create trigger reports_set_updated_at before update on public.reports
for each row execute function app_private.set_updated_at();

create or replace function app_private.normalize_and_validate_auth_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null then
    raise exception 'A school email address is required.';
  end if;
  new.email := lower(btrim(new.email));
  if new.email !~ '^[^[:space:]@]+@(students|staff|guard)\.nu\.edu\.ph$' then
    raise exception 'Use an approved NU school email domain.';
  end if;
  return new;
end;
$$;

drop trigger if exists auth_users_validate_school_email on auth.users;
create trigger auth_users_validate_school_email
before insert or update of email on auth.users
for each row execute function app_private.normalize_and_validate_auth_email();

create or replace function app_private.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_status text;
  v_name text;
  v_identifier text;
  v_campus text;
  v_program text;
begin
  if new.email is null then raise exception 'A school email address is required.'; end if;
  case split_part(lower(new.email), '@', 2)
    when 'students.nu.edu.ph' then v_role := 'student';
    when 'staff.nu.edu.ph' then v_role := 'facility_admin';
    when 'guard.nu.edu.ph' then v_role := 'security_guard';
    else raise exception 'Use an approved NU school email domain.';
  end case;
  v_status := case when v_role = 'student' then 'approved' else 'pending' end;
  v_name := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  v_identifier := nullif(btrim(new.raw_user_meta_data ->> 'user_identifier'), '');
  v_campus := nullif(btrim(new.raw_user_meta_data ->> 'campus'), '');
  v_program := nullif(btrim(new.raw_user_meta_data ->> 'academic_program'), '');
  if v_name is null or v_identifier is null or v_campus is null then
    raise exception 'Full name, student or employee ID, and campus are required.';
  end if;
  if v_role = 'student' and v_program is null then
    raise exception 'A student academic program is required.';
  end if;
  insert into public.profiles(user_id, full_name, school_email, user_identifier, campus, academic_program, role, account_status)
  values (new.id, left(v_name, 120), lower(new.email), left(v_identifier, 40), left(v_campus, 80), case when v_role = 'student' then left(v_program, 120) else null end, v_role, v_status);
  return new;
end;
$$;

drop trigger if exists auth_user_create_profile on auth.users;
create trigger auth_user_create_profile
after insert on auth.users
for each row execute function app_private.create_profile_for_auth_user();

with candidates as (
  select
    u.id as user_id,
    lower(u.email) as school_email,
    left(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), 120) as full_name,
    left(nullif(btrim(u.raw_user_meta_data ->> 'user_identifier'), ''), 40) as user_identifier,
    left(nullif(btrim(u.raw_user_meta_data ->> 'campus'), ''), 80) as campus,
    left(nullif(btrim(u.raw_user_meta_data ->> 'academic_program'), ''), 120) as academic_program,
    case split_part(lower(u.email), '@', 2)
      when 'students.nu.edu.ph' then 'student'
      when 'staff.nu.edu.ph' then 'facility_admin'
      when 'guard.nu.edu.ph' then 'security_guard'
    end as role
  from auth.users u
  where u.email ~ '^[^[:space:]@]+@(students|staff|guard)\.nu\.edu\.ph$'
), ranked_candidates as (
  select candidates.*,
         row_number() over (partition by user_identifier order by user_id) as identifier_rank
  from candidates
  where full_name is not null
    and user_identifier is not null
    and campus is not null
    and (role <> 'student' or academic_program is not null)
)
insert into public.profiles (
  user_id, full_name, school_email, user_identifier, campus, academic_program, role, account_status
)
select
  user_id, full_name, school_email, user_identifier, campus,
  case when role = 'student' then academic_program else null end,
  role,
  case when role = 'student' then 'approved' else 'pending' end
from ranked_candidates
where identifier_rank = 1
on conflict (user_id) do nothing;

create or replace function app_private.sync_profile_email_and_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_existing_role text;
begin
  case split_part(lower(new.email), '@', 2)
    when 'students.nu.edu.ph' then v_role := 'student';
    when 'staff.nu.edu.ph' then v_role := 'facility_admin';
    when 'guard.nu.edu.ph' then v_role := 'security_guard';
    else raise exception 'Use an approved NU school email domain.';
  end case;
  select role into v_existing_role from public.profiles where user_id = new.id;
  if v_existing_role is distinct from v_role then
    raise exception 'Changing the school email domain cannot change an account role.';
  end if;
  update public.profiles set school_email = lower(new.email) where user_id = new.id;
  return new;
end;
$$;

drop trigger if exists auth_user_email_update_profile on auth.users;
create trigger auth_user_email_update_profile
after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function app_private.sync_profile_email_and_role();

create or replace function app_private.assign_report_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sequence bigint;
begin
  if new.report_number is null then
    v_sequence := nextval('public.report_number_seq');
    new.report_number := 'FR-' || to_char(now() at time zone 'UTC', 'YYYY') || '-' || lpad(v_sequence::text, greatest(6, char_length(v_sequence::text)), '0');
  end if;
  return new;
end;
$$;

drop trigger if exists reports_assign_number on public.reports;
create trigger reports_assign_number before insert on public.reports
for each row execute function app_private.assign_report_number();

create or replace function app_private.record_report_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.report_history(report_id, previous_status, new_status, changed_by, note)
  values (new.id, null, new.status, auth.uid(), null);
  return new;
end;
$$;

drop trigger if exists reports_initial_history on public.reports;
create trigger reports_initial_history after insert on public.reports
for each row execute function app_private.record_report_creation();

create or replace function app_private.email_is_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.profiles p on p.user_id = u.id
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and lower(u.email) = p.school_email
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.email_is_verified() and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.account_status = 'approved'
  );
$$;

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role in ('facility_admin', 'security_guard')
  );
$$;

create or replace function public.is_facility_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'facility_admin'
  );
$$;

create or replace function public.update_report_status(p_report_id uuid, p_status text, p_note text default null)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.reports%rowtype;
  v_previous text;
  v_statuses text[] := array['Submitted', 'Under Review', 'In Progress', 'Resolved'];
  v_message text;
begin
  if not public.is_active_staff() then raise exception 'Approved staff access is required.'; end if;
  if not (p_status = any(v_statuses)) then raise exception 'Invalid report status.'; end if;
  if p_note is not null and char_length(p_note) > 2000 then raise exception 'Update notes cannot exceed 2,000 characters.'; end if;
  select * into v_report from public.reports where id = p_report_id for update;
  if not found then raise exception 'Report not found.'; end if;
  if (select role from public.profiles where user_id = auth.uid()) = 'security_guard'
     and v_report.category not in ('Safety / Security', 'Locked Classroom', 'Electrical Problem') then
    raise exception 'Security guards may update safety, locked classroom, and electrical reports only.';
  end if;
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
  insert into public.report_history(report_id, previous_status, new_status, changed_by, note)
  values (v_report.id, v_previous, p_status, auth.uid(), nullif(btrim(p_note), ''));
  if p_status is distinct from v_previous then
    v_message := case p_status
      when 'Under Review' then 'is now under review.'
      when 'In Progress' then 'is now in progress.'
      when 'Resolved' then 'has been resolved.'
      else 'was updated.'
    end;
    insert into public.notifications(recipient_id, report_id, message)
    values (v_report.owner_id, v_report.id, 'Your facility report ' || v_report.report_number || ' ' || v_message);
  end if;
  return v_report;
end;
$$;

create or replace function public.review_staff_account(p_user_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if not public.is_active_user() or (select role from public.profiles where user_id = auth.uid()) <> 'facility_admin' then
    raise exception 'Approved Facilities administrator access is required.';
  end if;
  if p_user_id = auth.uid() then raise exception 'Administrators cannot approve their own account.'; end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null) then
    raise exception 'The staff account must verify its email before approval.';
  end if;
  select role into v_role from public.profiles
   where user_id = p_user_id and account_status = 'pending' for update;
  if not found or v_role not in ('facility_admin', 'security_guard') then
    raise exception 'This account is not a pending staff account.';
  end if;
  update public.profiles
     set account_status = case when p_approve then 'approved' else 'rejected' end
   where user_id = p_user_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.report_history enable row level security;
alter table public.notifications enable row level security;

drop policy if exists profiles_read_self_or_staff on public.profiles;
create policy profiles_read_self_or_staff on public.profiles
for select to authenticated
using (
  user_id = auth.uid()
  or (
    public.is_active_staff()
    and (
      (public.is_facility_admin() and role in ('facility_admin', 'security_guard'))
      or exists (
        select 1 from public.reports r
        where r.owner_id = profiles.user_id
      )
    )
  )
);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (user_id = auth.uid() and public.is_active_user())
with check (user_id = auth.uid() and public.is_active_user());

drop policy if exists reports_read_owner_or_staff on public.reports;
create policy reports_read_owner_or_staff on public.reports
for select to authenticated
using (public.is_active_user() and (owner_id = auth.uid() or public.is_active_staff()));
drop policy if exists reports_insert_owner on public.reports;
create policy reports_insert_owner on public.reports
for insert to authenticated
with check (
  public.is_active_user() and owner_id = auth.uid() and status = 'Submitted'
  and (photo_path is null or photo_path like auth.uid()::text || '/%')
);

drop policy if exists report_history_read_owner_or_staff on public.report_history;
create policy report_history_read_owner_or_staff on public.report_history
for select to authenticated
using (
  public.is_active_user() and exists (
    select 1 from public.reports r
    where r.id = report_history.report_id
      and (r.owner_id = auth.uid() or public.is_active_staff())
  )
);

drop policy if exists notifications_read_recipient on public.notifications;
create policy notifications_read_recipient on public.notifications
for select to authenticated
using (public.is_active_user() and recipient_id = auth.uid());
drop policy if exists notifications_update_read_state on public.notifications;
create policy notifications_update_read_state on public.notifications
for update to authenticated
using (public.is_active_user() and recipient_id = auth.uid())
with check (public.is_active_user() and recipient_id = auth.uid());

revoke all on public.profiles, public.reports, public.report_history, public.notifications from anon, authenticated;
grant select on public.profiles, public.reports, public.report_history, public.notifications to authenticated;
grant update (full_name, campus, academic_program) on public.profiles to authenticated;
grant insert (owner_id, title, category, description, building, floor, room, photo_path) on public.reports to authenticated;
grant update (is_read) on public.notifications to authenticated;
revoke all on sequence public.report_number_seq from public, anon, authenticated;

revoke all on function app_private.email_is_verified() from public, anon, authenticated;
revoke all on function public.is_active_user() from public, anon, authenticated;
revoke all on function public.is_active_staff() from public, anon, authenticated;
revoke all on function public.is_facility_admin() from public, anon, authenticated;
revoke all on function public.update_report_status(uuid, text, text) from public, anon, authenticated;
revoke all on function public.review_staff_account(uuid, boolean) from public, anon, authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_active_staff() to authenticated;
grant execute on function public.is_facility_admin() to authenticated;
grant execute on function public.update_report_status(uuid, text, text) to authenticated;
grant execute on function public.review_staff_account(uuid, boolean) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists report_photos_insert_own on storage.objects;
create policy report_photos_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'report-photos' and public.is_active_user()
  and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists report_photos_read_authorized on storage.objects;
create policy report_photos_read_authorized on storage.objects
for select to authenticated
using (
  bucket_id = 'report-photos' and public.is_active_user()
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_active_staff()
  )
);
drop policy if exists report_photos_delete_own on storage.objects;
create policy report_photos_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id = 'report-photos' and public.is_active_user()
  and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (select 1 from public.reports r where r.photo_path = name)
);

commit;