-- Deadhead to Diesel King — cloud saves (Supabase / Postgres). Run in the Supabase SQL editor once.
-- One JSON blob per user. Clients use the anon key + the user's JWT; RLS limits every row to its owner.
-- NEVER ship the service_role key in the game.

create table if not exists public.saves (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  rev             bigint      not null default 0,          -- server revision, +1 per accepted write (optimistic concurrency)
  schema_ver      int         not null default 4,          -- game save format (S.v)
  data            jsonb       not null,                    -- the full game state S, exactly as stored in localStorage 'idletruck'
  bytes           int         generated always as (octet_length(data::text)) stored,
  client_saved_at timestamptz,                              -- device clock (untrusted; for UI only)
  device_id       text,
  updated_at      timestamptz not null default now(),      -- SERVER clock (trusted; offline-progress anchor)
  created_at      timestamptz not null default now(),
  cash            double precision generated always as ((data->>'cash')::double precision) stored,
  earned          double precision generated always as ((data->>'earned')::double precision) stored,
  flags           text[]      not null default '{}',       -- soft anti-cheat flags, reviewed later (never auto-ban)
  constraint save_size check (octet_length(data::text) < 1000000)
);

-- History of the last few accepted saves per user (recovery from bad syncs / conflict mistakes).
create table if not exists public.save_history (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  rev        bigint not null,
  data       jsonb not null,
  saved_at   timestamptz not null default now()
);
create index if not exists save_history_user on public.save_history(user_id, rev desc);

alter table public.saves        enable row level security;
alter table public.save_history enable row level security;

-- Owner can read their own row. Writes go ONLY through put_save() so rev/flags can't be forged.
drop policy if exists saves_select_own on public.saves;
create policy saves_select_own on public.saves for select to authenticated using (user_id = auth.uid());
drop policy if exists hist_select_own on public.save_history;
create policy hist_select_own on public.save_history for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.saves, public.save_history from anon, authenticated;

-- Atomic compare-and-swap write + soft sanity checks.
create or replace function public.put_save(p_data jsonb, p_base_rev bigint, p_client_saved_at timestamptz, p_device text, p_schema int default 4)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cur public.saves%rowtype;
  new_rev bigint;
  f text[] := '{}';
  dt_s double precision;
  d_earned double precision;
  max_rate double precision;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) >= 1000000 then raise exception 'bad save'; end if;
  select * into cur from public.saves where user_id = uid for update;
  if found and cur.rev <> p_base_rev then
    return jsonb_build_object('ok', false, 'rev', cur.rev, 'server_now', now());   -- someone else wrote first: client must resolve
  end if;
  -- Soft anti-cheat (flags only). Server time is the trusted clock.
  if found then
    dt_s := greatest(1, extract(epoch from now() - cur.updated_at));
    d_earned := coalesce((p_data->>'earned')::double precision, 0) - coalesce(cur.earned, 0);
    -- allow generous growth: 10x the previous lifetime earnings per hour played, floor $50k/h, offline capped at 8h by the client
    max_rate := greatest(50000, coalesce(cur.earned, 0) * 10) / 3600.0;
    if d_earned > max_rate * least(dt_s, 8*3600) * 3 + 100000 then f := array_append(f, 'earned_spike'); end if;
    if coalesce((p_data->>'cash')::double precision, 0) > coalesce((p_data->>'earned')::double precision, 0) + 1000000 then f := array_append(f, 'cash_gt_earned'); end if;
    if p_client_saved_at > now() + interval '10 minutes' then f := array_append(f, 'client_clock_ahead'); end if;
    if coalesce((p_data->>'last')::double precision, 0) / 1000 > extract(epoch from now()) + 600 then f := array_append(f, 'last_in_future'); end if;
  end if;
  new_rev := coalesce(cur.rev, 0) + 1;
  insert into public.saves as s (user_id, rev, schema_ver, data, client_saved_at, device_id, updated_at, flags)
    values (uid, new_rev, p_schema, p_data, p_client_saved_at, p_device, now(), f)
  on conflict (user_id) do update set rev = excluded.rev, schema_ver = excluded.schema_ver, data = excluded.data,
    client_saved_at = excluded.client_saved_at, device_id = excluded.device_id, updated_at = now(),
    flags = (select array(select distinct unnest(s.flags || excluded.flags)));
  insert into public.save_history(user_id, rev, data) values (uid, new_rev, p_data);
  delete from public.save_history where user_id = uid and rev <= new_rev - 5;   -- keep last 5
  return jsonb_build_object('ok', true, 'rev', new_rev, 'server_now', now(), 'flags', to_jsonb(f));
end $$;
revoke all on function public.put_save(jsonb, bigint, timestamptz, text, int) from public, anon;
grant execute on function public.put_save(jsonb, bigint, timestamptz, text, int) to authenticated;

-- Trusted clock for offline-progress: client calls this on resume and uses min(device_elapsed, server_elapsed).
create or replace function public.server_now() returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.server_now() to anon, authenticated;

-- In-app account deletion (App Store 5.1.1(v) / Play policy). Cascades to saves + history.
create or replace function public.delete_my_account() returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
