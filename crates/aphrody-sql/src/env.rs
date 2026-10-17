// SPDX-License-Identifier: Apache-2.0

//! Database URL resolution from the environment (ADR D9).
//!
//! Every domain publishes up to two variables:
//!
//! | Variable | Role |
//! |---|---|
//! | `<PREFIX>_DATABASE_URL` | direct URL: migrations, `COPY`, `LISTEN`, DDL |
//! | `<PREFIX>_DATABASE_URL_POOLED` | runtime URL behind a pooler (PgBouncer, Neon `-pooler`) |
//!
//! Existing contracts that predate the convention (`DATABASE_URL`,
//! `APHRODY_MCP_DATABASE_URL`, `RG_DATABASE_URL`, ...) are kept as *legacy*
//! variables and are searched after the canonical ones. Empty or
//! whitespace-only values count as unset.
//!
//! Resolution order:
//!
//! * runtime: `<PREFIX>_DATABASE_URL_POOLED`, `<PREFIX>_DATABASE_URL`, legacy
//!   variables in declaration order;
//! * migrations: `<PREFIX>_DATABASE_URL`, legacy variables, then
//!   `<PREFIX>_DATABASE_URL_POOLED` as a last resort.
//!
//! URLs carry credentials: [`DatabaseUrl`] redacts them in `Display` and
//! `Debug`; call [`DatabaseUrl::expose`] only to hand the URL to a driver.

use std::fmt;

use crate::error::{Result, SqlError};

/// A database URL whose credentials never reach logs.
#[derive(Clone, PartialEq, Eq)]
pub struct DatabaseUrl(String);

impl DatabaseUrl {
    /// Wrap a raw URL or key/value connection string.
    #[must_use]
    pub fn new(raw: impl Into<String>) -> Self {
        Self(raw.into().trim().to_owned())
    }

    /// The raw URL, credentials included. Never log the result.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// The URL with the password replaced by `***`.
    #[must_use]
    pub fn redacted(&self) -> String {
        redact_url(&self.0)
    }

    /// Consume the wrapper and return the raw URL.
    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Display for DatabaseUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&redact_url(&self.0))
    }
}

impl fmt::Debug for DatabaseUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "DatabaseUrl({})", redact_url(&self.0))
    }
}

