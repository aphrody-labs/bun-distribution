// SPDX-License-Identifier: Apache-2.0
//! Queryable SQLite index of the converted DBXV2 outputs (feature `dbxv2`).
//!
//! Same schema and database path as the dbxv2 Python `index` command
//! (`<out>/index/dbxv2_index.db`): an `asset` table (one row per PNG/WAV/EMD/MSG JSON/gameplay
//! JSON output, with its semantic classification) and an FTS5 `strings` table holding the
//! localized text. `classify`, `search` and `stats` operate on that database.

use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, params};
use serde_json::{Value, json};

use crate::game::{ReError, Result};

const SCHEMA: &str = "
    CREATE TABLE asset(id INTEGER PRIMARY KEY, dir TEXT, path TEXT, name TEXT,
                       ext TEXT, category TEXT, bytes INTEGER,
                       domain TEXT, subdomain TEXT, entity TEXT);
    CREATE INDEX ix_cat ON asset(category);
    CREATE INDEX ix_ext ON asset(ext);
    CREATE INDEX ix_dir ON asset(dir);
    CREATE INDEX ix_dom ON asset(domain);
    CREATE INDEX ix_ent ON asset(entity);
    CREATE VIRTUAL TABLE strings USING fts5(dir, file, text);
";

/// Gameplay formats whose `<file>.<ext>.json` outputs are indexed.
const GAMEPLAY: [&str; 8] = ["bac", "bcm", "bcs", "bdm", "bsa", "ean", "emm", "esk"];

const DOMAINS: [(&str, &str); 12] = [
    ("chara", "character"),
    ("skill", "skill"),
    ("sound", "sound"),
    ("ui", "ui"),
    ("vfx", "effect"),
    ("stage", "stage"),
    ("msg", "text"),
    ("demo", "demo"),
    ("lighting", "lighting"),
    ("event", "event"),
    ("system", "system"),
    ("shot", "shot"),
];

/// Create-a-Character race codes of `chara/`.
const RACES: [(&str, &str); 8] = [
    ("HUM", "Human (M)"),
    ("HUF", "Human (F)"),
    ("SYM", "Saiyan (M)"),
    ("SYF", "Saiyan (F)"),
    ("NMC", "Namekian"),
    ("FRI", "Frieza Race"),
    ("MAM", "Majin (M)"),
    ("MAF", "Majin (F)"),
];

/// Roster character codes of `chara/`.
const ROSTER: [(&str, &str); 27] = [
    ("GOK", "Goku"),
    ("VGT", "Vegeta"),
    ("VEG", "Vegeta"),
    ("PIC", "Piccolo"),
    ("GHN", "Gohan"),
    ("GHS", "Gohan (Teen)"),
    ("GHL", "Gohan (Adult)"),
    ("TRX", "Trunks"),
    ("TRS", "Trunks (Xeno)"),
    ("KRI", "Krillin"),
    ("KUR", "Krillin"),
    ("TEN", "Tien"),
    ("YMC", "Yamcha"),
    ("BRL", "Broly"),
    ("BDK", "Bardock"),
    ("FZ2", "Frieza"),
    ("FRZ", "Frieza"),
    ("CEL", "Cell"),
    ("BUU", "Majin Buu"),
    ("GTN", "Gotenks"),
    ("GGT", "Gogeta"),
    ("VGB", "Vegeta (Blue)"),
    ("BGK", "Beerus"),
    ("BEE", "Beerus"),
    ("WIS", "Whis"),
    ("HIT", "Hit"),
    ("JRN", "Jiren"),
];

/// Skill type codes of `skill/`.
const SKILLS: [(&str, &str); 9] = [
    ("SPA", "Super"),
    ("ULT", "Ultimate"),
    ("EVA", "Evasive"),
    ("ESC", "Evasive"),
    ("BLT", "Blast"),
    ("AWA", "Awoken"),
    ("MET", "Awoken (transformation)"),
    ("KBT", "Kiai"),
    ("CMN", "Common"),
];

