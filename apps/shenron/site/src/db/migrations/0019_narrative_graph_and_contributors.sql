-- Phase 1 / Sprint 3 : Graphe narratif unifié et ontologie des contributeurs / staff

DO $$ BEGIN
    CREATE TYPE bot.narrative_event_kind AS ENUM ('event', 'battle', 'tournament', 'war');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE bot.timeline_kind AS ENUM ('manga', 'anime', 'film', 'oav', 'game', 'xenoverse', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE bot.canon_rank AS ENUM ('absolute', 'supervised', 'official_extension', 'non_canon', 'apocryphal', 'unverified');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE bot.contributor_category AS ENUM ('author', 'editorial_staff', 'animation', 'voice', 'music', 'scenario', 'publisher', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS bot.narrative_timelines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  kind bot.timeline_kind NOT NULL,
  label text NOT NULL,
  parent_id bigint REFERENCES bot.narrative_timelines(id),
  source_id text REFERENCES bot.db_sources(id),
  visible boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS bot.narrative_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  kind bot.narrative_event_kind NOT NULL,
  title text NOT NULL,
  title_ja text,
  title_romaji text,
  synopsis_fr text,
  timeline_id bigint NOT NULL REFERENCES bot.narrative_timelines(id),
  saga_id bigint REFERENCES bot.db_sagas(id),
  arc_id bigint REFERENCES bot.db_arcs(id),
  canon bot.canon_rank NOT NULL DEFAULT 'unverified',
  start_order numeric(10,3),
  end_order numeric(10,3),
  source_id text REFERENCES bot.db_sources(id),
  visible boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS bot.narrative_event_aliases (
  event_id bigint NOT NULL REFERENCES bot.narrative_events(id),
  alias text NOT NULL,
  locale text NOT NULL DEFAULT 'fr',
  PRIMARY KEY (event_id, alias, locale)
);

CREATE TABLE IF NOT EXISTS bot.narrative_event_participants (
  event_id bigint NOT NULL REFERENCES bot.narrative_events(id),
  character_id bigint NOT NULL REFERENCES bot.db_characters(id),
  role text NOT NULL DEFAULT 'participant',
  outcome text,
  PRIMARY KEY (event_id, character_id, role)
);

CREATE TABLE IF NOT EXISTS bot.narrative_event_relations (
  from_event_id bigint NOT NULL REFERENCES bot.narrative_events(id),
  to_event_id bigint NOT NULL REFERENCES bot.narrative_events(id),
  relation text NOT NULL CHECK (relation IN ('contains', 'variant_of', 'adaptation_of', 'precedes', 'branches_from')),
  PRIMARY KEY (from_event_id, to_event_id, relation)
);

CREATE TABLE IF NOT EXISTS bot.contributors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  name_ja text,
  name_romaji text,
  category bot.contributor_category NOT NULL,
  birth_date date,
  death_date date,
  biography_fr text,
  spotlight_rank integer,
  source_id text REFERENCES bot.db_sources(id),
  visible boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS bot.contributor_credits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contributor_id bigint NOT NULL REFERENCES bot.contributors(id),
  role text NOT NULL,
  credit_scope text NOT NULL CHECK (credit_scope IN ('work', 'series', 'episode', 'film', 'game', 'track', 'character')),
  work_id bigint REFERENCES bot.media_works(id),
  episode_id bigint REFERENCES bot.db_episodes(id),
  movie_id bigint REFERENCES bot.db_movies(id),
  game_id bigint REFERENCES bot.db_games(id),
  soundtrack_id bigint REFERENCES bot.db_soundtracks(id),
  character_id bigint REFERENCES bot.db_characters(id),
  source_id text REFERENCES bot.db_sources(id),
  visible boolean NOT NULL DEFAULT true,
  CHECK (num_nonnulls(work_id, episode_id, movie_id, game_id, soundtrack_id, character_id) = 1)
);

-- Index de performance du graphe narratif et des contributeurs
CREATE INDEX IF NOT EXISTS idx_narrative_events_timeline ON bot.narrative_events (timeline_id);
CREATE INDEX IF NOT EXISTS idx_narrative_events_saga ON bot.narrative_events (saga_id);
CREATE INDEX IF NOT EXISTS idx_narrative_events_arc ON bot.narrative_events (arc_id);
CREATE INDEX IF NOT EXISTS idx_narrative_events_canon ON bot.narrative_events (canon);
CREATE INDEX IF NOT EXISTS idx_narrative_participants_char ON bot.narrative_event_participants (character_id);
CREATE INDEX IF NOT EXISTS idx_narrative_relations_to ON bot.narrative_event_relations (to_event_id);
CREATE INDEX IF NOT EXISTS idx_contributors_category ON bot.contributors (category);
CREATE INDEX IF NOT EXISTS idx_contributors_spotlight ON bot.contributors (spotlight_rank) WHERE spotlight_rank IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contributor_credits_contributor ON bot.contributor_credits (contributor_id);
