use errors::AnyhowResult;
use sqlx::migrate::MigrateError;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
use sqlx::{Pool, Sqlite, SqlitePool};
use std::path::Path;

#[derive(Clone)]
pub struct TaskDbConnection {
  pool: Pool<Sqlite>,
}

impl TaskDbConnection {
  pub async fn connect_and_migrate<P: AsRef<Path>>(database_file: P) -> AnyhowResult<Self> {
    let pool = run_migrations(database_file).await?;

    Ok(Self { pool })
  }

  pub fn get_pool(&self) -> &Pool<Sqlite> {
    &self.pool
  }
}

async fn run_migrations<P: AsRef<Path>>(database_file: P) -> Result<SqlitePool, MigrateError> {
  let connection_options = SqliteConnectOptions::new()
      .filename(database_file)
      .create_if_missing(true)
      .journal_mode(SqliteJournalMode::Wal);

  let pool = SqlitePool::connect_with(connection_options).await?;

  // Run migrations against the existing database; SQLx tracks which have been applied.
  // Migration failures propagate to the caller and never trigger database deletion.
  sqlx::migrate!("../../docs/libraries/artcraft/_database/sql/artcraft_migrations").run(&pool).await?;

  Ok(pool)
}