/// Sound family codes of `sound/`.
const SOUNDS: [(&str, &str); 6] = [
    ("VOX", "Voice"),
    ("SE", "Sound effects"),
    ("BGM", "Music"),
    ("PV", "Promo videos"),
    ("BTL", "Battle"),
    ("SYS", "System"),
];

fn lookup(table: &[(&'static str, &'static str)], key: &str) -> Option<&'static str> {
    table
        .iter()
        .find(|(code, _)| *code == key)
        .map(|(_, name)| *name)
}

/// Semantic classification of an output path `cpk/<tree>/[data/]<domain>/<sub>/...`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Classification {
    pub domain: String,
    pub subdomain: Option<String>,
    pub entity: Option<String>,
}

/// Classify one asset path (relative to the output root) of CPK tree `tree`.
pub fn classify(path: &str, tree: &str) -> Classification {
    let parts: Vec<&str> = path.split('/').collect();
    let mut rest: &[&str] = parts.get(2..).unwrap_or(&[]);
    if rest.first() == Some(&"data") {
        rest = &rest[1..];
    }
    if tree.to_lowercase().contains("bgm") {
        return Classification {
            domain: "sound".into(),
            subdomain: Some("Music".into()),
            entity: None,
        };
    }
    let segment = rest.first().copied().unwrap_or("");
    let sub = rest.get(1).copied().unwrap_or("");
    let domain = lookup(&DOMAINS, segment).unwrap_or("other");
    let non_empty = |value: &str| (!value.is_empty()).then(|| value.to_owned());
    let (subdomain, entity) = match domain {
        "character" => {
            let kind = if lookup(&RACES, sub).is_some() {
                "CaC race"
            } else if lookup(&ROSTER, sub).is_some() {
                "Character"
            } else {
                "Other"
            };
            let entity = non_empty(sub).map(|code| {
                lookup(&RACES, &code)
                    .or_else(|| lookup(&ROSTER, &code))
                    .map_or(code, str::to_owned)
            });
            (Some(kind.to_owned()), entity)
        }
        "skill" => (
            lookup(&SKILLS, sub)
                .map(str::to_owned)
                .or_else(|| non_empty(sub)),
            None,
        ),
        "sound" => (
            lookup(&SOUNDS, sub)
                .map(str::to_owned)
                .or_else(|| non_empty(sub)),
            None,
        ),
        "ui" | "effect" | "stage" | "demo" => (non_empty(sub), None),
        _ => (None, None),
    };
    Classification {
        domain: domain.to_owned(),
        subdomain,
        entity,
    }
}

/// Category and extension of an indexed output, as the Python `index` command assigns them.
fn output_category(name: &str) -> Option<(&'static str, String)> {
    let lower = name.to_lowercase();
    if lower.ends_with(".png") {
        return Some(("texture", "png".into()));
    }
    if lower.ends_with(".wav") {
        return Some(("audio", "wav".into()));
    }
    if lower.ends_with(".emd") {
        return Some(("model", "emd".into()));
    }
    if lower.ends_with(".msg.json") {
        return Some(("text", "msg".into()));
    }
    if lower.ends_with(".json") {
        let parts: Vec<&str> = lower.split('.').collect();
        if parts.len() >= 3 && GAMEPLAY.contains(&parts[parts.len() - 2]) {
            return Some(("gameplay", parts[parts.len() - 2].to_owned()));
        }
    }
    None
}

/// Database path for an output root.
pub fn index_path(out: &Path) -> PathBuf {
    out.join("index").join("dbxv2_index.db")
}

fn sql(error: rusqlite::Error) -> ReError {
    ReError::ParseError {
        context: "dbxv2_index",
        details: error.to_string(),
    }
}