impl From<String> for DatabaseUrl {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl From<&str> for DatabaseUrl {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

/// Replace every password in `raw` with `***`.
///
/// Handles `scheme://user:password@host/db`, `password=` / `sslpassword=`
/// query parameters and libpq key/value strings (`password='a b'`). The
/// function over-redacts rather than risk leaking: an `@` anywhere after the
/// scheme is treated as the end of the userinfo.
#[must_use]
pub fn redact_url(raw: &str) -> String {
    let userinfo_redacted = match raw.find("://") {
        Some(idx) => {
            let (scheme, rest) = raw.split_at(idx + 3);
            match rest.rfind('@') {
                Some(at) => {
                    let userinfo = &rest[..at];
                    match userinfo.find(':') {
                        Some(colon) => format!("{scheme}{}:***{}", &userinfo[..colon], &rest[at..]),
                        None => raw.to_owned(),
                    }
                }
                None => raw.to_owned(),
            }
        }
        None => raw.to_owned(),
    };
    redact_key_values(&userinfo_redacted)
}

fn redact_key_values(input: &str) -> String {
    const KEYS: [&str; 2] = ["sslpassword=", "password="];
    let lower = input.to_ascii_lowercase();
    let bytes = input.as_bytes();
    let len = input.len();
    let mut out = String::with_capacity(len);
    let mut i = 0;
    while i < len {
        let at_boundary = i == 0 || matches!(bytes[i - 1], b' ' | b'\t' | b'\n' | b'?' | b'&');
        if at_boundary && let Some(key) = KEYS.iter().find(|key| lower[i..].starts_with(**key)) {
            out.push_str(&input[i..i + key.len()]);
            out.push_str("***");
            i += key.len();
            if bytes.get(i) == Some(&b'\'') {
                i += 1;
                while i < len {
                    match bytes[i] {
                        b'\\' => i += 2,
                        b'\'' => {
                            i += 1;
                            break;
                        }
                        _ => i += 1,
                    }
                }
            } else {
                while i < len && !matches!(bytes[i], b' ' | b'\t' | b'\n' | b'&' | b'#') {
                    i += 1;
                }
            }
            i = i.min(len);
            continue;
        }
        let ch = input[i..].chars().next().unwrap_or('\u{fffd}');
        out.push(ch);
        i += ch.len_utf8().max(1);
    }
    out
}

/// How a URL was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UrlSource {
    /// `<PREFIX>_DATABASE_URL_POOLED`.
    Pooled,
    /// `<PREFIX>_DATABASE_URL`.
    Direct,
    /// A pre-convention variable declared with [`DatabaseEnv::legacy`].
    Legacy,
}

/// A URL together with the variable it came from.
#[derive(Debug, Clone)]
pub struct ResolvedUrl {
    /// The URL (redacting `Display`).
    pub url: DatabaseUrl,
    /// Name of the environment variable that supplied it.
    pub var: String,
    /// Which role the variable plays.
    pub source: UrlSource,
}

/// Environment lookup rules of one domain (`APHRODY_TRAINING`, `RG`, ...).
#[derive(Debug, Clone)]
pub struct DatabaseEnv {
    prefix: String,
    legacy: Vec<String>,
}

impl DatabaseEnv {
    /// Rules for `<PREFIX>_DATABASE_URL[_POOLED]`. A trailing `_` or a full
    /// `_DATABASE_URL` suffix in `prefix` is accepted and stripped.
    #[must_use]
    pub fn new(prefix: impl AsRef<str>) -> Self {
        let mut prefix = prefix
            .as_ref()
            .trim()
            .trim_end_matches('_')
            .to_ascii_uppercase();
        for suffix in ["_DATABASE_URL_POOLED", "_DATABASE_URL"] {
            if let Some(stripped) = prefix.strip_suffix(suffix) {
                prefix = stripped.to_owned();
                break;
            }
        }
        Self {
            prefix,
            legacy: Vec::new(),
        }
    }

    /// Declare a pre-convention variable that is still honoured (never renamed,
    /// ADR D9). Later calls have lower priority.
    #[must_use]
    pub fn legacy(mut self, var: impl Into<String>) -> Self {
        self.legacy.push(var.into());
        self
    }

    /// Name of the direct-URL variable.
    #[must_use]
    pub fn direct_var(&self) -> String {
        format!("{}_DATABASE_URL", self.prefix)
    }

    /// Name of the pooled-URL variable.
    #[must_use]
    pub fn pooled_var(&self) -> String {
        format!("{}_DATABASE_URL_POOLED", self.prefix)
    }

    fn candidates(&self, runtime: bool) -> Vec<(String, UrlSource)> {
        let direct = (self.direct_var(), UrlSource::Direct);
        let pooled = (self.pooled_var(), UrlSource::Pooled);
        let legacy = self
            .legacy
            .iter()
            .map(|var| (var.clone(), UrlSource::Legacy));
        if runtime {
            [pooled].into_iter().chain([direct]).chain(legacy).collect()
        } else {
            [direct].into_iter().chain(legacy).chain([pooled]).collect()
        }
    }

    fn resolve_with(
        &self,
        runtime: bool,
        mut get: impl FnMut(&str) -> Option<String>,
    ) -> Option<ResolvedUrl> {
        self.candidates(runtime)
            .into_iter()
            .find_map(|(var, source)| {
                let value = get(&var)?;
                let value = value.trim();
                (!value.is_empty()).then(|| ResolvedUrl {
                    url: DatabaseUrl::new(value),
                    var,
                    source,
                })
            })
    }

