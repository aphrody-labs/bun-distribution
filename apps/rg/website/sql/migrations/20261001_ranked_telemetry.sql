-- Ranked telemetry belongs to Achillea inside the shared RG database.
-- Queue and invitation events may exist before a lobby is created.
create table if not exists achillea.ranked_match_event (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  lobby_id bigint,
  room_code text,
  mode smallint,
  user_id text,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists ranked_match_event_lobby_idx
  on achillea.ranked_match_event(lobby_id, id desc);
create index if not exists ranked_match_event_room_idx
  on achillea.ranked_match_event(room_code, id desc);
create index if not exists ranked_match_event_user_idx
  on achillea.ranked_match_event(user_id, id desc);