/// `index`: rebuild `<out>/index/dbxv2_index.db` from every `<out>/cpk/<tree>`.
pub fn build_index(out: &Path) -> Result<Value> {
    let database = index_path(out);
    if let Some(parent) = database.parent() {
        fs::create_dir_all(parent)?;
    }
    if database.exists() {
        fs::remove_file(&database)?;
    }
    let mut connection = Connection::open(&database).map_err(sql)?;
    connection.execute_batch(SCHEMA).map_err(sql)?;
    let transaction = connection.transaction().map_err(sql)?;
    let (mut assets, mut strings) = (0usize, 0usize);
    {
        let mut insert_asset = transaction
            .prepare(
                "INSERT INTO asset(dir,path,name,ext,category,bytes,domain,subdomain,entity) \
                 VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .map_err(sql)?;
        let mut insert_string = transaction
            .prepare("INSERT INTO strings(dir,file,text) VALUES(?,?,?)")
            .map_err(sql)?;
        let mut trees: Vec<PathBuf> = fs::read_dir(out.join("cpk"))
            .into_iter()
            .flatten()
            .flatten()
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .map(|entry| entry.path())
            .collect();
        trees.sort();
        for tree in trees {
            let tree_name = tree
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            for path in crate::game::convert::walk_files(&tree, &|_| true)? {
                let name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let Some((category, extension)) = output_category(&name) else {
                    continue;
                };
                let relative = path
                    .strip_prefix(out)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                let semantic = classify(&relative, &tree_name);
                let bytes = fs::metadata(&path)?.len() as i64;
                insert_asset
                    .execute(params![
                        tree_name,
                        relative,
                        name,
                        extension,
                        category,
                        bytes,
                        semantic.domain,
                        semantic.subdomain,
                        semantic.entity
                    ])
                    .map_err(sql)?;
                assets += 1;
                if category == "text" {
                    let parsed: Value = fs::read(&path)
                        .ok()
                        .and_then(|raw| serde_json::from_slice(&raw).ok())
                        .unwrap_or(Value::Null);
                    for text in parsed
                        .get("strings")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                    {
                        if let Some(text) = text.as_str() {
                            insert_string
                                .execute(params![tree_name, name, text])
                                .map_err(sql)?;
                            strings += 1;
                        }
                    }
                }
            }
        }
    }
    transaction.commit().map_err(sql)?;
    Ok(json!({ "db": database.to_string_lossy(), "assets": assets, "strings": strings }))
}

fn open_existing(out: &Path) -> Result<Connection> {
    let database = index_path(out);
    if !database.exists() {
        return Err(ReError::ParseError {
            context: "dbxv2_index",
            details: format!(
                "index missing: {} (run `bunre dbxv2 index` first)",
                database.display()
            ),
        });
    }
    Connection::open(database).map_err(sql)
}

/// `classify`: add the semantic columns if missing and recompute them for every asset.
pub fn reclassify(out: &Path) -> Result<Value> {
    let mut connection = open_existing(out)?;
    let existing: Vec<String> = connection
        .prepare("PRAGMA table_info(asset)")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<rusqlite::Result<_>>()
        })
        .map_err(sql)?;
    for column in ["domain", "subdomain", "entity"] {
        if !existing.iter().any(|name| name == column) {
            connection
                .execute(&format!("ALTER TABLE asset ADD COLUMN {column} TEXT"), [])
                .map_err(sql)?;
        }
    }
    connection
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS ix_dom ON asset(domain);
             CREATE INDEX IF NOT EXISTS ix_ent ON asset(entity);",
        )
        .map_err(sql)?;
    let rows: Vec<(i64, String, String)> = connection
        .prepare("SELECT id,path,dir FROM asset")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect()
        })
        .map_err(sql)?;
    let transaction = connection.transaction().map_err(sql)?;
    {
        let mut update = transaction
            .prepare("UPDATE asset SET domain=?,subdomain=?,entity=? WHERE id=?")
            .map_err(sql)?;
        for (id, path, tree) in &rows {
            let semantic = classify(path, tree);
            update
                .execute(params![
                    semantic.domain,
                    semantic.subdomain,
                    semantic.entity,
                    id
                ])
                .map_err(sql)?;
        }
    }
    transaction.commit().map_err(sql)?;
    let domains = grouped(
        &connection,
        "SELECT domain,count(*) FROM asset GROUP BY domain ORDER BY 2 DESC",
    )?;
    Ok(json!({ "classified": rows.len(), "domains": domains }))
}

