begin;
-- Fringe reach-out log: one row per member per report week (the Monday sheet's
-- Reach-out Method / Admin Validation / Date Contacted / Outcome columns).
create table public.fringe_outreach (
 week date not null references public.weekly_reports(week),
 member_id text not null check(length(member_id) between 1 and 250),
 method text check(method in ('Phone call','SMS','Email','In person','Social message')),
 contacted_on date,
 notes text not null default '' check(length(notes)<=4000),
 validated boolean not null default false,
 validated_by uuid references public.staff(id),
 updated_by uuid not null references public.staff(id),
 updated_at timestamptz not null default now(),
 primary key(week,member_id)
);
alter table public.fringe_outreach enable row level security;
create policy fringe_outreach_read on public.fringe_outreach for select to authenticated using(public.is_staff());
revoke all on public.fringe_outreach from anon,authenticated;
grant select on public.fringe_outreach to authenticated;

create or replace function public.save_fringe_outreach(
 p_week date,p_member_id text,p_method text,p_contacted_on date,p_notes text,p_validated boolean
) returns void
language plpgsql security definer set search_path=public as $$
declare keep_validated boolean; keep_by uuid;
begin
 if not public.is_staff() then raise exception 'Staff access required' using errcode='42501'; end if;
 if not exists(
  select 1 from public.weekly_reports
  where week=p_week and coalesce(import_summary#>'{fringe,members}','[]'::jsonb) @> jsonb_build_array(jsonb_build_object('member_id',p_member_id))
 ) then raise exception 'Member is not on this week''s Fringe list'; end if;
 if p_contacted_on is not null and p_contacted_on>(now() at time zone 'Australia/Brisbane')::date then
  raise exception 'Date contacted cannot be in the future';
 end if;
 select validated,validated_by into keep_validated,keep_by from public.fringe_outreach where week=p_week and member_id=p_member_id;
 -- Only administrators can change Admin Validation.
 if public.is_admin() then
  keep_validated=coalesce(p_validated,false);
  keep_by=case when keep_validated then auth.uid() else null end;
 end if;
 insert into public.fringe_outreach(week,member_id,method,contacted_on,notes,validated,validated_by,updated_by,updated_at)
 values(p_week,p_member_id,nullif(p_method,''),p_contacted_on,coalesce(trim(p_notes),''),coalesce(keep_validated,false),keep_by,auth.uid(),now())
 on conflict(week,member_id) do update set method=excluded.method,contacted_on=excluded.contacted_on,notes=excluded.notes,
  validated=excluded.validated,validated_by=excluded.validated_by,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
end; $$;
revoke all on function public.save_fringe_outreach(date,text,text,date,text,boolean) from public,anon;
grant execute on function public.save_fringe_outreach(date,text,text,date,text,boolean) to authenticated;
commit;
