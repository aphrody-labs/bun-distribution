// SPDX-License-Identifier: Apache-2.0
//! Durable local index, kept schema-compatible with `@aphrody/frames` 0.2.1.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{
    descriptor::{
        ColorLayoutVector, VECTOR_LENGTH, color_layout_distance, similarity_from_distance,
    },
    error::{FramesError, Result},
};

pub const DEFAULT_INDEX_PATH: &str = "~/.aphrody/workspaces/dbfr/indexes/frames.sqlite";

pub fn default_index_path() -> PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let legacy = home.join(".cache/bxc/frames.db");
    resolve_index_path(
        std::env::var_os("APHRODY_FRAMES_DB").map(PathBuf::from),
        std::env::var_os("BXC_FRAMES_DB").map(PathBuf::from),
        std::env::var_os("APHRODY_WORKSPACE").map(PathBuf::from),
        home,
        legacy.exists(),
    )
}

fn resolve_index_path(
    aphrody: Option<PathBuf>,
    legacy_override: Option<PathBuf>,
    workspace: Option<PathBuf>,
    home: PathBuf,
    legacy_exists: bool,
) -> PathBuf {
    if let Some(path) = aphrody {
        return path;
    }
    if let Some(path) = legacy_override {
        return path;
    }
    let legacy = home.join(".cache/bxc/frames.db");
    if legacy_exists {
        return legacy;
    }
    if let Some(workspace) = workspace {
        return workspace.join("indexes/frames.sqlite");
    }
    home.join(".aphrody/workspaces/dbfr/indexes/frames.sqlite")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaMeta {
    pub source: String,
    pub title: String,
    #[serde(default)]
    pub season: Option<i64>,
    #[serde(default)]
    pub episode: Option<i64>,
    #[serde(default)]
    pub duration_ms: i64,
    pub fps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaRow {
    pub id: i64,
    pub source: String,
    pub title: String,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub duration_ms: i64,
    pub fps: f64,
    pub frame_count: i64,
    pub indexed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FramesStats {
    pub path: String,
    pub media: i64,
    pub frames: i64,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneMatch {
    pub media_id: i64,
    pub source: String,
    pub title: String,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub from_ms: i64,
    pub at_ms: i64,
    pub to_ms: i64,
    pub duration_ms: i64,
    pub distance: f64,
    pub similarity: f64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SearchOptions {
    pub limit: Option<usize>,
    pub media_id: Option<i64>,
    pub min_similarity: Option<f64>,
}

pub struct FramesIndex {
    connection: Connection,
    path: PathBuf,
}

impl FramesIndex {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = expand_path(path.as_ref());
        if path != Path::new(":memory:")
            && let Some(parent) = path.parent()
        {
            std::fs::create_dir_all(parent)
                .map_err(|source| FramesError::Io { path: parent.to_owned(), source })?;
        }
        let connection = Connection::open(&path)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                season INTEGER,
                episode INTEGER,
                durationMs INTEGER NOT NULL DEFAULT 0,
                fps REAL NOT NULL,
                frameCount INTEGER NOT NULL DEFAULT 0,
                indexedAt INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS frames (
                mediaId INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
                tMs INTEGER NOT NULL,
                cl BLOB NOT NULL CHECK(length(cl) = 33),
                PRIMARY KEY (mediaId, tMs)
            ) WITHOUT ROWID;
            CREATE INDEX IF NOT EXISTS idx_media_episode ON media(season, episode);",
        )?;
        Ok(Self { connection, path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn open_default() -> Result<Self> {
        Self::open(default_index_path())
    }

    pub fn upsert_media(&mut self, meta: &MediaMeta) -> Result<i64> {
        if meta.source.trim().is_empty()
            || meta.title.trim().is_empty()
            || !meta.fps.is_finite()
            || meta.fps <= 0.0
        {
            return Err(FramesError::InvalidRequest(
                "media source/title must be non-empty and fps must be positive".into(),
            ));
        }
        let now = now_ms();
        self.connection.execute(
            "INSERT INTO media (source,title,season,episode,durationMs,fps,frameCount,indexedAt)
             VALUES (?1,?2,?3,?4,?5,?6,0,?7)
             ON CONFLICT(source) DO UPDATE SET title=excluded.title, season=excluded.season,
             episode=excluded.episode, durationMs=excluded.durationMs, fps=excluded.fps, indexedAt=excluded.indexedAt",
            params![meta.source, meta.title, meta.season, meta.episode, meta.duration_ms, meta.fps, now],
        )?;
        Ok(self.connection.query_row(
            "SELECT id FROM media WHERE source=?1",
            [&meta.source],
            |r| r.get(0),
        )?)
    }

    pub fn find_media(&self, source: &str) -> Result<Option<MediaRow>> {
        Ok(self.connection.query_row("SELECT id,source,title,season,episode,durationMs,fps,frameCount,indexedAt FROM media WHERE source=?1", [source], media_from_row).optional()?)
    }

    pub fn clear_frames(&mut self, media_id: i64) -> Result<()> {
        let tx = self.connection.transaction()?;
        tx.execute("DELETE FROM frames WHERE mediaId=?1", [media_id])?;
        tx.execute("UPDATE media SET frameCount=0 WHERE id=?1", [media_id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn insert_frames<I>(&mut self, media_id: i64, frames: I) -> Result<usize>
    where
        I: IntoIterator<Item = (i64, ColorLayoutVector)>,
    {
        let tx = self.connection.transaction()?;
        let mut statement =
            tx.prepare("INSERT OR REPLACE INTO frames (mediaId,tMs,cl) VALUES (?1,?2,?3)")?;
        let mut count = 0;
        for (time_ms, vector) in frames {
            if vector.len() != VECTOR_LENGTH {
                return Err(FramesError::InvalidVector(
                    "stored descriptor must have 33 bytes".into(),
                ));
            }
            statement.execute(params![media_id, time_ms, vector.as_slice()])?;
            count += 1;
        }
        drop(statement);
        tx.execute("UPDATE media SET frameCount=(SELECT COUNT(*) FROM frames WHERE mediaId=?1) WHERE id=?1", [media_id])?;
        tx.commit()?;
        Ok(count)
    }

    /// Atomically replaces one media row's metadata and frame set after extraction succeeds.
    pub fn replace_media_frames<I>(&mut self, meta: &MediaMeta, frames: I) -> Result<(i64, usize)>
    where
        I: IntoIterator<Item = (i64, ColorLayoutVector)>,
    {
        if meta.source.trim().is_empty()
            || meta.title.trim().is_empty()
            || !meta.fps.is_finite()
            || meta.fps <= 0.0
            || meta.duration_ms <= 0
        {
            return Err(FramesError::InvalidRequest(
                "media source/title must be non-empty; duration and fps must be positive".into(),
            ));
        }
        let now = now_ms();
        let tx = self.connection.transaction()?;
        tx.execute(
            "INSERT INTO media (source,title,season,episode,durationMs,fps,frameCount,indexedAt)
             VALUES (?1,?2,?3,?4,?5,?6,0,?7)
             ON CONFLICT(source) DO UPDATE SET title=excluded.title, season=excluded.season,
             episode=excluded.episode, durationMs=excluded.durationMs, fps=excluded.fps, indexedAt=excluded.indexedAt",
            params![meta.source, meta.title, meta.season, meta.episode, meta.duration_ms, meta.fps, now],
        )?;
        let media_id: i64 =
            tx.query_row("SELECT id FROM media WHERE source=?1", [&meta.source], |row| row.get(0))?;
        tx.execute("DELETE FROM frames WHERE mediaId=?1", [media_id])?;
        let mut statement =
            tx.prepare("INSERT OR REPLACE INTO frames (mediaId,tMs,cl) VALUES (?1,?2,?3)")?;
        let mut count = 0;
        for (time_ms, vector) in frames {
            statement.execute(params![media_id, time_ms, vector.as_slice()])?;
            count += 1;
        }
        drop(statement);
        tx.execute("UPDATE media SET frameCount=?2 WHERE id=?1", params![media_id, count as i64])?;
        tx.commit()?;
        Ok((media_id, count))
    }

    pub fn list(&self, filter: Option<&str>) -> Result<Vec<MediaRow>> {
        let mut statement = self.connection.prepare("SELECT id,source,title,season,episode,durationMs,fps,frameCount,indexedAt FROM media ORDER BY season,episode,id")?;
        let rows = statement.query_map([], media_from_row)?;
        let needle = filter.map(str::to_lowercase);
        let mut media = Vec::new();
        for row in rows {
            let row = row?;
            if needle.as_ref().is_none_or(|n| {
                row.source.to_lowercase().contains(n) || row.title.to_lowercase().contains(n)
            }) {
                media.push(row);
            }
        }
        Ok(media)
    }

    pub fn stats(&self) -> Result<FramesStats> {
        let (media, frames, duration_ms) = self.connection.query_row(
            "SELECT (SELECT COUNT(*) FROM media),(SELECT COUNT(*) FROM frames),(SELECT COALESCE(SUM(durationMs),0) FROM media)", [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        Ok(FramesStats { path: self.path.display().to_string(), media, frames, duration_ms })
    }

    pub fn search(
        &self,
        vector: &ColorLayoutVector,
        options: SearchOptions,
    ) -> Result<Vec<SceneMatch>> {
        let limit = options.limit.unwrap_or(5).clamp(1, 100);
        let mut best: HashMap<i64, (i64, f64)> = HashMap::new();
        let mut statement = if options.media_id.is_some() {
            self.connection
                .prepare("SELECT mediaId,tMs,cl FROM frames WHERE mediaId=?1 ORDER BY tMs")?
        } else {
            self.connection.prepare("SELECT mediaId,tMs,cl FROM frames ORDER BY mediaId,tMs")?
        };
        let mut rows = match options.media_id {
            Some(id) => statement.query([id])?,
            None => statement.query([])?,
        };
        while let Some(row) = rows.next()? {
            let media_id: i64 = row.get(0)?;
            let time_ms: i64 = row.get(1)?;
            let bytes: Vec<u8> = row.get(2)?;
            if bytes.len() != VECTOR_LENGTH {
                continue;
            }
            let distance = color_layout_distance(vector, &bytes)?;
            if best.get(&media_id).is_none_or(|(_, old)| distance < *old) {
                best.insert(media_id, (time_ms, distance));
            }
        }
        drop(rows);
        drop(statement);
        let mut ranked: Vec<_> = best.into_iter().collect();
        ranked.sort_by(|a, b| a.1.1.total_cmp(&b.1.1).then_with(|| a.0.cmp(&b.0)));
        ranked.truncate(limit);
        let mut matches = Vec::new();
        for (media_id, (at_ms, distance)) in ranked {
            let similarity = similarity_from_distance(distance);
            if similarity < options.min_similarity.unwrap_or(0.0) {
                continue;
            }
            let media = match self.connection.query_row("SELECT id,source,title,season,episode,durationMs,fps,frameCount,indexedAt FROM media WHERE id=?1", [media_id], media_from_row).optional()? { Some(row) => row, None => continue };
            let (from_ms, to_ms) =
                self.expand_scene(vector, media_id, at_ms, distance, media.fps)?;
            matches.push(SceneMatch {
                media_id,
                source: media.source,
                title: media.title,
                season: media.season,
                episode: media.episode,
                from_ms,
                at_ms,
                to_ms,
                duration_ms: media.duration_ms,
                distance,
                similarity,
            });
        }
        Ok(matches)
    }

    fn expand_scene(
        &self,
        query: &ColorLayoutVector,
        media_id: i64,
        at_ms: i64,
        distance: f64,
        fps: f64,
    ) -> Result<(i64, i64)> {
        let interval = if fps > 0.0 { (1000.0 / fps).round() as i64 } else { 1000 };
        let max_gap = (interval as f64 * 1.5) as i64;
        let threshold = distance + 15.0;
        let mut statement = self.connection.prepare(
            "SELECT tMs,cl FROM frames WHERE mediaId=?1 AND tMs BETWEEN ?2 AND ?3 ORDER BY tMs",
        )?;
        let rows = statement
            .query_map(params![media_id, at_ms - 30_000, at_ms + 30_000], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
            })?;
        let mut frames = Vec::new();
        for row in rows {
            frames.push(row?);
        }
        let pivot = match frames.iter().position(|(t, _)| *t == at_ms) {
            Some(i) => i,
            None => return Ok((at_ms, at_ms)),
        };
        let mut from_ms = at_ms;
        for (time, data) in frames[..pivot].iter().rev() {
            if from_ms - time > max_gap
                || data.len() != VECTOR_LENGTH
                || color_layout_distance(query, data)? > threshold
            {
                break;
            }
            from_ms = *time;
        }
        let mut to_ms = at_ms;
        for (time, data) in frames.iter().skip(pivot + 1) {
            if time - to_ms > max_gap
                || data.len() != VECTOR_LENGTH
                || color_layout_distance(query, data)? > threshold
            {
                break;
            }
            to_ms = *time;
        }
        Ok((from_ms, to_ms))
    }
}

fn media_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaRow> {
    Ok(MediaRow {
        id: row.get(0)?,
        source: row.get(1)?,
        title: row.get(2)?,
        season: row.get(3)?,
        episode: row.get(4)?,
        duration_ms: row.get(5)?,
        fps: row.get(6)?,
        frame_count: row.get(7)?,
        indexed_at: row.get(8)?,
    })
}
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn expand_path(path: &Path) -> PathBuf {
    if path == Path::new(":memory:") {
        return path.to_owned();
    }
    let text = path.to_string_lossy();
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        if text == "~" {
            return PathBuf::from(home);
        }
        if let Some(rest) = text.strip_prefix("~/") {
            return PathBuf::from(home).join(rest);
        }
    }
    path.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_vectors_and_filters_list() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("frames.db");
        let mut index = FramesIndex::open(&path).unwrap();
        let media_id = index
            .upsert_media(&MediaMeta {
                source: "dbz-001.mkv".into(),
                title: "Dragon Ball Z 1".into(),
                season: Some(1),
                episode: Some(1),
                duration_ms: 10_000,
                fps: 1.0,
            })
            .unwrap();
        let a = [0_u8; VECTOR_LENGTH];
        let b = [0_u8; VECTOR_LENGTH];
        assert_eq!(index.insert_frames(media_id, [(0, a), (1000, b)]).unwrap(), 2);
        assert_eq!(index.stats().unwrap().frames, 2);
        assert_eq!(index.list(Some("dragon ball")).unwrap().len(), 1);
        let results = index.search(&a, SearchOptions::default()).unwrap();
        assert_eq!(results[0].similarity, 1.0);
        assert_eq!((results[0].from_ms, results[0].to_ms), (0, 1000));
    }

    #[test]
    fn default_path_prefers_explicit_owner_config_and_preserves_existing_legacy_store() {
        let home = PathBuf::from("/home/test-user");
        assert_eq!(
            resolve_index_path(
                Some("/owner/frames.db".into()),
                Some("/legacy/env.db".into()),
                None,
                home.clone(),
                true
            ),
            PathBuf::from("/owner/frames.db")
        );
        assert_eq!(
            resolve_index_path(
                None,
                None,
                Some("/home/test-user/.aphrody/workspaces/dbfr".into()),
                home.clone(),
                true
            ),
            PathBuf::from("/home/test-user/.cache/bxc/frames.db")
        );
        assert_eq!(
            resolve_index_path(None, None, Some("/configured/dbfr".into()), home.clone(), false),
            PathBuf::from("/configured/dbfr/indexes/frames.sqlite")
        );
        assert_eq!(
            resolve_index_path(None, None, None, home, false),
            PathBuf::from("/home/test-user/.aphrody/workspaces/dbfr/indexes/frames.sqlite")
        );
    }
}