    /// Runtime URL (pooled first) through a custom lookup, for tests.
    pub fn runtime_with(&self, get: impl FnMut(&str) -> Option<String>) -> Option<ResolvedUrl> {
        self.resolve_with(true, get)
    }

    /// Migration URL (direct first) through a custom lookup, for tests.
    pub fn migration_with(&self, get: impl FnMut(&str) -> Option<String>) -> Option<ResolvedUrl> {
        self.resolve_with(false, get)
    }

    /// Runtime URL from the process environment.
    #[must_use]
    pub fn runtime(&self) -> Option<ResolvedUrl> {
        self.runtime_with(|var| std::env::var(var).ok())
    }

    /// Migration URL from the process environment.
    #[must_use]
    pub fn migration(&self) -> Option<ResolvedUrl> {
        self.migration_with(|var| std::env::var(var).ok())
    }

    /// Like [`Self::runtime`] but an error naming every candidate variable.
    ///
    /// # Errors
    ///
    /// [`SqlError::MissingEnv`] when no candidate is set.
    pub fn require_runtime(&self) -> Result<ResolvedUrl> {
        self.runtime().ok_or_else(|| self.missing(true))
    }

    /// Like [`Self::migration`] but an error naming every candidate variable.
    ///
    /// # Errors
    ///
    /// [`SqlError::MissingEnv`] when no candidate is set.
    pub fn require_migration(&self) -> Result<ResolvedUrl> {
        self.migration().ok_or_else(|| self.missing(false))
    }

    fn missing(&self, runtime: bool) -> SqlError {
        SqlError::MissingEnv(
            self.candidates(runtime)
                .into_iter()
                .map(|(var, _)| var)
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn lookup<'a>(vars: &'a HashMap<&'a str, &'a str>) -> impl FnMut(&str) -> Option<String> + 'a {
        move |name| vars.get(name).map(|value| (*value).to_owned())
    }

    #[test]
    fn prefix_is_normalised() {
        for raw in [
            "aphrody_training",
            "APHRODY_TRAINING_",
            "APHRODY_TRAINING_DATABASE_URL",
            "aphrody_training_database_url_pooled",
        ] {
            let env = DatabaseEnv::new(raw);
            assert_eq!(env.direct_var(), "APHRODY_TRAINING_DATABASE_URL");
            assert_eq!(env.pooled_var(), "APHRODY_TRAINING_DATABASE_URL_POOLED");
        }
    }

    #[test]
    fn runtime_prefers_pooled_then_direct_then_legacy() {
        let env = DatabaseEnv::new("APHRODY_MCP").legacy("DATABASE_URL");
        let vars = HashMap::from([
            ("APHRODY_MCP_DATABASE_URL", "postgres://direct"),
            ("APHRODY_MCP_DATABASE_URL_POOLED", "postgres://pooled"),
            ("DATABASE_URL", "postgres://legacy"),
        ]);
        let resolved = env.runtime_with(lookup(&vars)).unwrap();
        assert_eq!(resolved.var, "APHRODY_MCP_DATABASE_URL_POOLED");
        assert_eq!(resolved.source, UrlSource::Pooled);

        let vars = HashMap::from([
            ("APHRODY_MCP_DATABASE_URL", "postgres://direct"),
            ("DATABASE_URL", "postgres://legacy"),
        ]);
        let resolved = env.runtime_with(lookup(&vars)).unwrap();
        assert_eq!(resolved.source, UrlSource::Direct);

        let vars = HashMap::from([("DATABASE_URL", "postgres://legacy")]);
        let resolved = env.runtime_with(lookup(&vars)).unwrap();
        assert_eq!(resolved.var, "DATABASE_URL");
        assert_eq!(resolved.source, UrlSource::Legacy);
    }

