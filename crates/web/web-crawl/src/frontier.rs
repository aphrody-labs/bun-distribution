// SPDX-License-Identifier: Apache-2.0

use std::collections::HashSet;
use std::path::Path;

use aphrody_web_extract::{UrlNormalizationOptions, hamming_distance, normalize_page_url};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use url::Url;

use crate::revisit::{
    ChangeHistory, RevisitPolicy, estimate_change_rate, revisit_interval_ms, revisit_priority,
};
use crate::scoring::{anchor_relevance, frontier_score};

const SCHEMA: &str = "
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS requests (
 id INTEGER PRIMARY KEY,
 url TEXT NOT NULL UNIQUE,
 host TEXT NOT NULL,
 family TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','locked','done','failed')),
 depth INTEGER NOT NULL,
 priority INTEGER NOT NULL,
 score REAL NOT NULL,
 base_score REAL NOT NULL DEFAULT 0,
 opic_cash REAL NOT NULL DEFAULT 1,
 opic_history REAL NOT NULL DEFAULT 0,
 anchor_text TEXT,
 boost REAL NOT NULL DEFAULT 0,
 retries INTEGER NOT NULL DEFAULT 0,
 locked_at INTEGER,
 last_error TEXT,
 created_at INTEGER NOT NULL,
 fetch_count INTEGER NOT NULL DEFAULT 0,
 change_count INTEGER NOT NULL DEFAULT 0,
 first_fetched_at INTEGER,
 last_fetched_at INTEGER,
 next_fetch_at INTEGER,
 change_rate REAL,
 content_hash TEXT,
 revisit_priority REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS requests_ready ON requests(state, priority DESC, score DESC, id)
 WHERE state='pending';
CREATE TABLE IF NOT EXISTS hosts (
 host TEXT PRIMARY KEY,
 in_flight INTEGER NOT NULL DEFAULT 0,
 next_allowed_at INTEGER NOT NULL DEFAULT 0,
 last_locked_at INTEGER NOT NULL DEFAULT 0,
 delay_ms INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pages (
 url TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 markdown TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 simhash INTEGER NOT NULL,
 band0 INTEGER NOT NULL,
 band1 INTEGER NOT NULL,
 band2 INTEGER NOT NULL,
 band3 INTEGER NOT NULL,
 fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pages_hash ON pages(content_hash);
";

const REQUEST_MIGRATIONS: &[(&str, &str)] = &[
    ("base_score", "REAL NOT NULL DEFAULT 0"),
    ("opic_cash", "REAL NOT NULL DEFAULT 1"),
    ("opic_history", "REAL NOT NULL DEFAULT 0"),
    ("anchor_text", "TEXT"),
    ("boost", "REAL NOT NULL DEFAULT 0"),
    ("fetch_count", "INTEGER NOT NULL DEFAULT 0"),
    ("change_count", "INTEGER NOT NULL DEFAULT 0"),
    ("first_fetched_at", "INTEGER"),
    ("last_fetched_at", "INTEGER"),
    ("next_fetch_at", "INTEGER"),
    ("change_rate", "REAL"),
    ("content_hash", "TEXT"),
    ("revisit_priority", "REAL NOT NULL DEFAULT 0"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestState {
    Pending,
    Locked,
    Done,
    Failed,
}

#[derive(Debug, Clone)]
pub struct FrontierOptions {
    pub per_host_delay_ms: i64,
    pub max_in_flight_per_host: u32,
    pub lock_timeout_ms: i64,
    pub max_retries: u32,
    pub near_duplicate_bits: u32,
    pub goal: Option<String>,
    pub enable_revisits: bool,
    pub revisit_policy: RevisitPolicy,
}

impl Default for FrontierOptions {
    fn default() -> Self {
        Self {
            per_host_delay_ms: 0,
            max_in_flight_per_host: 8,
            lock_timeout_ms: 120_000,
            max_retries: 3,
            near_duplicate_bits: 3,
            goal: None,
            enable_revisits: false,
            revisit_policy: RevisitPolicy::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AddRequest {
    pub url: String,
    pub depth: u32,
    pub priority: bool,
    pub boost: f64,
}

impl AddRequest {
    #[must_use]
    pub fn seed(url: impl Into<String>) -> Self {
        Self { url: url.into(), depth: 0, priority: false, boost: 0.0 }
    }
}

#[derive(Debug, Clone)]
pub struct Lease {
    pub id: i64,
    pub url: Url,
    pub depth: u32,
    pub retries: u32,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct FrontierStats {
    pub pending: u64,
    pub locked: u64,
    pub done: u64,
    pub failed: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoredPage {
    New,
    ExactDuplicate,
    NearDuplicate,
}

pub struct Frontier {
    db: Connection,
    options: FrontierOptions,
}

impl Frontier {
    pub fn open(
        path: impl AsRef<Path>,
        options: FrontierOptions,
        now_ms: i64,
    ) -> rusqlite::Result<Self> {
        if let Some(parent) = path.as_ref().parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)
                .map_err(|error| rusqlite::Error::InvalidParameterName(error.to_string()))?;
        }
        let db = Connection::open(path)?;
        db.execute_batch(SCHEMA)?;
        migrate_schema(&db)?;
        let mut frontier = Self { db, options: normalize_options(options) };
        frontier.recover_stale(now_ms)?;
        Ok(frontier)
    }

    pub fn memory(options: FrontierOptions) -> rusqlite::Result<Self> {
        let db = Connection::open_in_memory()?;
        db.execute_batch(SCHEMA)?;
        migrate_schema(&db)?;
        Ok(Self { db, options: normalize_options(options) })
    }

    pub fn enqueue(&mut self, request: AddRequest, now_ms: i64) -> rusqlite::Result<bool> {
        self.enqueue_with_anchor(request, None, now_ms)
    }

    pub fn enqueue_with_anchor(
        &mut self,
        request: AddRequest,
        anchor_text: Option<&str>,
        now_ms: i64,
    ) -> rusqlite::Result<bool> {
        let url = normalize_page_url(&request.url, None, UrlNormalizationOptions::default())
            .map_err(|error| rusqlite::Error::InvalidParameterName(error.to_string()))?;
        let host = url.host_str().unwrap_or_default().to_owned();
        let family = family_key(&url);
        let depth = i64::from(request.depth);
        let family_done: u32 = self.db.query_row(
            "SELECT COUNT(*) FROM requests WHERE family=?1 AND state='done'",
            [&family],
            |row| row.get(0),
        )?;
        let relevance = self
            .options
            .goal
            .as_deref()
            .map_or(0.0, |goal| anchor_relevance(goal, anchor_text, &url));
        let base_score = frontier_score(1.0, relevance, request.depth, request.boost, 0);
        let score = frontier_score(1.0, relevance, request.depth, request.boost, family_done);
        let inserted = self.db.execute(
            "INSERT OR IGNORE INTO requests(url,host,family,state,depth,priority,score,base_score,opic_cash,anchor_text,boost,created_at)
             VALUES(?1,?2,?3,'pending',?4,?5,?6,?7,1,?8,?9,?10)",
            params![url.as_str(), host, family, depth, i64::from(request.priority), score, base_score, anchor_text, request.boost, now_ms],
        )? > 0;
        Ok(inserted)
    }

    /// Request a fresh acquisition while retaining this frontier's per-host pacing state.
    /// Pending or actively leased requests are left intact.
    pub fn enqueue_or_refresh(&mut self, request: AddRequest, now_ms: i64) -> rusqlite::Result<()> {
        let url = normalize_page_url(&request.url, None, UrlNormalizationOptions::default())
            .map_err(|error| rusqlite::Error::InvalidParameterName(error.to_string()))?;
        self.enqueue(request, now_ms)?;
        self.db.execute(
            "UPDATE requests SET state='pending',retries=0,locked_at=NULL,last_error=NULL WHERE url=?1 AND state IN ('done','failed')",
            [url.as_str()],
        )?;
        Ok(())
    }

    pub fn enqueue_many(
        &mut self,
        requests: impl IntoIterator<Item = AddRequest>,
        now_ms: i64,
    ) -> rusqlite::Result<usize> {
        let mut prepared = Vec::new();
        for request in requests {
            let url = normalize_page_url(&request.url, None, UrlNormalizationOptions::default())
                .map_err(|error| rusqlite::Error::InvalidParameterName(error.to_string()))?;
            let host = url.host_str().unwrap_or_default().to_owned();
            let family = family_key(&url);
            let depth = i64::from(request.depth);
            let relevance =
                self.options.goal.as_deref().map_or(0.0, |goal| anchor_relevance(goal, None, &url));
            let base_score = frontier_score(1.0, relevance, request.depth, request.boost, 0);
            prepared.push((
                url,
                host,
                family,
                depth,
                i64::from(request.priority),
                base_score,
                request.boost,
            ));
        }
        let tx = self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut count = 0;
        for (url, host, family, depth, priority, base_score, boost) in prepared {
            let family_done: u32 = tx.query_row(
                "SELECT COUNT(*) FROM requests WHERE family=?1 AND state='done'",
                [&family],
                |row| row.get(0),
            )?;
            let score = base_score - (0.25 * f64::from(family_done)).min(1.0);
            count += tx.execute(
                "INSERT OR IGNORE INTO requests(url,host,family,state,depth,priority,score,base_score,opic_cash,boost,created_at)
                 VALUES(?1,?2,?3,'pending',?4,?5,?6,?7,1,?8,?9)",
                params![url.as_str(), host, family, depth, priority, score, base_score, boost, now_ms],
            )?;
        }
        tx.commit()?;
        Ok(count)
    }

    /// Split a page's remaining OPIC cash evenly across unique discovered links.
    /// Existing requests receive their share without being inserted twice.
    pub fn enqueue_children(
        &mut self,
        parent: &Lease,
        children: impl IntoIterator<Item = (Url, String)>,
        now_ms: i64,
    ) -> rusqlite::Result<usize> {
        let mut unique = std::collections::BTreeMap::<String, (Url, String)>::new();
        for (url, anchor) in children {
            if url != parent.url {
                unique.entry(url.to_string()).or_insert((url, anchor));
            }
        }
        if unique.is_empty() {
            return Ok(0);
        }
        let tx = self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let cash: f64 =
            tx.query_row("SELECT opic_cash FROM requests WHERE id=?1", [parent.id], |row| {
                row.get(0)
            })?;
        let share = cash / unique.len() as f64;
        let mut inserted = 0;
        for (key, (url, anchor)) in unique {
            let host = url.host_str().unwrap_or_default();
            let family = family_key(&url);
            let family_done: u32 = tx.query_row(
                "SELECT COUNT(*) FROM requests WHERE family=?1 AND state='done'",
                [&family],
                |row| row.get(0),
            )?;
            let depth = parent.depth.saturating_add(1);
            let relevance = self
                .options
                .goal
                .as_deref()
                .map_or(0.0, |goal| anchor_relevance(goal, Some(&anchor), &url));
            let base_score = frontier_score(share, relevance, depth, 0.0, 0);
            let score = base_score - (0.25 * f64::from(family_done)).min(1.0);
            let changed = tx.execute(
                "INSERT OR IGNORE INTO requests(url,host,family,state,depth,priority,score,base_score,opic_cash,anchor_text,created_at)
                 VALUES(?1,?2,?3,'pending',?4,0,?5,?6,?7,?8,?9)",
                params![key, host, family, depth, score, base_score, share, anchor, now_ms],
            )?;
            if changed > 0 {
                inserted += 1;
            } else if share > 0.0 {
                tx.execute("UPDATE requests SET opic_cash=opic_cash+?2,base_score=base_score+?2,score=score+?2 WHERE url=?1", params![key, share])?;
            }
        }
        tx.execute(
            "UPDATE requests SET opic_history=opic_history+opic_cash,opic_cash=0 WHERE id=?1",
            [parent.id],
        )?;
        tx.commit()?;
        Ok(inserted)
    }

    /// Update the delay learned from robots.txt or a host backoff response.
    pub fn set_host_delay(&mut self, host: &str, delay_ms: i64) -> rusqlite::Result<()> {
        let host = host.to_ascii_lowercase();
        let delay_ms = delay_ms.max(0);
        self.db.execute(
            "INSERT INTO hosts(host,delay_ms) VALUES(?1,?2)
             ON CONFLICT(host) DO UPDATE SET delay_ms=excluded.delay_ms,
               next_allowed_at=MAX(next_allowed_at,last_locked_at+excluded.delay_ms)",
            params![host, delay_ms],
        )?;
        Ok(())
    }

    pub fn lease_next(&mut self, now_ms: i64) -> rusqlite::Result<Option<Lease>> {
        self.recover_stale(now_ms)?;
        self.promote_due_revisits(now_ms)?;
        let tx = self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let candidate = {
            let mut statement = tx.prepare(
                "SELECT r.id,r.url,r.host,r.depth,r.retries FROM requests r
                 LEFT JOIN hosts h ON r.host=h.host
                 WHERE r.state='pending' AND COALESCE(h.in_flight,0) < ?1
                   AND COALESCE(h.next_allowed_at,0) <= ?2
                 ORDER BY r.priority DESC,r.score DESC,r.id ASC LIMIT 1",
            )?;
            statement
                .query_row(params![self.options.max_in_flight_per_host, now_ms], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, u32>(3)?,
                        row.get::<_, u32>(4)?,
                    ))
                })
                .optional()?
        };
        let Some((id, raw_url, host, depth, retries)) = candidate else {
            tx.commit()?;
            return Ok(None);
        };
        tx.execute(
            "UPDATE requests SET state='locked',locked_at=?2 WHERE id=?1",
            params![id, now_ms],
        )?;
        tx.execute(
            "INSERT INTO hosts(host,in_flight,next_allowed_at,last_locked_at) VALUES(?1,1,?2,?3)
             ON CONFLICT(host) DO UPDATE SET in_flight=in_flight+1,
               next_allowed_at=?3+MAX(hosts.delay_ms,?4),last_locked_at=?3",
            params![
                host,
                now_ms.saturating_add(self.options.per_host_delay_ms),
                now_ms,
                self.options.per_host_delay_ms
            ],
        )?;
        tx.commit()?;
        let url = Url::parse(&raw_url)
            .map_err(|error| rusqlite::Error::InvalidParameterName(error.to_string()))?;
        Ok(Some(Lease { id, url, depth, retries }))
    }

    pub fn mark_done(
        &mut self,
        lease: &Lease,
        page: &PageRecord,
        now_ms: i64,
    ) -> rusqlite::Result<StoredPage> {
        let tx = self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let info = tx.query_row(
            "SELECT state,family,content_hash,fetch_count,change_count,first_fetched_at,opic_cash+opic_history
             FROM requests WHERE id=?1",
            [lease.id],
            |r| Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?,r.get::<_, Option<String>>(2)?,
                r.get::<_, u32>(3)?,r.get::<_, u32>(4)?,r.get::<_, Option<i64>>(5)?,r.get::<_, f64>(6)?)),
        ).optional()?;
        let Some((
            state,
            family,
            prior_hash,
            prior_fetches,
            prior_changes,
            first_fetch,
            importance,
        )) = info
        else {
            return Err(rusqlite::Error::InvalidParameterName("lease is not locked".into()));
        };
        if state != "locked" {
            return Err(rusqlite::Error::InvalidParameterName("lease is not locked".into()));
        }
        let exact: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM pages WHERE content_hash=?1 AND url<>?2)",
            params![page.content_hash, lease.url.as_str()],
            |r| r.get(0),
        )?;
        let mut status = if exact { StoredPage::ExactDuplicate } else { StoredPage::New };
        if status == StoredPage::New && page.simhash != 0 {
            let bands = simhash_bands(page.simhash);
            // At most three changed bits guarantee one equal 16-bit band.
            let candidates = if self.options.near_duplicate_bits <= 3 {
                "SELECT simhash FROM pages WHERE url<>?5 AND (band0=?1 OR band1=?2 OR band2=?3 OR band3=?4)"
            } else {
                "SELECT simhash FROM pages WHERE url<>?5 AND ?1 IS NOT NULL AND ?2 IS NOT NULL AND ?3 IS NOT NULL AND ?4 IS NOT NULL"
            };
            let mut hashes = tx.prepare(candidates)?;
            let rows = hashes.query_map(
                params![bands[0], bands[1], bands[2], bands[3], lease.url.as_str()],
                |r| r.get::<_, i64>(0),
            )?;
            for stored in rows {
                if hamming_distance(stored? as u64, page.simhash)
                    <= self.options.near_duplicate_bits
                {
                    status = StoredPage::NearDuplicate;
                    break;
                }
            }
        }
        if status == StoredPage::New {
            let bands = simhash_bands(page.simhash);
            tx.execute(
                "INSERT OR REPLACE INTO pages(url,title,markdown,content_hash,simhash,band0,band1,band2,band3,fetched_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                params![
                    lease.url.as_str(),
                    page.title,
                    page.markdown,
                    page.content_hash,
                    page.simhash as i64,
                    bands[0], bands[1], bands[2], bands[3],
                    now_ms
                ],
            )?;
        }
        let changed = prior_hash.as_deref().is_some_and(|old| old != page.content_hash);
        let history = ChangeHistory {
            fetch_count: prior_fetches.saturating_add(1),
            change_count: prior_changes + u32::from(changed),
            first_fetched_at: Some(first_fetch.unwrap_or(now_ms)),
            last_fetched_at: Some(now_ms),
        };
        let (change_rate, next_fetch_at) = if self.options.enable_revisits {
            let rate = estimate_change_rate(history, self.options.revisit_policy);
            let interval =
                revisit_interval_ms(rate, importance.max(1.0), self.options.revisit_policy);
            (Some(rate), Some(now_ms.saturating_add(interval)))
        } else {
            (None, None)
        };
        tx.execute(
            "UPDATE requests SET state='done',locked_at=NULL,last_error=NULL,
                fetch_count=?2,change_count=?3,first_fetched_at=?4,last_fetched_at=?5,
                next_fetch_at=?6,change_rate=?7,content_hash=?8,revisit_priority=0,score=base_score
             WHERE id=?1",
            params![
                lease.id,
                history.fetch_count,
                history.change_count,
                history.first_fetched_at,
                now_ms,
                next_fetch_at,
                change_rate,
                page.content_hash
            ],
        )?;
        let family_done: u32 = tx.query_row(
            "SELECT COUNT(*) FROM requests WHERE family=?1 AND state='done'",
            [&family],
            |r| r.get(0),
        )?;
        tx.execute("UPDATE requests SET score=base_score+revisit_priority-?2 WHERE family=?1 AND state='pending'",
            params![family, (0.25 * f64::from(family_done)).min(1.0)])?;
        tx.execute(
            "UPDATE hosts SET in_flight=MAX(0,in_flight-1) WHERE host=?1",
            [lease.url.host_str().unwrap_or_default()],
        )?;
        tx.commit()?;
        Ok(status)
    }

    pub fn mark_failed(&mut self, lease: &Lease, error: &str) -> rusqlite::Result<RequestState> {
        let tx = self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let retries: Option<u32> = tx
            .query_row(
                "SELECT retries FROM requests WHERE id=?1 AND state='locked'",
                [lease.id],
                |r| r.get(0),
            )
            .optional()?;
        let retries = retries
            .ok_or_else(|| rusqlite::Error::InvalidParameterName("lease is not locked".into()))?;
        let state = if retries < self.options.max_retries {
            RequestState::Pending
        } else {
            RequestState::Failed
        };
        let label = if state == RequestState::Pending { "pending" } else { "failed" };
        tx.execute("UPDATE requests SET state=?2,retries=retries+1,locked_at=NULL,last_error=?3 WHERE id=?1", params![lease.id, label, error])?;
        tx.execute(
            "UPDATE hosts SET in_flight=MAX(0,in_flight-1) WHERE host=?1",
            [lease.url.host_str().unwrap_or_default()],
        )?;
        tx.commit()?;
        Ok(state)
    }

    pub fn mark_rejected(&mut self, lease: &Lease, reason: &str) -> rusqlite::Result<()> {
        let tx = self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let updated = tx.execute(
            "UPDATE requests SET state='failed',locked_at=NULL,last_error=?2 WHERE id=?1 AND state='locked'",
            params![lease.id, reason],
        )?;
        if updated == 0 {
            return Err(rusqlite::Error::InvalidParameterName("lease is not locked".into()));
        }
        tx.execute(
            "UPDATE hosts SET in_flight=MAX(0,in_flight-1) WHERE host=?1",
            [lease.url.host_str().unwrap_or_default()],
        )?;
        tx.commit()
    }

    pub fn recover_stale(&mut self, now_ms: i64) -> rusqlite::Result<usize> {
        let cutoff = now_ms.saturating_sub(self.options.lock_timeout_ms.max(0));
        let tx = self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let count = tx.execute("UPDATE requests SET state='pending',locked_at=NULL WHERE state='locked' AND locked_at<=?1", [cutoff])?;
        if count > 0 {
            tx.execute("UPDATE hosts SET in_flight=(SELECT COUNT(*) FROM requests WHERE requests.host=hosts.host AND requests.state='locked')", [])?;
        }
        tx.commit()?;
        Ok(count)
    }

    pub fn promote_due_revisits(&mut self, now_ms: i64) -> rusqlite::Result<usize> {
        if !self.options.enable_revisits {
            return Ok(0);
        }
        let tx = self.db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let due = {
            let mut statement = tx.prepare(
                "SELECT id,change_rate,last_fetched_at,base_score FROM requests
                 WHERE state='done' AND next_fetch_at<=?1 ORDER BY next_fetch_at LIMIT 1000",
            )?;
            statement
                .query_map([now_ms], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, f64>(3)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        for (id, rate, last_fetch, importance) in &due {
            let priority = revisit_priority(
                *rate,
                *importance,
                now_ms.saturating_sub(*last_fetch),
                self.options.revisit_policy,
            );
            tx.execute(
                "UPDATE requests SET state='pending',retries=0,next_fetch_at=NULL,
                revisit_priority=?2,score=score+?2 WHERE id=?1",
                params![id, priority],
            )?;
        }
        tx.commit()?;
        Ok(due.len())
    }

    pub fn next_revisit_at(&self) -> rusqlite::Result<Option<i64>> {
        self.db.query_row("SELECT MIN(next_fetch_at) FROM requests WHERE state='done'", [], |row| {
            row.get(0)
        })
    }

    pub fn stats(&self) -> rusqlite::Result<FrontierStats> {
        self.db.query_row(
            "SELECT COALESCE(SUM(state='pending'),0),COALESCE(SUM(state='locked'),0),
                    COALESCE(SUM(state='done'),0),COALESCE(SUM(state='failed'),0) FROM requests",
            [],
            |r| {
                Ok(FrontierStats {
                    pending: r.get::<_, i64>(0)? as u64,
                    locked: r.get::<_, i64>(1)? as u64,
                    done: r.get::<_, i64>(2)? as u64,
                    failed: r.get::<_, i64>(3)? as u64,
                })
            },
        )
    }

    pub fn next_ready_at(&self) -> rusqlite::Result<Option<i64>> {
        self.db.query_row(
            "SELECT MIN(COALESCE(h.next_allowed_at,0)) FROM requests r LEFT JOIN hosts h ON r.host=h.host
             WHERE r.state='pending' AND COALESCE(h.in_flight,0) < ?1",
            [self.options.max_in_flight_per_host],
            |r| r.get(0),
        )
    }

    pub fn page(&self, url: &str) -> rusqlite::Result<Option<(String, String)>> {
        self.db
            .query_row("SELECT title,markdown FROM pages WHERE url=?1", [url], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()
    }

    pub fn known_urls(&self) -> rusqlite::Result<HashSet<String>> {
        let mut statement = self.db.prepare("SELECT url FROM requests")?;
        statement.query_map([], |r| r.get::<_, String>(0))?.collect()
    }
}

#[derive(Debug, Clone)]
pub struct PageRecord {
    pub title: String,
    pub markdown: String,
    pub content_hash: String,
    pub simhash: u64,
}

fn family_key(url: &Url) -> String {
    let mut family = url.clone();
    family.set_query(None);
    family.to_string()
}

fn simhash_bands(value: u64) -> [u16; 4] {
    [value as u16, (value >> 16) as u16, (value >> 32) as u16, (value >> 48) as u16]
}

fn normalize_options(mut options: FrontierOptions) -> FrontierOptions {
    options.per_host_delay_ms = options.per_host_delay_ms.max(0);
    options.max_in_flight_per_host = options.max_in_flight_per_host.max(1);
    options.lock_timeout_ms = options.lock_timeout_ms.max(1);
    options.near_duplicate_bits = options.near_duplicate_bits.min(64);
    options.revisit_policy.min_interval_ms = options.revisit_policy.min_interval_ms.max(1);
    options.revisit_policy.max_interval_ms =
        options.revisit_policy.max_interval_ms.max(options.revisit_policy.min_interval_ms);
    if !options.revisit_policy.prior_interval_ms.is_finite()
        || options.revisit_policy.prior_interval_ms <= 0.0
    {
        options.revisit_policy.prior_interval_ms = RevisitPolicy::default().prior_interval_ms;
    }
    if !options.revisit_policy.prior_changes.is_finite()
        || options.revisit_policy.prior_changes < 0.0
    {
        options.revisit_policy.prior_changes = RevisitPolicy::default().prior_changes;
    }
    if !options.revisit_policy.importance_ref.is_finite()
        || options.revisit_policy.importance_ref <= 0.0
    {
        options.revisit_policy.importance_ref = 1.0;
    }
    options
}

fn migrate_schema(db: &Connection) -> rusqlite::Result<()> {
    let mut added_bands = false;
    for (table, columns) in [
        ("requests", REQUEST_MIGRATIONS),
        (
            "hosts",
            &[
                ("last_locked_at", "INTEGER NOT NULL DEFAULT 0"),
                ("delay_ms", "INTEGER NOT NULL DEFAULT 0"),
            ][..],
        ),
        (
            "pages",
            &[
                ("band0", "INTEGER NOT NULL DEFAULT 0"),
                ("band1", "INTEGER NOT NULL DEFAULT 0"),
                ("band2", "INTEGER NOT NULL DEFAULT 0"),
                ("band3", "INTEGER NOT NULL DEFAULT 0"),
            ][..],
        ),
    ] {
        let mut statement = db.prepare(&format!("PRAGMA table_info({table})"))?;
        let names: HashSet<String> =
            statement.query_map([], |row| row.get(1))?.collect::<rusqlite::Result<_>>()?;
        for (name, definition) in columns {
            if !names.contains(*name) {
                db.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {name} {definition}"))?;
                if table == "pages" && name.starts_with("band") {
                    added_bands = true;
                }
            }
        }
    }
    if added_bands {
        let mut statement = db.prepare("SELECT url,simhash FROM pages")?;
        let pages = statement
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (url, hash) in pages {
            let bands = simhash_bands(hash as u64);
            db.execute(
                "UPDATE pages SET band0=?2,band1=?3,band2=?4,band3=?5 WHERE url=?1",
                params![url, bands[0], bands[1], bands[2], bands[3]],
            )?;
        }
    }
    db.execute_batch("CREATE INDEX IF NOT EXISTS requests_revisit ON requests(next_fetch_at) WHERE state='done' AND next_fetch_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS pages_band0 ON pages(band0);
        CREATE INDEX IF NOT EXISTS pages_band1 ON pages(band1);
        CREATE INDEX IF NOT EXISTS pages_band2 ON pages(band2);
        CREATE INDEX IF NOT EXISTS pages_band3 ON pages(band3);")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_url_dedup_and_priority_order() {
        let mut frontier = Frontier::memory(FrontierOptions::default()).unwrap();
        assert!(frontier.enqueue(AddRequest::seed("https://Example.test/a#one"), 0).unwrap());
        assert!(!frontier.enqueue(AddRequest::seed("https://example.test/a#two"), 0).unwrap());
        assert!(
            frontier
                .enqueue(
                    AddRequest {
                        url: "https://other.test/b".into(),
                        depth: 5,
                        priority: true,
                        boost: 0.0
                    },
                    0
                )
                .unwrap()
        );
        let first = frontier.lease_next(0).unwrap().unwrap();
        assert_eq!(first.url.as_str(), "https://other.test/b");
        assert_eq!(frontier.stats().unwrap().pending, 1);
    }

    #[test]
    fn host_politeness_and_in_flight_limit() {
        let mut frontier = Frontier::memory(FrontierOptions {
            per_host_delay_ms: 500,
            max_in_flight_per_host: 1,
            ..FrontierOptions::default()
        })
        .unwrap();
        for path in ["a", "b"] {
            frontier.enqueue(AddRequest::seed(format!("https://example.test/{path}")), 0).unwrap();
        }
        let first = frontier.lease_next(100).unwrap().unwrap();
        assert!(frontier.lease_next(100).unwrap().is_none());
        frontier.mark_failed(&first, "temporary").unwrap();
        assert!(frontier.lease_next(599).unwrap().is_none());
        assert!(frontier.lease_next(600).unwrap().is_some());
    }

    #[test]
    fn stale_leases_recover_and_retries_dead_letter() {
        let mut frontier = Frontier::memory(FrontierOptions {
            lock_timeout_ms: 100,
            max_retries: 1,
            ..FrontierOptions::default()
        })
        .unwrap();
        frontier.enqueue(AddRequest::seed("https://example.test/"), 0).unwrap();
        let first = frontier.lease_next(1).unwrap().unwrap();
        assert_eq!(frontier.recover_stale(102).unwrap(), 1);
        let second = frontier.lease_next(102).unwrap().unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(frontier.mark_failed(&second, "first error").unwrap(), RequestState::Pending);
        let third = frontier.lease_next(103).unwrap().unwrap();
        assert_eq!(third.retries, 1);
        assert_eq!(frontier.mark_failed(&third, "second error").unwrap(), RequestState::Failed);
        assert_eq!(frontier.stats().unwrap().failed, 1);
    }

    #[test]
    fn exact_and_near_content_duplicates_are_not_indexed_twice() {
        let mut frontier = Frontier::memory(FrontierOptions::default()).unwrap();
        for path in ["a", "b", "c"] {
            frontier.enqueue(AddRequest::seed(format!("https://example.test/{path}")), 0).unwrap();
        }
        let page = PageRecord {
            title: "One".into(),
            markdown: "A few words".into(),
            content_hash: "hash-1".into(),
            simhash: 0b1010,
        };
        let first = frontier.lease_next(1).unwrap().unwrap();
        assert_eq!(frontier.mark_done(&first, &page, 1).unwrap(), StoredPage::New);
        let second = frontier.lease_next(2).unwrap().unwrap();
        assert_eq!(frontier.mark_done(&second, &page, 2).unwrap(), StoredPage::ExactDuplicate);
        assert!(frontier.page(second.url.as_str()).unwrap().is_none());
        let third = frontier.lease_next(3).unwrap().unwrap();
        let near = PageRecord { content_hash: "hash-2".into(), simhash: 0b1011, ..page };
        assert_eq!(frontier.mark_done(&third, &near, 3).unwrap(), StoredPage::NearDuplicate);
        assert_eq!(frontier.stats().unwrap().done, 3);
    }

    #[test]
    fn opic_cash_is_split_and_credits_existing_child() {
        let mut frontier = Frontier::memory(FrontierOptions {
            goal: Some("rust crawler".into()),
            ..FrontierOptions::default()
        })
        .unwrap();
        frontier.enqueue(AddRequest::seed("https://example.test/"), 0).unwrap();
        frontier
            .enqueue(
                AddRequest {
                    url: "https://example.test/existing".into(),
                    depth: 5,
                    priority: false,
                    boost: 0.0,
                },
                0,
            )
            .unwrap();
        let parent = frontier.lease_next(0).unwrap().unwrap();
        assert_eq!(parent.url.as_str(), "https://example.test/");
        assert_eq!(
            frontier
                .enqueue_children(
                    &parent,
                    [
                        (Url::parse("https://example.test/existing").unwrap(), "old".into()),
                        (
                            Url::parse("https://example.test/rust-crawler").unwrap(),
                            "Rust crawler guide".into()
                        ),
                    ],
                    0
                )
                .unwrap(),
            1
        );
        let parent_cash: (f64, f64) = frontier
            .db
            .query_row(
                "SELECT opic_cash,opic_history FROM requests WHERE id=?1",
                [parent.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(parent_cash, (0.0, 1.0));
        let existing_cash: f64 = frontier
            .db
            .query_row(
                "SELECT opic_cash FROM requests WHERE url='https://example.test/existing'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(existing_cash, 1.5);
        let next = frontier.lease_next(0).unwrap().unwrap();
        assert_eq!(next.url.as_str(), "https://example.test/rust-crawler");
    }

    #[test]
    fn completed_page_is_revisited_at_due_time() {
        let policy =
            RevisitPolicy { min_interval_ms: 10, max_interval_ms: 10, ..RevisitPolicy::default() };
        let mut frontier = Frontier::memory(FrontierOptions {
            enable_revisits: true,
            revisit_policy: policy,
            ..FrontierOptions::default()
        })
        .unwrap();
        frontier.enqueue(AddRequest::seed("https://example.test/"), 0).unwrap();
        let first = frontier.lease_next(1).unwrap().unwrap();
        let page = PageRecord {
            title: "Test".into(),
            markdown: "Content".into(),
            content_hash: "hash".into(),
            simhash: 123,
        };
        frontier.mark_done(&first, &page, 1).unwrap();
        assert_eq!(frontier.next_revisit_at().unwrap(), Some(11));
        assert!(frontier.lease_next(10).unwrap().is_none());
        let second = frontier.lease_next(11).unwrap().unwrap();
        assert_eq!(second.id, first.id);
        assert_eq!(frontier.mark_done(&second, &page, 11).unwrap(), StoredPage::New);
        let counters: (u32, u32) = frontier
            .db
            .query_row(
                "SELECT fetch_count,change_count FROM requests WHERE id=?1",
                [first.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(counters, (2, 0));
    }

    #[test]
    fn migrates_existing_page_fingerprints() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE requests(id INTEGER PRIMARY KEY,score REAL,state TEXT,family TEXT);
            CREATE TABLE hosts(host TEXT PRIMARY KEY);
            CREATE TABLE pages(url TEXT PRIMARY KEY,title TEXT,markdown TEXT,content_hash TEXT,simhash INTEGER,fetched_at INTEGER);
            INSERT INTO pages VALUES('https://example.test/','One','Body','hash',4660,1);").unwrap();
        migrate_schema(&db).unwrap();
        let bands: (u16, u16) = db
            .query_row("SELECT band0,band1 FROM pages", [], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap();
        assert_eq!(bands, (0x1234, 0));
    }
}
