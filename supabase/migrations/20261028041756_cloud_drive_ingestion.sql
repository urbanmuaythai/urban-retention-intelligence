begin;

-- Only the server may read integration credentials (stored as SHA-256 hashes).
create table public.member_care_integrations (
 id text primary key check(id='clubworx-drive'),
 token_hash text not null check(token_hash ~ '^[0-9a-f]{64}$'),
 admin_id uuid not null references public.staff(id),
 folder_id text not null,
 enabled boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.member_care_integrations enable row level security;
revoke all on public.member_care_integrations from public, anon, authenticated;
grant select on public.member_care_integrations to service_role;
grant select on public.staff,public.members,public.weekly_reports,public.attendance_baselines,public.outreach_events to service_role;
-- PostgreSQL requires UPDATE privilege for SHARE ROW EXCLUSIVE table locks.
grant update on public.weekly_reports to service_role;

create function public.clubworx_drive_context() returns jsonb
language sql stable security invoker set search_path=public as $$
 select jsonb_build_object(
 'weeks',(select coalesce(jsonb_agg(to_jsonb(w) order by week),'[]'::jsonb) from public.weekly_reports w),
 'baselines',(select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) from public.attendance_baselines b),
 'members',(select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]'::jsonb) from public.members),
 'events','[]'::jsonb,
 'admin',(select jsonb_build_object('id',s.id,'active',s.active,'role',s.role) from public.staff s join public.member_care_integrations i on i.admin_id=s.id where i.id='clubworx-drive' and i.enabled and s.active and s.role='admin'));
$$;

create function public.import_clubworx_drive_batch(p_payload jsonb,p_versions jsonb) returns integer
language plpgsql security invoker set search_path=public as $$
declare integration public.member_care_integrations; result integer; old_notes jsonb;
begin
 -- API role is verified by PostgREST; user-editable metadata is never consulted.
 if current_user <> 'service_role' then raise exception 'Server access required' using errcode='42501'; end if;
 select * into integration from public.member_care_integrations where id='clubworx-drive' and enabled;
 if not found or not exists(select 1 from public.staff where id=integration.admin_id and active and role='admin') then raise exception 'Integration administrator is unavailable'; end if;
 if p_payload#>>'{import_summary,driveSync,folderId}' is distinct from integration.folder_id
 or p_payload#>>'{import_summary,driveSync,mode}' is distinct from 'google-apps-script'
 or jsonb_array_length(p_payload#>'{import_summary,driveSync,files}') is distinct from 4
 then raise exception 'Invalid Drive provenance'; end if;
 perform pg_advisory_xact_lock(hashtext('urban-member-care-drive-sync'));
 lock table public.weekly_reports in share row exclusive mode;
 if jsonb_typeof(p_versions) is distinct from 'array' then raise exception 'Report versions required'; end if;
 if exists(
  select 1 from public.weekly_reports w full join
   (select (v->>0)::date week,(v->>1)::timestamptz imported_at from jsonb_array_elements(p_versions) v) expected using(week)
  where w.week is null or expected.week is null or w.imported_at is distinct from expected.imported_at
 ) then raise exception 'Reports changed; reload context and retry later' using errcode='40001'; end if;
 select coalesce(jsonb_object_agg(e.id::text,md5(row(e.*)::text)),'{}'::jsonb) into old_notes from public.outreach_events e;
 perform set_config('request.jwt.claim.sub',integration.admin_id::text,true);
 result=public.import_retention_week(p_payload);
 if exists(select 1 from jsonb_each_text(old_notes) n left join public.outreach_events e on e.id::text=n.key where e.id is null or md5(row(e.*)::text)<>n.value) then raise exception 'Outreach history changed; rolling back'; end if;
 return result;
end; $$;

revoke all on function public.clubworx_drive_context(),public.import_clubworx_drive_batch(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.clubworx_drive_context(),public.import_clubworx_drive_batch(jsonb,jsonb),public.import_retention_week(jsonb),public.is_admin() to service_role;
commit;
