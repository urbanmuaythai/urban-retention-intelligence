begin;
-- Archived weekly observations are separate from operational report weeks.
-- Only trusted database administration can write these identity-reviewed baselines.
create table public.attendance_baselines (
 as_of date primary key check(extract(isodow from as_of)=1),
 source_label text not null check(length(source_label) between 1 and 500),
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='array' and jsonb_array_length(snapshot) between 1 and 5000),
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
 imported_at timestamptz not null default now(),
 imported_by uuid not null references public.staff(id)
);
alter table public.attendance_baselines enable row level security;
revoke all on public.attendance_baselines from public,anon,authenticated;
grant select on public.attendance_baselines to authenticated;
create policy baselines_staff_read on public.attendance_baselines for select to authenticated using((select public.is_staff()));
commit;
