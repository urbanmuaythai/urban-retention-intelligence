-- Live "trained since the report" check (4 Nov 2026).
-- The Clubworx Member API names people by a text contact_key; Member Care uses clubworx:<Contact ID>.
-- The Edge Function clubworx-live-attendance matches each member once (exact name among current memberships,
-- confirmed by phone when both have one) and saves it here. Server-only: no staff or anonymous access.
create table if not exists public.clubworx_contact_keys (
  member_id text primary key references public.members(id) on delete cascade,
  contact_key text not null unique check (length(contact_key) between 8 and 64),
  matched_by text not null check (matched_by in ('phone', 'name')),
  matched_at timestamptz not null default now()
);
alter table public.clubworx_contact_keys enable row level security;
revoke all on public.clubworx_contact_keys from anon, authenticated;
