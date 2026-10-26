begin;

create table public.staff (
 id uuid primary key references auth.users(id),
 display_name text not null check (length(trim(display_name)) between 1 and 120),
 role text not null default 'coach' check (role in ('coach','admin')),
 active boolean not null default true
);
create function public.is_staff() returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.staff where id=auth.uid() and active); $$;
create function public.is_admin() returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.staff where id=auth.uid() and active and role='admin'); $$;

create table public.members (
 id text primary key check(length(id) between 1 and 250),
 full_name text not null check(length(trim(full_name)) between 1 and 200),
 membership text not null default '' check(length(membership)<=500),
 phone text check(length(phone)<=60),
 revision integer not null default 0
);
create table public.weekly_reports (
 week date primary key check(extract(isodow from week)=1),
 source_label text not null check(length(source_label)<=500),
 source_count integer not null check(source_count>=0),
 imported_at timestamptz not null default now(),
 imported_by uuid not null references public.staff(id)
);
create table public.weekly_risks (
 week date not null references public.weekly_reports(week),
 member_id text not null references public.members(id),
 priority text not null check(priority in ('Red','Yellow','Watch')),
 signal text not null check(length(signal) between 1 and 500),
 s7 integer not null check(s7>=0),
 s30 integer not null check(s30>=0),
 sequence integer[] not null default '{}' check(0<=all(sequence)),
 primary key(week,member_id)
);
create table public.outreach_events (
 id uuid primary key default gen_random_uuid(),
 sequence bigint generated always as identity unique,
 request_id uuid not null unique,
 member_id text not null references public.members(id),
 week date not null references public.weekly_reports(week),
 body text not null check(length(trim(body)) between 1 and 4000),
 status text check(status in ('open','contacted','booked','completed','snoozed')),
 suppress_through date,
 follow_up_on date,
 assigned_to uuid references public.staff(id),
 created_by uuid not null references public.staff(id),
 created_at timestamptz not null default now(),
 check((status in ('completed','snoozed') and suppress_through is not null and suppress_through>=week) or (coalesce(status,'') not in ('completed','snoozed') and suppress_through is null)),
 check(status is distinct from 'snoozed' or follow_up_on is not null)
);
create index outreach_member_history on public.outreach_events(member_id,sequence desc);
create index weekly_risks_week_priority on public.weekly_risks(week,priority);

alter table public.staff enable row level security;
alter table public.members enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.weekly_risks enable row level security;
alter table public.outreach_events enable row level security;
create policy staff_read on public.staff for select to authenticated using(public.is_staff());
create policy members_read on public.members for select to authenticated using(public.is_staff());
create policy reports_read on public.weekly_reports for select to authenticated using(public.is_staff());
create policy risks_read on public.weekly_risks for select to authenticated using(public.is_staff());
create policy events_read on public.outreach_events for select to authenticated using(public.is_staff());
revoke all on public.staff,public.members,public.weekly_reports,public.weekly_risks,public.outreach_events from anon,authenticated;
grant select on public.staff,public.members,public.weekly_reports,public.weekly_risks,public.outreach_events to authenticated;

