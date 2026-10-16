// SPDX-License-Identifier: Apache-2.0
//! In-memory and structured journal log store for systemd units and system services.

use std::{
    collections::VecDeque,
    sync::RwLock,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(u8)]
pub enum LogLevel {
    Emerg = 0,
    Alert = 1,
    Crit = 2,
    Err = 3,
    Warning = 4,
    Notice = 5,
    Info = 6,
    Debug = 7,
}

impl LogLevel {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Emerg => "emerg",
            Self::Alert => "alert",
            Self::Crit => "crit",
            Self::Err => "err",
            Self::Warning => "warning",
            Self::Notice => "notice",
            Self::Info => "info",
            Self::Debug => "debug",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntry {
    pub cursor: u64,
    pub timestamp_usec: u64,
    pub unit: String,
    pub pid: Option<u32>,
    pub level: LogLevel,
    pub message: String,
}

pub struct Journal {
    entries: RwLock<VecDeque<JournalEntry>>,
    max_entries: usize,
    next_cursor: RwLock<u64>,
}

impl Default for Journal {
    fn default() -> Self {
        Self::new(10_000)
    }
}

impl Journal {
    #[must_use]
    pub fn new(max_entries: usize) -> Self {
        Self {
            entries: RwLock::new(VecDeque::with_capacity(max_entries.min(1024))),
            max_entries: max_entries.max(100),
            next_cursor: RwLock::new(1),
        }
    }

    /// Append a log message to the journal.
    pub fn log(&self, unit: &str, level: LogLevel, pid: Option<u32>, message: impl Into<String>) {
        let timestamp_usec =
            SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros() as u64).unwrap_or(0);

        let mut cursor_lock = self.next_cursor.write().expect("cursor lock");
        let cursor = *cursor_lock;
        *cursor_lock += 1;
        drop(cursor_lock);

        let entry = JournalEntry {
            cursor,
            timestamp_usec,
            unit: unit.to_owned(),
            pid,
            level,
            message: message.into(),
        };

        let mut entries = self.entries.write().expect("entries lock");
        if entries.len() >= self.max_entries {
            entries.pop_front();
        }
        entries.push_back(entry);
    }

    /// Query entries with filtering.
    #[must_use]
    pub fn query(
        &self,
        unit: Option<&str>,
        max_level: Option<LogLevel>,
        since_usec: Option<u64>,
        limit: usize,
    ) -> Vec<JournalEntry> {
        let entries = self.entries.read().expect("entries read lock");
        let limit = limit.clamp(1, 500);

        entries
            .iter()
            .rev()
            .filter(|e| {
                if let Some(target_unit) = unit
                    && e.unit != target_unit
                {
                    return false;
                }
                if let Some(level_cap) = max_level
                    && e.level > level_cap
                {
                    return false;
                }
                if let Some(since) = since_usec
                    && e.timestamp_usec < since
                {
                    return false;
                }
                true
            })
            .take(limit)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }
}
