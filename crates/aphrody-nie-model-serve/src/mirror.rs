//! Miroir de données `inagle_*` : fichier SQLite local ou base PostgreSQL (Neon), lu en lecture
//! seule via la frontière partagée `aphrody-nie-sql`.

use std::path::PathBuf;

use aphrody_nie_sql::{
    DatabaseUrl, PostgresReadOnly, QueryResult, ReadOnlyDatabase, ReadQuery, SqliteReadOnly, Value,
};

/// Emplacement du miroir. L'URL PostgreSQL n'est jamais journalisée.
#[derive(Debug, Clone)]
pub enum Mirror {
    Sqlite(PathBuf),
    Postgres(String),
}

impl Mirror {
    /// Interprète `postgres://…`, `postgresql://…`, `sqlite:…` ou un chemin de fichier.
    pub fn parse(value: &str) -> Option<Self> {
        match DatabaseUrl::parse(value) {
            Ok(DatabaseUrl::Sqlite { path }) => Some(Self::Sqlite(path)),
            Ok(DatabaseUrl::PostgreSql { url }) => Some(Self::Postgres(url)),
            Err(_) => {
                let path = PathBuf::from(value);
                path.exists().then_some(Self::Sqlite(path))
            },
        }
    }

    /// Libellé sans identifiants, pour les journaux.
    pub fn describe(&self) -> String {
        match self {
            Self::Sqlite(path) => path.display().to_string(),
            Self::Postgres(_) => "PostgreSQL".to_owned(),
        }
    }

    /// Exécute une lecture ; `None` si la requête, la connexion ou le décodage échoue.
    pub fn query(&self, sql: &str, parameters: &[Value]) -> Option<QueryResult> {
        let query = ReadQuery::parse(sql).ok()?;
        match self {
            Self::Sqlite(path) => SqliteReadOnly::open(path).ok()?.query(&query, parameters).ok(),
            Self::Postgres(url) => {
                let runtime =
                    tokio::runtime::Builder::new_current_thread().enable_all().build().ok()?;
                runtime.block_on(async {
                    let database = PostgresReadOnly::connect(url).await.ok()?;
                    database.query(&query, parameters).await.ok()
                })
            },
        }
    }

    /// Première cellule texte de la première ligne.
    pub fn first_text(&self, sql: &str, parameters: &[Value]) -> Option<String> {
        match self.query(sql, parameters)?.rows.into_iter().next()?.values.into_iter().next()? {
            Value::Text(text) => Some(text),
            _ => None,
        }
    }
}

/// Texte d'une cellule (chaîne vide pour `NULL` ou un type non textuel).
pub fn text(value: &Value) -> String {
    match value {
        Value::Text(text) => text.clone(),
        Value::Integer(n) => n.to_string(),
        _ => String::new(),
    }
}