create function public.record_outreach(
 p_member_id text,p_week date,p_body text,p_status text,p_suppress_through date,
 p_follow_up_on date,p_assigned_to uuid,p_expected_revision integer,p_request_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare current_revision integer; event_id uuid;
begin
 if not public.is_staff() then raise exception 'Staff access required' using errcode='42501'; end if;
 select id into event_id from public.outreach_events where request_id=p_request_id and created_by=auth.uid() and member_id=p_member_id;
 if found then return event_id; end if;
 select revision into current_revision from public.members where id=p_member_id for update;
 if not found then raise exception 'Member not found'; end if;
 if current_revision is distinct from p_expected_revision then raise exception 'Another coach updated this member. Refresh and review their note before saving.' using errcode='40001'; end if;
 if not exists(select 1 from public.weekly_risks where week=p_week and member_id=p_member_id) then raise exception 'Member is not in this report week'; end if;
 if p_body is null or length(trim(p_body))=0 then raise exception 'A note is required'; end if;
 if p_assigned_to is not null and not exists(select 1 from public.staff where id=p_assigned_to and active) then raise exception 'Choose an active staff member'; end if;
 if p_suppress_through>p_week+84 then raise exception 'Exemptions are limited to 12 report weeks; review the case before extending'; end if;
 insert into public.outreach_events(request_id,member_id,week,body,status,suppress_through,follow_up_on,assigned_to,created_by)
 values(p_request_id,p_member_id,p_week,trim(p_body),p_status,p_suppress_through,p_follow_up_on,p_assigned_to,auth.uid()) returning id into event_id;
 update public.members set revision=revision+1 where id=p_member_id;
 return event_id;
end; $$;

create function public.import_retention_week(p_payload jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare report_week date; item jsonb; imported integer; member_key text;
begin
 if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if (p_payload->>'version')::integer is distinct from 1 or jsonb_typeof(p_payload->'members') is distinct from 'array' then raise exception 'Invalid version 1 weekly export'; end if;
 report_week=(p_payload->>'week')::date;
 imported=jsonb_array_length(p_payload->'members');
 if report_week is null or imported<1 or imported>5000 then raise exception 'Import must have a week and 1–5000 members'; end if;
 if (select count(distinct x->>'member_id') from jsonb_array_elements(p_payload->'members') x)<>imported then raise exception 'Duplicate or missing member IDs'; end if;
 -- Serialise imports for one week; transaction rollback preserves the old snapshot on any error.
 perform pg_advisory_xact_lock(hashtext('retention-import-'||report_week::text));
 insert into public.weekly_reports(week,source_label,source_count,imported_by)
 values(report_week,coalesce(p_payload->>'source_label','Weekly retention export'),imported,auth.uid())
 on conflict(week) do update set source_label=excluded.source_label,source_count=excluded.source_count,imported_at=now(),imported_by=auth.uid();
 delete from public.weekly_risks where week=report_week;
 for item in select value from jsonb_array_elements(p_payload->'members') loop
  member_key=item->>'member_id';
  if member_key is null or item->>'name' is null then raise exception 'Member ID and name are required'; end if;
  if jsonb_typeof(item->'s7') is distinct from 'number' or jsonb_typeof(item->'s30') is distinct from 'number' then raise exception 'Missing attendance counts'; end if;
  if (item->>'s7')::numeric<>trunc((item->>'s7')::numeric) or (item->>'s30')::numeric<>trunc((item->>'s30')::numeric) then raise exception 'Attendance must be integers'; end if;
  insert into public.members(id,full_name,membership,phone)
  values(member_key,item->>'name',coalesce(item->>'membership',''),item->>'phone')
  on conflict(id) do update set full_name=excluded.full_name,membership=excluded.membership,phone=excluded.phone;
  insert into public.weekly_risks(week,member_id,priority,signal,s7,s30,sequence)
  values(report_week,member_key,item->>'priority',item->>'signal',(item->>'s7')::integer,(item->>'s30')::integer,
   array(select case when value='null'::jsonb then null else (value#>>'{}')::integer end from jsonb_array_elements(coalesce(item->'sequence','[]'::jsonb))));
 end loop;
 return imported;
end; $$;

revoke all on function public.is_staff(),public.is_admin(),public.record_outreach(text,date,text,text,date,date,uuid,integer,uuid),public.import_retention_week(jsonb) from public;
grant execute on function public.is_staff(),public.is_admin(),public.record_outreach(text,date,text,text,date,date,uuid,integer,uuid),public.import_retention_week(jsonb) to authenticated;

-- Optional Realtime publication; polling remains available if Realtime is disabled.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.outreach_events,public.weekly_reports;
 end if;
end $$;
commit;
