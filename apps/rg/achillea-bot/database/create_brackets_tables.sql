-- create_brackets_tables.sql
-- DDL definition for brackets-manager tables mapped by MikroORMBracketAdapter

CREATE TABLE IF NOT EXISTS bm_participant (
    id SERIAL PRIMARY KEY,
    tournament_id INT NOT NULL,
    name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS bm_stage (
    id SERIAL PRIMARY KEY,
    tournament_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(255) NOT NULL,
    settings JSONB NOT NULL,
    number INT NOT NULL
);

CREATE TABLE IF NOT EXISTS bm_group (
    id SERIAL PRIMARY KEY,
    stage_id INT NOT NULL,
    number INT NOT NULL
);

CREATE TABLE IF NOT EXISTS bm_round (
    id SERIAL PRIMARY KEY,
    stage_id INT NOT NULL,
    group_id INT NOT NULL,
    number INT NOT NULL
);

CREATE TABLE IF NOT EXISTS bm_match (
    id SERIAL PRIMARY KEY,
    stage_id INT NOT NULL,
    group_id INT NOT NULL,
    round_id INT NOT NULL,
    number INT NOT NULL,
    child_count INT NOT NULL,
    status INT NOT NULL,
    opponent1 JSONB NULL,
    opponent2 JSONB NULL
);

CREATE TABLE IF NOT EXISTS bm_match_game (
    id SERIAL PRIMARY KEY,
    stage_id INT NOT NULL,
    parent_id INT NOT NULL,
    number INT NOT NULL,
    status INT NOT NULL,
    opponent1 JSONB NULL,
    opponent2 JSONB NULL
);
