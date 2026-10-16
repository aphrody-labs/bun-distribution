// SPDX-License-Identifier: Apache-2.0

//! `aphrody-sql`: the shared SQL owner of Aphrody (ADR `docs/decisions/infra/sql-convergence.md`, D4/D5).
//!
//! | Module | Feature | Role |
//! |---|---|---|
//! | [`env`] | always | `<PREFIX>_DATABASE_URL[_POOLED]` resolution, credential-redacting [`env::DatabaseUrl`] |
//! | [`pg`] | `postgres` (default) | one deadpool pool per process, TLS by URL, typed pgvector binds |
//! | [`sqlite`] | `sqlite` | open policy (WAL, `busy_timeout`, foreign keys, optimize), `VACUUM INTO`, checkpoint, sqlite-vec |
//! | [`migrate`] | always (runners per backend) | checksummed plain-SQL migrations, one transaction per file |
//!
//! No sqlx or sea-orm: the root workspace stays on `tokio-postgres` and
//! `rusqlite` (D4). See the crate README for usage and the migration contract.

pub mod env;
pub mod error;
pub mod migrate;
#[cfg(feature = "postgres")]
pub mod pg;
pub mod product;
#[cfg(feature = "sqlite")]
pub mod sqlite;

pub use env::{DatabaseEnv, DatabaseUrl, ResolvedUrl, UrlSource, redact_url};
pub use error::{Result, SqlError};
#[cfg(feature = "postgres")]
pub use migrate::migrate_postgres;
#[cfg(feature = "sqlite")]
pub use migrate::migrate_sqlite;
pub use migrate::{MigrateOptions, MigrationReport, MigrationSet};
#[cfg(feature = "postgres")]
pub use pg::{PgPool, PgPoolBuilder, TlsPolicy, shared_pool};
#[cfg(feature = "sqlite")]
pub use sqlite::{OpenPolicy, open, open_in_memory};

/// Re-exported so dependents bind vectors without a direct `pgvector` dependency.
#[cfg(feature = "postgres")]
pub use pgvector;