fn grouped(connection: &Connection, query: &str) -> Result<Vec<Value>> {
    connection
        .prepare(query)
        .and_then(|mut statement| {
            statement
                .query_map([], |row| {
                    Ok(json!([
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, i64>(1)?
                    ]))
                })?
                .collect()
        })
        .map_err(sql)
}

/// `search`: FTS5 match on localized text plus a `LIKE` match on asset names.
pub fn search(out: &Path, query: &str, limit: usize) -> Result<Value> {
    let connection = open_existing(out)?;
    let limit = limit as i64;
    let texts: std::result::Result<Vec<Value>, String> = connection
        .prepare("SELECT dir,file,text FROM strings WHERE strings MATCH ? LIMIT ?")
        .and_then(|mut statement| {
            statement
                .query_map(params![query, limit], |row| {
                    Ok(json!({ "dir": row.get::<_, String>(0)?, "file": row.get::<_, String>(1)?, "text": row.get::<_, String>(2)? }))
                })?
                .collect()
        })
        .map_err(|error| error.to_string());
    let assets: Vec<Value> = connection
        .prepare("SELECT path,category FROM asset WHERE name LIKE ? LIMIT ?")
        .and_then(|mut statement| {
            statement
                .query_map(params![format!("%{query}%"), limit], |row| {
                    Ok(json!({ "path": row.get::<_, String>(0)?, "category": row.get::<_, String>(1)? }))
                })?
                .collect()
        })
        .map_err(sql)?;
    Ok(match texts {
        Ok(texts) => json!({ "query": query, "texts": texts, "assets": assets }),
        Err(error) => json!({ "query": query, "texts": [], "ftsError": error, "assets": assets }),
    })
}

/// `stats`: assets per category (count, bytes), gameplay per format, top trees, FTS strings.
pub fn stats(out: &Path) -> Result<Value> {
    let connection = open_existing(out)?;
    let categories: Vec<Value> = connection
        .prepare("SELECT category,count(*),COALESCE(sum(bytes),0) FROM asset GROUP BY category ORDER BY 2 DESC")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| {
                    Ok(json!({ "category": row.get::<_, String>(0)?, "count": row.get::<_, i64>(1)?, "bytes": row.get::<_, i64>(2)? }))
                })?
                .collect()
        })
        .map_err(sql)?;
    let gameplay = grouped(
        &connection,
        "SELECT ext,count(*) FROM asset WHERE category='gameplay' GROUP BY ext ORDER BY 2 DESC",
    )?;
    let trees = grouped(
        &connection,
        "SELECT dir,count(*) FROM asset GROUP BY dir ORDER BY 2 DESC LIMIT 10",
    )?;
    let strings: i64 = connection
        .query_row("SELECT count(*) FROM strings", [], |row| row.get(0))
        .map_err(sql)?;
    Ok(
        json!({ "categories": categories, "gameplay": gameplay, "topDirs": trees, "strings": strings }),
    )
}

#[cfg(test)]
mod tests {
    use super::classify;

    #[test]
    fn classifies_like_the_python_taxonomy() {
        let goku = classify("cpk/data/data/chara/GOK/GOK_000.emd", "data");
        assert_eq!(goku.domain, "character");
        assert_eq!(goku.subdomain.as_deref(), Some("Character"));
        assert_eq!(goku.entity.as_deref(), Some("Goku"));
        let bgm = classify("cpk/data_d7_bgm2/data/sound/BGM/x.wav", "data_d7_bgm2");
        assert_eq!(bgm.subdomain.as_deref(), Some("Music"));
        let other = classify("cpk/data2/ui/iggy/a.png", "data2");
        assert_eq!(other.domain, "ui");
        assert_eq!(other.subdomain.as_deref(), Some("iggy"));
    }
}
