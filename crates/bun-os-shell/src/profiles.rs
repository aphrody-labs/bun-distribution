//! Per-game profiles, play sessions and shell settings in `usr/var/lib/bep/shell.db`. The Bun half
//! (`packages/bun-engine/src/frontend/profiles.ts`) opens the same file through `bun:sqlite` with
//! the same schema, so `bun-engine library profile` and the shell edit one store.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS profiles (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  fps_limit INTEGER NOT NULL DEFAULT 0,
  scaler TEXT NOT NULL DEFAULT 'sharp',
  borderless INTEGER NOT NULL DEFAULT 1,
  instant_resume INTEGER NOT NULL DEFAULT 1,
  hud INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  seconds REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
";

/// Frame limits offered in the quick menu (0 = display rate).
pub const FPS_LIMITS: [u32; 7] = [0, 30, 40, 45, 60, 90, 120];
/// Scalers for Bun Engine machines: integer-sharp nearest, smooth bilinear, FSR1 when the engine
/// exposes its post-process node.
pub const SCALERS: [&str; 3] = ["sharp", "smooth", "fsr1"];

#[derive(Clone, Debug, PartialEq)]
pub struct Profile {
    pub key: String,
    pub fps_limit: u32,
    pub scaler: String,
    pub borderless: bool,
    pub instant_resume: bool,
    pub hud: bool,
}

impl Profile {
    pub fn new(key: &str) -> Self {
        Self {
            key: key.to_string(),
            fps_limit: 0,
            scaler: "sharp".into(),
            borderless: true,
            instant_resume: true,
            hud: false,
        }
    }
}

pub struct Store {
    db: Option<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Self {
        let db = Connection::open(path).ok().filter(|db| {
            let _ = db.pragma_update(None, "journal_mode", "WAL");
            db.execute_batch(SCHEMA).is_ok()
        });
        Self { db }
    }

    pub fn profile(&self, key: &str) -> Profile {
        let Some(db) = &self.db else {
            return Profile::new(key);
        };
        db.query_row(
            "SELECT fps_limit, scaler, borderless, instant_resume, hud FROM profiles WHERE key = ?1",
            params![key],
            |row| {
                Ok(Profile {
                    key: key.to_string(),
                    fps_limit: row.get::<_, i64>(0)?.max(0) as u32,
                    scaler: row.get(1)?,
                    borderless: row.get::<_, i64>(2)? != 0,
                    instant_resume: row.get::<_, i64>(3)? != 0,
                    hud: row.get::<_, i64>(4)? != 0,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
        .unwrap_or_else(|| Profile::new(key))
    }

    pub fn save(&self, profile: &Profile, title: &str) {
        let Some(db) = &self.db else { return };
        let _ = db.execute(
            "INSERT INTO profiles (key, title, fps_limit, scaler, borderless, instant_resume, hud, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET title = excluded.title, fps_limit = excluded.fps_limit,
               scaler = excluded.scaler, borderless = excluded.borderless,
               instant_resume = excluded.instant_resume, hud = excluded.hud, updated_at = excluded.updated_at",
            params![
                profile.key,
                title,
                i64::from(profile.fps_limit),
                profile.scaler,
                i64::from(profile.borderless),
                i64::from(profile.instant_resume),
                i64::from(profile.hud)
            ],
        );
    }

    pub fn record_session(&self, key: &str, kind: &str, seconds: f64) {
        if let Some(db) = &self.db {
            let _ = db.execute(
                "INSERT INTO sessions (key, kind, seconds) VALUES (?1, ?2, ?3)",
                params![key, kind, seconds],
            );
        }
    }

    /// Most recent sessions, newest first: (key, kind, started_at, seconds).
    pub fn recent(&self, limit: usize) -> Vec<(String, String, String, f64)> {
        let Some(db) = &self.db else {
            return Vec::new();
        };
        let Ok(mut statement) = db.prepare(
            "SELECT key, kind, MAX(started_at), SUM(seconds) FROM sessions GROUP BY key ORDER BY MAX(started_at) DESC LIMIT ?1",
        ) else {
            return Vec::new();
        };
        statement
            .query_map(params![limit as i64], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    }

    pub fn setting(&self, name: &str) -> Option<String> {
        self.db
            .as_ref()?
            .query_row(
                "SELECT value FROM settings WHERE name = ?1",
                params![name],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
    }

    pub fn set_setting(&self, name: &str, value: &str) {
        if let Some(db) = &self.db {
            let _ = db.execute(
                "INSERT INTO settings (name, value) VALUES (?1, ?2) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
                params![name, value],
            );
        }
    }
}
