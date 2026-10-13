begin;

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('student', 'faculty', 'facility_admin', 'security_guard'));

create or replace function app_private.role_for_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(btrim(p_email)) = 'santiagojenina683@gmail.com' then 'facility_admin'
    when lower(btrim(p_email)) ~ '^[^[:space:]@]+@students\.nu\.edu\.ph$' then 'student'
    when lower(btrim(p_email)) ~ '^[^[:space:]@]+@faculty\.nu\.edu\.ph$' then 'faculty'
    when lower(btrim(p_email)) ~ '^[^[:space:]@]+@admin\.nu\.edu\.ph$' then 'facility_admin'
    when lower(btrim(p_email)) ~ '^[^[:space:]@]+@guard\.nu\.edu\.ph$' then 'security_guard'
    else null
  end;
$$;

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
  v_role := app_private.role_for_email(new.email);
  if v_role is null then raise exception 'Use an approved NU school email address.'; end if;
  v_status := case when v_role in ('student', 'faculty') then 'approved' else 'pending' end;
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

commit;