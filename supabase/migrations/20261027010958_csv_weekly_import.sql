begin;
-- Complete attendance snapshots preserve healthy members for next week's trend checks.
-- Existing report RLS and administrator-only import authorization continue to apply.
alter table public.weekly_reports add column attendance_snapshot jsonb not null default '[]'::jsonb
 check(jsonb_typeof(attendance_snapshot)='array' and jsonb_array_length(attendance_snapshot)<=5000);
alter table public.weekly_reports add column import_summary jsonb not null default '{}'::jsonb
 check(jsonb_typeof(import_summary)='object');
alter table public.weekly_risks drop constraint weekly_risks_priority_check;
alter table public.weekly_risks add constraint weekly_risks_priority_check check(priority in ('Red','Yellow','Watch','Review'));
create or replace function public.import_retention_week(p_payload jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare report_week date; item jsonb; imported integer; member_key text; snapshot jsonb; snapshot_count integer;
begin
 if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if (p_payload->>'version')::integer is distinct from 1 or jsonb_typeof(p_payload->'members') is distinct from 'array' then raise exception 'Invalid version 1 weekly export'; end if;
 report_week=(p_payload->>'week')::date;
 imported=jsonb_array_length(p_payload->'members');
 snapshot=coalesce(p_payload->'attendance_snapshot','[]'::jsonb);
 if jsonb_typeof(snapshot) is distinct from 'array' then raise exception 'Attendance snapshot must be an array'; end if;
 snapshot_count=jsonb_array_length(snapshot);
 if report_week is null or imported>5000 or snapshot_count>5000 or (imported=0 and snapshot_count=0) then raise exception 'Import must contain risks or a complete attendance snapshot, maximum 5000 people'; end if;
 if p_payload ? 'attendance_snapshot' and snapshot_count=0 then raise exception 'Attendance snapshot cannot be empty'; end if;
 if jsonb_typeof(coalesce(p_payload->'import_summary','{}'::jsonb)) is distinct from 'object' then raise exception 'Import summary must be an object'; end if;
 if (select count(distinct x->>'member_id') from jsonb_array_elements(snapshot) x)<>snapshot_count then raise exception 'Duplicate or missing snapshot IDs'; end if;
 for item in select value from jsonb_array_elements(snapshot) loop
  if length(coalesce(item->>'member_id','')) not between 1 and 250 then raise exception 'Invalid attendance member ID'; end if;
  if jsonb_typeof(item->'s7') is distinct from 'number' or jsonb_typeof(item->'s30') is distinct from 'number' then raise exception 'Snapshot requires numeric attendance'; end if;
  if (item->>'s7')::numeric<>trunc((item->>'s7')::numeric) or (item->>'s30')::numeric<>trunc((item->>'s30')::numeric) or (item->>'s7')::integer<0 or (item->>'s30')::integer<(item->>'s7')::integer then raise exception 'Invalid snapshot attendance'; end if;
 end loop;
 if snapshot_count>0 and exists (
  select 1 from jsonb_array_elements(p_payload->'members') r
  where not exists(select 1 from jsonb_array_elements(snapshot) s
   where s->>'member_id'=r->>'member_id' and s->'s7'=r->'s7' and s->'s30'=r->'s30')
 ) then raise exception 'Risk members must match the attendance snapshot'; end if;
 if (select count(distinct x->>'member_id') from jsonb_array_elements(p_payload->'members') x)<>imported then raise exception 'Duplicate or missing member IDs'; end if;
 -- Serialise imports for one week; transaction rollback preserves the old snapshot on any error.
 perform pg_advisory_xact_lock(hashtext('retention-import-'||report_week::text));
 insert into public.weekly_reports(week,source_label,source_count,imported_by,attendance_snapshot,import_summary)
 values(report_week,coalesce(p_payload->>'source_label','Weekly retention export'),imported,auth.uid(),snapshot,coalesce(p_payload->'import_summary','{}'::jsonb))
 on conflict(week) do update set source_label=excluded.source_label,source_count=excluded.source_count,imported_at=now(),imported_by=auth.uid(),attendance_snapshot=excluded.attendance_snapshot,import_summary=excluded.import_summary;
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

-- CREATE OR REPLACE preserves grants; explicitly enforce the intended public API.
revoke all on function public.import_retention_week(jsonb) from public,anon;
grant execute on function public.import_retention_week(jsonb) to authenticated;
commit;
