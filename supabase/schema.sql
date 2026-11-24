-- Party Quest — database schema, security rules and game logic
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ───────────────────────── Tables ─────────────────────────
create table if not exists public.app_config (key text primary key, value text not null);

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  hair text not null default '#4A6CF7',
  created_at timestamptz not null default now()
);

create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  code text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.crew_members (
  crew_id uuid not null references public.crews on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);

create table if not exists public.quests (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews on delete cascade,
  series_id uuid,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  location text,
  kind text not null check (kind in ('once','recurring')),
  repeat_months int check (repeat_months in (1,3)),
  time_of_day time not null default '18:00',
  starts_at timestamptz,
  min_players int not null check (min_players >= 1),
  deadline timestamptz not null,
  status text not null default 'gathering' check (status in ('gathering','formed','failed','cancelled','done')),
  phase text check (phase in ('pick','vote','locked')),
  round int not null default 1,
  period_start date,
  period_end date,
  shortlist date[],
  streak int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists quests_crew_idx on public.quests(crew_id);
alter table public.quests add column if not exists touched_at timestamptz not null default now();

create table if not exists public.quest_members (
  quest_id uuid not null references public.quests on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null default 'pending' check (response in ('pending','accept','decline','propose')),
  comment text,
  proposed_at timestamptz,
  responded_at timestamptz,
  primary key (quest_id, user_id)
);

create table if not exists public.date_picks (
  quest_id uuid not null references public.quests on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  round int not null,
  dates date[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (quest_id, user_id, round)
);

create table if not exists public.date_votes (
  quest_id uuid not null references public.quests on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  vote date not null,
  primary key (quest_id, user_id)
);

create table if not exists public.quest_photos (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references public.quests on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pacts (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  due_date date not null,
  proof_type text not null default 'photo',
  penalty text not null default '3 strikes = buy the crew dinner',
  status text not null default 'writing' check (status in ('writing','sealed','judging','ended')),
  created_at timestamptz not null default now()
);
alter table public.pacts add column if not exists touched_at timestamptz not null default now();

create table if not exists public.pact_members (
  pact_id uuid not null references public.pacts on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  goal text,
  signed_at timestamptz,
  result text not null default 'pending' check (result in ('pending','hit','miss')),
  primary key (pact_id, user_id)
);

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  photo_path text,
  value text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  settled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  url text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

-- ───────────────────────── Helpers ─────────────────────────
create or replace function public.is_member(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crew_members where crew_id = c and user_id = auth.uid())
$$;

create or replace function public.sydney_today() returns date
language sql stable as $$ select (now() at time zone 'Australia/Sydney')::date $$;

create or replace function public.pname(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from profiles where id = u), 'Someone')
$$;

create or replace function public.notify(uids uuid[], t text, b text, u text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, title, body, url)
  select distinct x, t, b, u from unnest(uids) x where x is not null
$$;

create or replace function public.quest_uids(q uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from quest_members where quest_id = q
$$;

create or replace function public.pact_uids(p uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from pact_members where pact_id = p
$$;

create or replace function public.fmt_date(d date) returns text
language sql immutable as $$ select to_char(d, 'Dy FMDD Mon') $$;

-- ───────────────────────── Row level security ─────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.app_config from anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter table public.app_config enable row level security;          -- no policies: server only
alter table public.profiles enable row level security;
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.quests enable row level security;
alter table public.quest_members enable row level security;
alter table public.date_picks enable row level security;
alter table public.date_votes enable row level security;
alter table public.quest_photos enable row level security;
alter table public.pacts enable row level security;
alter table public.pact_members enable row level security;
alter table public.checkins enable row level security;
alter table public.debts enable row level security;
alter table public.push_subs enable row level security;
alter table public.notifications enable row level security;

drop policy if exists p_profiles_sel on public.profiles;
create policy p_profiles_sel on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from crew_members a join crew_members b on a.crew_id = b.crew_id
    where a.user_id = auth.uid() and b.user_id = profiles.id));
drop policy if exists p_profiles_upd on public.profiles;
create policy p_profiles_upd on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists p_crews_sel on public.crews;
create policy p_crews_sel on public.crews for select using (public.is_member(id));
drop policy if exists p_cm_sel on public.crew_members;
create policy p_cm_sel on public.crew_members for select using (public.is_member(crew_id));

drop policy if exists p_quests_sel on public.quests;
create policy p_quests_sel on public.quests for select using (public.is_member(crew_id));
drop policy if exists p_qm_sel on public.quest_members;
create policy p_qm_sel on public.quest_members for select using (
  exists (select 1 from quests q where q.id = quest_id and public.is_member(q.crew_id)));
-- Your own picks always; other people's picks only from earlier (missed) rounds.
drop policy if exists p_dp_sel on public.date_picks;
create policy p_dp_sel on public.date_picks for select using (
  user_id = auth.uid() or exists (
    select 1 from quests q where q.id = quest_id and public.is_member(q.crew_id)
    and (date_picks.round < q.round or q.phase <> 'pick' or q.status <> 'gathering')));
drop policy if exists p_dv_sel on public.date_votes;
create policy p_dv_sel on public.date_votes for select using (
  exists (select 1 from quests q where q.id = quest_id and public.is_member(q.crew_id)));
drop policy if exists p_qp_sel on public.quest_photos;
create policy p_qp_sel on public.quest_photos for select using (
  exists (select 1 from quests q where q.id = quest_id and public.is_member(q.crew_id)));

drop policy if exists p_pacts_sel on public.pacts;
create policy p_pacts_sel on public.pacts for select using (public.is_member(crew_id));
drop policy if exists p_pm_sel on public.pact_members;
create policy p_pm_sel on public.pact_members for select using (
  exists (select 1 from pacts p where p.id = pact_id and public.is_member(p.crew_id)));
-- Goals are hidden at column level; read them through pact_view() which reveals them once sealed.
revoke select on public.pact_members from anon, authenticated;
grant select (pact_id, user_id, signed_at, result) on public.pact_members to authenticated;
drop policy if exists p_ci_sel on public.checkins;
create policy p_ci_sel on public.checkins for select using (
  exists (select 1 from pacts p where p.id = pact_id and public.is_member(p.crew_id)));
drop policy if exists p_debts_sel on public.debts;
create policy p_debts_sel on public.debts for select using (public.is_member(crew_id));

drop policy if exists p_push_all on public.push_subs;
create policy p_push_all on public.push_subs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists p_notif_sel on public.notifications;
create policy p_notif_sel on public.notifications for select using (user_id = auth.uid());
drop policy if exists p_notif_upd on public.notifications;
create policy p_notif_upd on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────────────────── Profiles & crews ─────────────────────────
create or replace function public.save_profile(p_name text, p_hair text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into profiles (id, name, hair) values (auth.uid(), trim(p_name), coalesce(p_hair, '#4A6CF7'))
  on conflict (id) do update set name = excluded.name, hair = excluded.hair;
end $$;

create or replace function public.create_crew(p_name text) returns json
language plpgsql security definer set search_path = public as $$
declare c crews; v_code text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if not exists (select 1 from profiles where id = auth.uid()) then raise exception 'Make your hero first'; end if;
  loop
    v_code := '';
    for i in 1..6 loop v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from crews where code = v_code);
  end loop;
  insert into crews (name, code, created_by) values (trim(p_name), v_code, auth.uid()) returning * into c;
  insert into crew_members (crew_id, user_id) values (c.id, auth.uid());
  return row_to_json(c);
end $$;

create or replace function public.join_crew(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare c crews;
begin
  if not exists (select 1 from profiles where id = auth.uid()) then raise exception 'Make your hero first'; end if;
  select * into c from crews where code = upper(trim(p_code));
  if c.id is null then raise exception 'No crew found with that code'; end if;
  if not exists (select 1 from crew_members where crew_id = c.id and user_id = auth.uid()) then
    insert into crew_members (crew_id, user_id) values (c.id, auth.uid());
    perform notify(array(select user_id from crew_members where crew_id = c.id and user_id <> auth.uid()),
      pname(auth.uid()) || ' joined ' || c.name, 'A new adventurer has arrived.', '#/crew');
  end if;
  return row_to_json(c);
end $$;

-- ───────────────────────── Quests ─────────────────────────
create or replace function public.next_period_start(months int) returns date
language sql stable as $$
  select (date_trunc('month', (now() at time zone 'Australia/Sydney')) + interval '1 month')::date
$$;

create or replace function public.create_quest(
  p_crew uuid, p_title text, p_location text, p_kind text, p_starts_at timestamptz,
  p_repeat_months int, p_time time, p_min int, p_deadline timestamptz, p_members uuid[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid(); v_members uuid[]; v_start date;
begin
  if not is_member(p_crew) then raise exception 'Not in this crew'; end if;
  if p_deadline <= now() then raise exception 'The answer-by time must be in the future'; end if;
  if p_min < 2 then raise exception 'Minimum players must be at least 2 (you plus one friend)'; end if;
  select array_agg(distinct m) into v_members from unnest(coalesce(p_members, '{}') || auth.uid()) m
    where exists (select 1 from crew_members where crew_id = p_crew and user_id = m);
  if p_min > coalesce(array_length(v_members, 1), 0) then raise exception 'Minimum players is more than the party size'; end if;
  if p_kind = 'once' then
    if p_starts_at is null then raise exception 'Pick a date and time'; end if;
    insert into quests (id, crew_id, created_by, title, location, kind, starts_at, min_players, deadline)
    values (v_id, p_crew, auth.uid(), trim(p_title), p_location, 'once', p_starts_at, p_min, p_deadline);
  elsif p_kind = 'recurring' then
    v_start := next_period_start(coalesce(p_repeat_months, 1));
    insert into quests (id, series_id, crew_id, created_by, title, location, kind, repeat_months, time_of_day,
      min_players, deadline, phase, period_start, period_end)
    values (v_id, v_id, p_crew, auth.uid(), trim(p_title), p_location, 'recurring', coalesce(p_repeat_months, 1),
      coalesce(p_time, '18:00'), p_min, p_deadline, 'pick', v_start,
      (v_start + make_interval(months => coalesce(p_repeat_months, 1)) - interval '1 day')::date);
  else
    raise exception 'Unknown Party Quest type';
  end if;
  insert into quest_members (quest_id, user_id, response, responded_at)
  select v_id, m, case when m = auth.uid() and p_kind = 'once' then 'accept' else 'pending' end,
         case when m = auth.uid() and p_kind = 'once' then now() end
  from unnest(v_members) m;
  perform notify(array_remove(v_members, auth.uid()),
    case when p_kind = 'once' then pname(auth.uid()) || ' invites you: ' || trim(p_title)
         else 'Pick your dates: ' || trim(p_title) end,
    case when p_kind = 'once' then 'Accept, decline or propose a new time.'
         else 'Mark the days you can do. Picks close ' || to_char(p_deadline at time zone 'Australia/Sydney', 'Dy FMDD Mon, FMHH12:MI am') || '.' end,
    '#/quest/' || v_id);
  if p_kind = 'once' and p_min <= 1 then perform form_quest(v_id); end if;
  return v_id;
end $$;

create or replace function public.form_quest(q uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r quests;
begin
  update quests set status = 'formed' where id = q and status = 'gathering' returning * into r;
  if r.id is null then return; end if;
  perform notify(quest_uids(q), 'Party formed: ' || r.title,
    to_char(r.starts_at at time zone 'Australia/Sydney', 'Dy FMDD Mon, FMHH12:MI am') || coalesce(' · ' || r.location, ''),
    '#/quest/' || q);
end $$;

create or replace function public.respond_quest(p_quest uuid, p_response text, p_comment text, p_proposed_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare r quests; v_yes int;
begin
  select * into r from quests where id = p_quest;
  if r.id is null or not is_member(r.crew_id) then raise exception 'Party Quest not found'; end if;
  if r.kind <> 'once' or r.status <> 'gathering' then raise exception 'This Party Quest is no longer taking answers'; end if;
  if p_response not in ('accept','decline','propose') then raise exception 'Bad answer'; end if;
  update quest_members set response = p_response, comment = nullif(trim(p_comment), ''),
    proposed_at = case when p_response = 'propose' then p_proposed_at end, responded_at = now()
  where quest_id = p_quest and user_id = auth.uid();
  if not found then raise exception 'You are not in this party'; end if;
  if r.created_by <> auth.uid() then
    perform notify(array[r.created_by],
      pname(auth.uid()) || case p_response when 'accept' then ' accepted ' when 'decline' then ' declined ' else ' proposed a new time for ' end || r.title,
      coalesce(nullif(trim(p_comment), ''), case when p_response = 'propose' and p_proposed_at is not null
        then 'Suggested ' || to_char(p_proposed_at at time zone 'Australia/Sydney', 'Dy FMDD Mon, FMHH12:MI am') end),
      '#/quest/' || p_quest);
  end if;
  select count(*) into v_yes from quest_members where quest_id = p_quest and response = 'accept';
  if v_yes >= r.min_players then perform form_quest(p_quest); end if;
end $$;

create or replace function public.lock_quest(q uuid, d date) returns void
language plpgsql security definer set search_path = public as $$
declare r quests;
begin
  update quests set phase = 'locked', status = 'formed',
    starts_at = ((d + time_of_day)::timestamp at time zone 'Australia/Sydney')
  where id = q and status = 'gathering' returning * into r;
  if r.id is null then return; end if;
  update quest_members m set response = case when exists (
      select 1 from date_picks p where p.quest_id = q and p.user_id = m.user_id and d = any(p.dates)) or exists (
      select 1 from date_votes v where v.quest_id = q and v.user_id = m.user_id and v.vote = d)
    then 'accept' else 'pending' end, responded_at = now()
  where quest_id = q;
  perform notify(quest_uids(q), 'Locked in: ' || r.title || ' is on ' || fmt_date(d),
    'Locked in. Add it to your calendar.', '#/quest/' || q);
end $$;

create or replace function public.spawn_next(q uuid, p_streak int) returns uuid
language plpgsql security definer set search_path = public as $$
declare r quests; v_id uuid := gen_random_uuid(); v_start date;
begin
  select * into r from quests where id = q;
  if r.kind <> 'recurring' then return null; end if;
  if exists (select 1 from quests where series_id = r.series_id and status = 'gathering') then return null; end if;
  v_start := greatest(next_period_start(r.repeat_months), r.period_end + 1);
  insert into quests (id, series_id, crew_id, created_by, title, location, kind, repeat_months, time_of_day,
    min_players, deadline, phase, period_start, period_end, streak)
  values (v_id, r.series_id, r.crew_id, r.created_by, r.title, r.location, 'recurring', r.repeat_months, r.time_of_day,
    r.min_players, least(now() + interval '5 days', (v_start::timestamp at time zone 'Australia/Sydney')),
    'pick', v_start, (v_start + make_interval(months => r.repeat_months) - interval '1 day')::date, p_streak);
  insert into quest_members (quest_id, user_id)
  select v_id, m.user_id from quest_members m where m.quest_id = q
    and exists (select 1 from crew_members c where c.crew_id = r.crew_id and c.user_id = m.user_id);
  perform notify(quest_uids(v_id), 'Next round: ' || r.title,
    'Pick your dates for ' || to_char(v_start, 'FMMonth') || '. Streak ×' || p_streak || ' on the line.', '#/quest/' || v_id);
  return v_id;
end $$;

-- Battleship: compare everyone's picks for the current round.
-- p_final = true at the deadline (a miss then fails the quest instead of starting another round).
create or replace function public.evaluate_round(q uuid, p_final boolean) returns text
language plpgsql security definer set search_path = public as $$
declare r quests; v_hits date[];
begin
  select * into r from quests where id = q for update;
  if r.status <> 'gathering' or r.phase <> 'pick' then return 'skip'; end if;
  select array_agg(d order by d) into v_hits from (
    select d from date_picks p, unnest(p.dates) d
    where p.quest_id = q and p.round = r.round group by d having count(*) >= r.min_players) s;
  if coalesce(array_length(v_hits, 1), 0) = 1 then
    perform lock_quest(q, v_hits[1]); return 'hit';
  elsif coalesce(array_length(v_hits, 1), 0) > 1 then
    update quests set phase = 'vote', shortlist = v_hits where id = q;
    perform notify(quest_uids(q), 'A few dates work: vote for ' || r.title,
      array_length(v_hits, 1) || ' dates work. Vote for one.', '#/quest/' || q);
    return 'vote';
  elsif p_final then
    update quests set status = 'failed' where id = q;
    perform notify(quest_uids(q), r.title || ' could not find a date',
      'No date worked before the deadline. Streak broken.', '#/quest/' || q);
    perform spawn_next(q, 0);
    return 'failed';
  else
    update quests set round = round + 1 where id = q;
    perform notify(quest_uids(q), 'No match yet: ' || r.title || ' — round ' || (r.round + 1),
      'No date works yet. See who is free on each day and pick again.', '#/quest/' || q);
    return 'miss';
  end if;
end $$;

create or replace function public.submit_picks(p_quest uuid, p_dates date[]) returns text
language plpgsql security definer set search_path = public as $$
declare r quests; v_need int; v_have int;
begin
  select * into r from quests where id = p_quest;
  if r.id is null or not is_member(r.crew_id) then raise exception 'Party Quest not found'; end if;
  if r.kind <> 'recurring' or r.status <> 'gathering' or r.phase <> 'pick' then raise exception 'Picking is closed'; end if;
  if not exists (select 1 from quest_members where quest_id = p_quest and user_id = auth.uid()) then raise exception 'You are not in this party'; end if;
  if exists (select 1 from unnest(p_dates) d where d < r.period_start or d > r.period_end) then raise exception 'Pick days inside the period'; end if;
  insert into date_picks (quest_id, user_id, round, dates) values (p_quest, auth.uid(), r.round, coalesce(p_dates, '{}'))
  on conflict (quest_id, user_id, round) do update set dates = excluded.dates, created_at = now();
  update quests set touched_at = now() where id = p_quest;
  select count(*) into v_need from quest_members where quest_id = p_quest;
  select count(*) into v_have from date_picks where quest_id = p_quest and round = r.round;
  if v_have >= v_need then return evaluate_round(p_quest, false); end if;
  return 'waiting';
end $$;

create or replace function public.finalize_vote(q uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r quests; v_pick date;
begin
  select * into r from quests where id = q;
  if r.status <> 'gathering' or r.phase <> 'vote' then return; end if;
  select s.d into v_pick from unnest(r.shortlist) s(d)
    left join date_votes v on v.quest_id = q and v.vote = s.d
    group by s.d order by count(v.user_id) desc, s.d asc limit 1;
  perform lock_quest(q, v_pick);
end $$;

create or replace function public.vote_date(p_quest uuid, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare r quests;
begin
  select * into r from quests where id = p_quest;
  if r.id is null or not is_member(r.crew_id) then raise exception 'Party Quest not found'; end if;
  if r.status <> 'gathering' or r.phase <> 'vote' or not (p_date = any(r.shortlist)) then raise exception 'Voting is closed'; end if;
  insert into date_votes (quest_id, user_id, vote) values (p_quest, auth.uid(), p_date)
  on conflict (quest_id, user_id) do update set vote = excluded.vote;
  update quests set touched_at = now() where id = p_quest;
  if (select count(*) from date_votes where quest_id = p_quest) >= (select count(*) from quest_members where quest_id = p_quest) then
    perform finalize_vote(p_quest);
  end if;
end $$;

create or replace function public.cancel_quest(p_quest uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r quests;
begin
  select * into r from quests where id = p_quest;
  if r.id is null or r.created_by <> auth.uid() then raise exception 'Only the organiser can cancel'; end if;
  if r.status not in ('gathering','formed') then raise exception 'Already finished'; end if;
  update quests set status = 'cancelled' where id = p_quest;
  perform notify(array_remove(quest_uids(p_quest), auth.uid()), r.title || ' was cancelled',
    case when r.kind = 'recurring' then 'Streak broken. A fresh round has started.' else 'The organiser called it off.' end, '#/quest/' || p_quest);
  if r.kind = 'recurring' then perform spawn_next(p_quest, 0); end if;
end $$;

create or replace function public.add_quest_photo(p_quest uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare r quests;
begin
  select * into r from quests where id = p_quest;
  if r.id is null or not is_member(r.crew_id) then raise exception 'Party Quest not found'; end if;
  if split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'Bad photo path'; end if;
  insert into quest_photos (quest_id, user_id, path) values (p_quest, auth.uid(), p_path);
  update quests set touched_at = now() where id = p_quest;
end $$;

-- ───────────────────────── Blood pacts ─────────────────────────
create or replace function public.create_pact(p_crew uuid, p_name text, p_due date, p_proof text, p_penalty text, p_members uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid(); v_members uuid[];
begin
  if not is_member(p_crew) then raise exception 'Not in this crew'; end if;
  if p_due <= sydney_today() then raise exception 'Due date must be in the future'; end if;
  select array_agg(distinct m) into v_members from unnest(coalesce(p_members, '{}') || auth.uid()) m
    where exists (select 1 from crew_members where crew_id = p_crew and user_id = m);
  insert into pacts (id, crew_id, created_by, name, due_date, proof_type, penalty)
  values (v_id, p_crew, auth.uid(), trim(p_name), p_due, coalesce(p_proof, 'photo'), coalesce(nullif(trim(p_penalty), ''), '3 strikes = buy the crew dinner'));
  insert into pact_members (pact_id, user_id) select v_id, m from unnest(v_members) m;
  perform notify(array_remove(v_members, auth.uid()), pname(auth.uid()) || ' invites you to sign a blood pact',
    trim(p_name) || ' · due ' || fmt_date(p_due) || '. Write your goal to seal it.', '#/pact/' || v_id);
  return v_id;
end $$;

create or replace function public.sign_pact(p_pact uuid, p_goal text) returns text
language plpgsql security definer set search_path = public as $$
declare p pacts;
begin
  select * into p from pacts where id = p_pact;
  if p.id is null or not is_member(p.crew_id) then raise exception 'Pact not found'; end if;
  if p.status <> 'writing' then raise exception 'This pact is already sealed'; end if;
  if char_length(trim(coalesce(p_goal, ''))) < 3 then raise exception 'Write a real goal'; end if;
  update pact_members set goal = trim(p_goal), signed_at = now() where pact_id = p_pact and user_id = auth.uid();
  if not found then raise exception 'You are not in this pact'; end if;
  update pacts set touched_at = now() where id = p_pact;
  if not exists (select 1 from pact_members where pact_id = p_pact and signed_at is null) then
    update pacts set status = 'sealed' where id = p_pact;
    perform notify(pact_uids(p_pact), 'The pact is sealed: ' || p.name, 'Everyone has signed. Read the terms.', '#/pact/' || p_pact);
    return 'sealed';
  end if;
  return 'signed';
end $$;

create or replace function public.pact_view(p_pact uuid)
returns table (user_id uuid, name text, hair text, goal text, signed boolean, result text, checkins bigint, last_checkin timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare p pacts;
begin
  select * into p from pacts where id = p_pact;
  if p.id is null or not is_member(p.crew_id) then raise exception 'Pact not found'; end if;
  return query
    select m.user_id, pr.name, pr.hair,
      case when p.status <> 'writing' or m.user_id = auth.uid() then m.goal end,
      m.signed_at is not null, m.result,
      (select count(*) from checkins c where c.pact_id = p_pact and c.user_id = m.user_id),
      (select max(c.created_at) from checkins c where c.pact_id = p_pact and c.user_id = m.user_id)
    from pact_members m join profiles pr on pr.id = m.user_id
    where m.pact_id = p_pact order by pr.name;
end $$;

create or replace function public.add_checkin(p_pact uuid, p_photo text, p_value text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare p pacts;
begin
  select * into p from pacts where id = p_pact;
  if p.id is null or not is_member(p.crew_id) then raise exception 'Pact not found'; end if;
  if p.status <> 'sealed' then raise exception 'Check-ins open once the pact is sealed'; end if;
  if not exists (select 1 from pact_members where pact_id = p_pact and user_id = auth.uid()) then raise exception 'You are not in this pact'; end if;
  if p_photo is not null and split_part(p_photo, '/', 1) <> auth.uid()::text then raise exception 'Bad photo path'; end if;
  insert into checkins (pact_id, user_id, photo_path, value, note)
  values (p_pact, auth.uid(), p_photo, nullif(trim(p_value), ''), nullif(trim(p_note), ''));
  update pacts set touched_at = now() where id = p_pact;
end $$;

create or replace function public.start_judging(p_pact uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p pacts;
begin
  update pacts set status = 'judging' where id = p_pact and status = 'sealed' returning * into p;
  if p.id is null then return; end if;
  perform notify(pact_uids(p_pact), 'Judgement day: ' || p.name, 'Did you honour the pact? Mark your result.', '#/pact/' || p_pact);
end $$;

-- Organiser can end a pact early (handy for testing).
create or replace function public.judge_now(p_pact uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pacts where id = p_pact and created_by = auth.uid()) then raise exception 'Only the pact creator can do this'; end if;
  perform start_judging(p_pact);
end $$;

create or replace function public.set_result(p_pact uuid, p_result text) returns void
language plpgsql security definer set search_path = public as $$
declare p pacts; v_misses int;
begin
  select * into p from pacts where id = p_pact;
  if p.id is null or not is_member(p.crew_id) then raise exception 'Pact not found'; end if;
  if p.status <> 'judging' then raise exception 'Results open on the due date'; end if;
  if p_result not in ('hit','miss') then raise exception 'Bad result'; end if;
  update pact_members set result = p_result where pact_id = p_pact and user_id = auth.uid() and result = 'pending';
  if not found then raise exception 'Already marked'; end if;
  update pacts set touched_at = now() where id = p_pact;
  if p_result = 'miss' then
    select count(*) into v_misses from pact_members m join pacts x on x.id = m.pact_id
      where x.crew_id = p.crew_id and m.user_id = auth.uid() and m.result = 'miss';
    perform notify(array_remove(pact_uids(p_pact), auth.uid()), pname(auth.uid()) || ' missed their goal',
      'Strike ' || v_misses || ' on the naughty list.', '#/pact/' || p_pact);
    if v_misses % 3 = 0 then
      insert into debts (crew_id, user_id, reason) values (p.crew_id, auth.uid(), '3 strikes — owes the crew dinner');
      perform notify(array(select user_id from crew_members where crew_id = p.crew_id),
        pname(auth.uid()) || ' owes the crew dinner!', 'Three strikes. It''s in the debt book.', '#/archive');
    end if;
  end if;
  if not exists (select 1 from pact_members where pact_id = p_pact and result = 'pending') then
    update pacts set status = 'ended' where id = p_pact;
    perform notify(pact_uids(p_pact), p.name || ' has ended', 'See who honoured the pact.', '#/pact/' || p_pact);
  end if;
end $$;

create or replace function public.settle_debt(p_debt uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update debts set settled = true where id = p_debt and is_member(crew_id);
end $$;

create or replace function public.crew_stats(p_crew uuid)
returns table (user_id uuid, strikes bigint, shared_quests bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p_crew) then raise exception 'Not in this crew'; end if;
  return query
    select cm.user_id,
      (select count(*) from pact_members m join pacts x on x.id = m.pact_id where x.crew_id = p_crew and m.user_id = cm.user_id and m.result = 'miss'),
      (select count(*) from quests q
         join quest_members a on a.quest_id = q.id and a.user_id = auth.uid() and a.response = 'accept'
         join quest_members b on b.quest_id = q.id and b.user_id = cm.user_id and b.response = 'accept'
       where q.crew_id = p_crew and q.status in ('formed','done'))
    from crew_members cm where cm.crew_id = p_crew;
end $$;

-- Who has fired their picks this round (names only, never their dates)
create or replace function public.round_status(p_quest uuid) returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select p.user_id from date_picks p join quests q on q.id = p.quest_id
  where q.id = p_quest and p.round = q.round and public.is_member(q.crew_id)
$$;

-- Organiser moves a one-off Party Quest to a new time (e.g. a friend's proposal) and re-sends the invites.
create or replace function public.reschedule_quest(p_quest uuid, p_starts_at timestamptz, p_from_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r quests; v_yes int;
begin
  select * into r from quests where id = p_quest;
  if r.id is null or r.created_by <> auth.uid() then raise exception 'Only the organiser can change the time'; end if;
  if r.kind <> 'once' or r.status not in ('gathering','formed') then raise exception 'This Party Quest can no longer be changed'; end if;
  if p_starts_at <= now() then raise exception 'Pick a time in the future'; end if;
  update quests set starts_at = p_starts_at, status = 'gathering',
    deadline = least(greatest(deadline, now() + interval '24 hours'), p_starts_at - interval '1 hour')
  where id = p_quest;
  update quest_members set
    response = case when user_id in (auth.uid(), p_from_user) then 'accept' else 'pending' end,
    responded_at = case when user_id in (auth.uid(), p_from_user) then now() end,
    proposed_at = null, comment = null
  where quest_id = p_quest;
  perform notify(array(select user_id from quest_members where quest_id = p_quest and user_id <> auth.uid()),
    'New time for ' || r.title, to_char(p_starts_at at time zone 'Australia/Sydney', 'Dy FMDD Mon, FMHH12:MI am') || ' — please answer again.',
    '#/quest/' || p_quest);
  select count(*) into v_yes from quest_members where quest_id = p_quest and response = 'accept';
  if v_yes >= r.min_players then perform form_quest(p_quest); end if;
end $$;

-- ───────────────────────── Clock (runs every 10 minutes) ─────────────────────────
create or replace function public.tick() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  -- One-off quests past their answer-by time
  for r in select * from quests where kind = 'once' and status = 'gathering' and deadline < now() loop
    if (select count(*) from quest_members where quest_id = r.id and response = 'accept') >= r.min_players then
      perform form_quest(r.id);
    else
      update quests set status = 'failed' where id = r.id;
      perform notify(quest_uids(r.id), 'Party not formed: ' || r.title, 'Not enough adventurers said yes in time.', '#/quest/' || r.id);
    end if;
  end loop;
  -- Recurring quests past their picking/voting deadline
  for r in select * from quests where kind = 'recurring' and status = 'gathering' and deadline < now() loop
    if r.phase = 'pick' then perform evaluate_round(r.id, true);
    elsif r.phase = 'vote' then perform finalize_vote(r.id); end if;
  end loop;
  -- Events that have happened
  for r in select * from quests where status = 'formed' and starts_at + interval '3 hours' < now() loop
    update quests set status = 'done' where id = r.id;
    if r.kind = 'recurring' then perform spawn_next(r.id, r.streak + 1); end if;
  end loop;
  -- Pacts that reached their due date
  for r in select * from pacts where status = 'sealed' and due_date <= sydney_today() loop
    perform start_judging(r.id);
  end loop;
end $$;

create or replace function public.weekly_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select p.id, p.name, m.user_id from pacts p join pact_members m on m.pact_id = p.id
    where p.status = 'sealed' and not exists (
      select 1 from checkins c where c.pact_id = p.id and c.user_id = m.user_id and c.created_at > now() - interval '7 days')
  loop
    perform notify(array[r.user_id], 'Check-in due: ' || r.name, 'Show your proof for this week.', '#/checkin/' || r.id);
  end loop;
end $$;

-- ───────────────────────── Push notifications ─────────────────────────
create or replace function public.push_on_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select value into v_url from app_config where key = 'push_url';
  select value into v_secret from app_config where key = 'push_secret';
  if v_url is null then return new; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('user_id', new.user_id, 'title', new.title, 'body', new.body, 'url', new.url));
  return new;
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
for each row execute function public.push_on_notification();

-- ───────────────────────── Lock down function access ─────────────────────────
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.save_profile(text, text), public.create_crew(text), public.join_crew(text),
  public.create_quest(uuid, text, text, text, timestamptz, int, time, int, timestamptz, uuid[]),
  public.respond_quest(uuid, text, text, timestamptz), public.submit_picks(uuid, date[]),
  public.vote_date(uuid, date), public.cancel_quest(uuid), public.add_quest_photo(uuid, text),
  public.create_pact(uuid, text, date, text, text, uuid[]), public.sign_pact(uuid, text),
  public.pact_view(uuid), public.add_checkin(uuid, text, text, text), public.judge_now(uuid),
  public.set_result(uuid, text), public.settle_debt(uuid), public.crew_stats(uuid),
  public.is_member(uuid), public.sydney_today(), public.round_status(uuid),
  public.reschedule_quest(uuid, timestamptz, uuid)
to authenticated;
revoke execute on function public.tick(), public.weekly_reminders(), public.evaluate_round(uuid, boolean),
  public.lock_quest(uuid, date), public.spawn_next(uuid, int), public.finalize_vote(uuid), public.form_quest(uuid),
  public.start_judging(uuid), public.notify(uuid[], text, text, text), public.pname(uuid),
  public.quest_uids(uuid), public.pact_uids(uuid), public.push_on_notification() from authenticated;

-- ───────────────────────── Photo storage ─────────────────────────
insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict (id) do nothing;
drop policy if exists pq_photos_insert on storage.objects;
create policy pq_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ───────────────────────── Schedules ─────────────────────────
select cron.unschedule(jobid) from cron.job where jobname in ('pq-tick', 'pq-weekly');
select cron.schedule('pq-tick', '*/10 * * * *', 'select public.tick()');
select cron.schedule('pq-weekly', '0 7 * * 0', 'select public.weekly_reminders()');  -- Sunday ~6 pm Sydney

-- ───────────────────────── Push function address ─────────────────────────
insert into public.app_config (key, value)
values ('push_url', 'https://luszvyaenkpvocqbskrj.supabase.co/functions/v1/send-push')
on conflict (key) do update set value = excluded.value;

-- ───────────────────────── Live updates (Supabase Realtime) ─────────────────────────
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['quests','pacts','quest_members','crew_members','notifications'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;