    #[test]
    fn migration_prefers_direct_and_uses_pooled_last() {
        let env = DatabaseEnv::new("APHRODY_TRAINING").legacy("TRAINING_DB");
        let vars = HashMap::from([
            ("APHRODY_TRAINING_DATABASE_URL", "postgres://direct"),
            ("APHRODY_TRAINING_DATABASE_URL_POOLED", "postgres://pooled"),
        ]);
        assert_eq!(
            env.migration_with(lookup(&vars)).unwrap().source,
            UrlSource::Direct
        );

        let vars = HashMap::from([
            ("APHRODY_TRAINING_DATABASE_URL_POOLED", "postgres://pooled"),
            ("TRAINING_DB", "postgres://legacy"),
        ]);
        assert_eq!(
            env.migration_with(lookup(&vars)).unwrap().source,
            UrlSource::Legacy
        );

        let vars = HashMap::from([("APHRODY_TRAINING_DATABASE_URL_POOLED", "postgres://pooled")]);
        assert_eq!(
            env.migration_with(lookup(&vars)).unwrap().source,
            UrlSource::Pooled
        );
    }

    #[test]
    fn blank_values_are_unset() {
        let env = DatabaseEnv::new("RG");
        let vars = HashMap::from([
            ("RG_DATABASE_URL_POOLED", "   "),
            ("RG_DATABASE_URL", "  postgres://rg  "),
        ]);
        let resolved = env.runtime_with(lookup(&vars)).unwrap();
        assert_eq!(resolved.source, UrlSource::Direct);
        assert_eq!(resolved.url.expose(), "postgres://rg");
        assert!(env.runtime_with(|_| Some(String::new())).is_none());
    }

    #[test]
    fn missing_error_lists_candidates_in_order() {
        let env = DatabaseEnv::new("RG").legacy("DATABASE_URL");
        let SqlError::MissingEnv(vars) = env.missing(true) else {
            panic!("wrong variant")
        };
        assert_eq!(
            vars,
            ["RG_DATABASE_URL_POOLED", "RG_DATABASE_URL", "DATABASE_URL"]
        );
    }

    #[test]
    fn userinfo_password_is_redacted() {
        let redacted_userinfo = ":***";
        let redacted =
            format!("postgres://rg{redacted_userinfo}@db.example.com:5432/rg?sslmode=require");
        assert_eq!(
            redact_url("postgres://rg:example%40password@db.example.com:5432/rg?sslmode=require"),
            redacted
        );
        let no_password = "postgres://rg@host/db";
        assert_eq!(redact_url(no_password), no_password);
        assert_eq!(
            redact_url("postgresql:///db?host=/var/run/postgresql"),
            "postgresql:///db?host=/var/run/postgresql"
        );
    }

    #[test]
    fn query_and_keyvalue_passwords_are_redacted() {
        assert_eq!(
            redact_url("postgres://h/db?user=u&password=hunter2&sslmode=require"),
            "postgres://h/db?user=u&password=***&sslmode=require"
        );
        assert_eq!(
            redact_url("host=h user=u password='a b\\'c' dbname=d"),
            "host=h user=u password=*** dbname=d"
        );
        assert_eq!(
            redact_url("host=h PASSWORD=hunter2 sslpassword=k"),
            "host=h PASSWORD=*** sslpassword=***"
        );
        assert_eq!(redact_url("host=h passwordless=1"), "host=h passwordless=1");
    }

    #[test]
    fn display_and_debug_never_show_the_password() {
        let url = DatabaseUrl::new("postgres://u:example-secret@h/db");
        assert!(!url.to_string().contains("example-secret"));
        assert!(!format!("{url:?}").contains("example-secret"));
        assert_eq!(url.expose(), "postgres://u:example-secret@h/db");
        let resolved = ResolvedUrl {
            url,
            var: "X".into(),
            source: UrlSource::Direct,
        };
        assert!(!format!("{resolved:?}").contains("example-secret"));
    }
}
