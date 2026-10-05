-- Vitalog cloud sync on Supabase (Free plan, region: Frankfurt / eu-central-1).
--
-- Zero-knowledge design: the browser encrypts everything (AES-256-GCM) with a data key that
-- is wrapped by a key derived from the user's password (PBKDF2-SHA256, 600k iterations) and,
-- separately, by a one-time recovery code. Supabase stores ONLY ciphertext + wrapped keys.
--
-- Run once in the Supabase dashboard → SQL Editor. Idempotent.

-- ── Wrapped data keys ────────────────────────────────────────────
create table if not exists public.vitalog_keys (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  kdf_salt text not null,
  kdf_iterations integer not null check (kdf_iterations >= 100000),
  wrapped_dek_password text not null,
  recovery_salt text not null,
  wrapped_dek_recovery text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Encrypted application state (one row per user) ──────────────
create table if not exists public.vitalog_state (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  version bigint not null default 1,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

alter table public.vitalog_keys enable row level security;
alter table public.vitalog_state enable row level security;

-- Each user can only see and change their own rows. Anonymous users get nothing.
drop policy if exists "own keys" on public.vitalog_keys;
create policy "own keys" on public.vitalog_keys for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own state" on public.vitalog_state;
create policy "own state" on public.vitalog_state for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.vitalog_keys, public.vitalog_state from anon;

-- ── Private file bucket: <user id>/<file id>, encrypted blobs only ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vitalog-files', 'vitalog-files', false, 20971520, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/octet-stream'];

drop policy if exists "vitalog own files read" on storage.objects;
drop policy if exists "vitalog own files insert" on storage.objects;
drop policy if exists "vitalog own files update" on storage.objects;
drop policy if exists "vitalog own files delete" on storage.objects;
create policy "vitalog own files read" on storage.objects for select to authenticated
  using (bucket_id = 'vitalog-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "vitalog own files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'vitalog-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "vitalog own files update" on storage.objects for update to authenticated
  using (bucket_id = 'vitalog-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "vitalog own files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'vitalog-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── Self-service account deletion (GDPR Art. 17) ──────────────────
-- Files are removed by the client first (Storage API); this deletes the auth user, and the
-- rows above cascade.
create or replace function public.vitalog_delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke execute on function public.vitalog_delete_my_account() from public, anon;
grant execute on function public.vitalog_delete_my_account() to authenticated;

-- ── Keep-alive (Free projects pause after 7 days without DB activity) ──
-- Called daily by .github/workflows/keepalive.yml with the public anon key. Returns no data.
create or replace function public.vitalog_ping()
returns integer
language sql
stable
as $$ select 1 $$;
grant execute on function public.vitalog_ping() to anon, authenticated;
