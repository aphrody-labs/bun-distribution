/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export const MASTER_DB_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS players (
    player_id INTEGER PRIMARY KEY,
    common_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    nationality_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    league_id INTEGER NOT NULL,
    position TEXT NOT NULL,
    secondary_positions TEXT,
    birthdate TEXT,
    height_cm INTEGER,
    weight_kg INTEGER,
    preferred_foot TEXT CHECK(preferred_foot IN ('Left', 'Right')),
    weak_foot INTEGER CHECK(weak_foot BETWEEN 1 AND 5),
    skill_moves INTEGER CHECK(skill_moves BETWEEN 1 AND 5),
    body_type TEXT,
    real_face_id INTEGER,
    international_rep INTEGER DEFAULT 1,
    accelerate_type TEXT,
    overall_rating INTEGER NOT NULL,
    potential_rating INTEGER NOT NULL,
    pace INTEGER NOT NULL,
    shooting INTEGER NOT NULL,
    passing INTEGER NOT NULL,
    dribbling INTEGER NOT NULL,
    defending INTEGER NOT NULL,
    physicality INTEGER NOT NULL,
    acceleration INTEGER NOT NULL,
    sprint_speed INTEGER NOT NULL,
    positioning INTEGER NOT NULL,
    finishing INTEGER NOT NULL,
    shot_power INTEGER NOT NULL,
    long_shots INTEGER NOT NULL,
    volleys INTEGER NOT NULL,
    penalties INTEGER NOT NULL,
    vision INTEGER NOT NULL,
    crossing INTEGER NOT NULL,
    free_kick_accuracy INTEGER NOT NULL,
    short_passing INTEGER NOT NULL,
    long_passing INTEGER NOT NULL,
    curve INTEGER NOT NULL,
    agility INTEGER NOT NULL,
    balance INTEGER NOT NULL,
    reactions INTEGER NOT NULL,
    ball_control INTEGER NOT NULL,
    dribbling_sub INTEGER NOT NULL,
    composure INTEGER NOT NULL,
    interceptions INTEGER NOT NULL,
    heading_accuracy INTEGER NOT NULL,
    def_awareness INTEGER NOT NULL,
    standing_tackle INTEGER NOT NULL,
    sliding_tackle INTEGER NOT NULL,
    jumping INTEGER NOT NULL,
    stamina INTEGER NOT NULL,
    strength INTEGER NOT NULL,
    aggression INTEGER NOT NULL,
    gk_diving INTEGER,
    gk_handling INTEGER,
    gk_kicking INTEGER,
    gk_reflexes INTEGER,
    gk_speed INTEGER,
    gk_positioning INTEGER
);

CREATE TABLE IF NOT EXISTS teams (
    team_id INTEGER PRIMARY KEY,
    team_name TEXT NOT NULL,
    league_id INTEGER NOT NULL,
    stadium_id INTEGER,
    overall INTEGER NOT NULL,
    attack INTEGER NOT NULL,
    midfield INTEGER NOT NULL,
    defense INTEGER NOT NULL,
    transfer_budget INTEGER DEFAULT 0,
    wage_budget INTEGER DEFAULT 0,
    rival_team_id INTEGER
);

CREATE TABLE IF NOT EXISTS leagues (
    league_id INTEGER PRIMARY KEY,
    league_name TEXT NOT NULL,
    nation_id INTEGER NOT NULL,
    tier INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS player_playstyles (
    player_id INTEGER,
    playstyle_id INTEGER,
    playstyle_name TEXT NOT NULL,
    category TEXT NOT NULL,
    is_plus INTEGER DEFAULT 0,
    PRIMARY KEY (player_id, playstyle_id, is_plus),
    FOREIGN KEY(player_id) REFERENCES players(player_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_fc_iq_roles (
    player_id INTEGER,
    position TEXT NOT NULL,
    role_name TEXT NOT NULL,
    mastery_level TEXT NOT NULL,
    focus TEXT,
    PRIMARY KEY (player_id, position, role_name),
    FOREIGN KEY(player_id) REFERENCES players(player_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_players_overall ON players(overall_rating DESC);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(common_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_players_league ON players(league_id);
CREATE INDEX IF NOT EXISTS idx_players_nationality ON players(nationality_id);
CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);
CREATE INDEX IF NOT EXISTS idx_playstyles_name ON player_playstyles(playstyle_name);
CREATE INDEX IF NOT EXISTS idx_fc_iq_roles ON player_fc_iq_roles(role_name, mastery_level);
`;
