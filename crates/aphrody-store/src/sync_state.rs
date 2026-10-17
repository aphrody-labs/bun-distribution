// SPDX-License-Identifier: Apache-2.0
//! Synchronisation cursors and marks (`sync_state`).

use rusqlite::{OptionalExtension as _, params};

use crate::{
    db::HomeDb,
    error::{Result, StoreError},
    time::now_ms,
};

impl HomeDb {
    /// Set `scope`/`key` to `value` (with an optional content hash), replacing any previous
    /// value.
    ///
    /// # Errors
    ///
    /// [`StoreError::Invalid`] for an empty scope or key, or SQLite failures.
    pub fn set_sync(
        &self,
        scope: &str,
        key: &str,
        value: &str,
        blake3: Option<&str>,
    ) -> Result<()> {
        if scope.is_empty() || key.is_empty() {
            return Err(StoreError::Invalid(
                "sync scope and key must not be empty".into(),
            ));
        }
        self.conn.execute(
            "INSERT INTO sync_state (scope, key, value, blake3, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, blake3 = excluded.blake3,
                 updated_at_ms = excluded.updated_at_ms",
            params![scope, key, value, blake3, now_ms()],
        )?;
        Ok(())
    }

    /// The value and optional content hash stored for `scope`/`key`.
    ///
    /// # Errors
    ///
    /// SQLite failures.
    pub fn get_sync(&self, scope: &str, key: &str) -> Result<Option<(String, Option<String>)>> {
        Ok(self
            .conn
            .query_row(
                "SELECT value, blake3 FROM sync_state WHERE scope = ?1 AND key = ?2",
                params![scope, key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?)
    }

    /// Number of keys stored under `scope`.
    ///
    /// # Errors
    ///
    /// SQLite failures.
    pub fn count_sync(&self, scope: &str) -> Result<u64> {
        let count: i64 = self.conn.query_row(
            "SELECT count(*) FROM sync_state WHERE scope = ?1",
            [scope],
            |r| r.get(0),
        )?;
        Ok(u64::try_from(count).unwrap_or(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_round_trip_and_are_replaced() {
        let db = HomeDb::open_in_memory().unwrap();
        assert_eq!(db.get_sync("sessions", "codex/a").unwrap(), None);
        db.set_sync("sessions", "codex/a", "123", Some("h"))
            .unwrap();
        db.set_sync("sessions", "codex/a", "456", None).unwrap();
        assert_eq!(
            db.get_sync("sessions", "codex/a").unwrap(),
            Some(("456".into(), None))
        );
        assert_eq!(db.count_sync("sessions").unwrap(), 1);
        assert!(db.set_sync("", "k", "v", None).is_err());
    }
}
