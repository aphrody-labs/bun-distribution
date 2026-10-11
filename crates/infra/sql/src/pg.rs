// SPDX-License-Identifier: Apache-2.0

//! PostgreSQL pool: `tokio-postgres` + `deadpool-postgres` + `tokio-postgres-rustls`.
//!
//! * One pool per process and URL: use [`shared_pool`] (or hold a [`PgPool`] in
//!   your own state). Pools are lazy: building one never opens a connection.
//! * Connections are recycled with [`RecyclingMethod::Verified`] so a connection
//!   that died while idle (or whose creating runtime has shut down) is replaced
//!   instead of handed out.
//! * TLS follows the URL: loopback hosts and Unix sockets use `NoTls`; every
//!   other host uses rustls with the platform roots plus the Mozilla bundle
//!   (`webpki-roots`) plus an optional private CA (`sslrootcert=` in the URL,
//!   `PGSSLROOTCERT`, or [`PgPoolBuilder::root_cert_pem`]). Certificate chain
//!   and host name are always verified, so `sslmode=verify-ca|verify-full` are
//!   accepted and mapped to `require`.
//! * Vectors are bound with typed `pgvector` values, see [`vector`].

use std::{
    borrow::Cow,
    collections::HashMap,
    fmt,
    net::IpAddr,
    str::FromStr as _,
    sync::{Arc, Mutex, OnceLock, PoisonError},
    time::Duration,
};

pub use deadpool_postgres::{self, RecyclingMethod};
use deadpool_postgres::{Manager, ManagerConfig, PoolConfig, Runtime, Timeouts};
use rustls::pki_types::{CertificateDer, pem::PemObject as _};
use tokio_postgres::{
    NoTls,
    config::{Host, SslMode},
};
use tokio_postgres_rustls::MakeRustlsConnect;

pub use pgvector;
pub use tokio_postgres;

use crate::{
    env::DatabaseUrl,
    error::{Result, SqlError},
};

/// A pooled connection (derefs to [`tokio_postgres::Client`]).
pub type Client = deadpool_postgres::Object;

/// When to use TLS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TlsPolicy {
    /// Loopback and Unix-socket hosts: plain. Anything else: TLS required.
    /// An explicit `sslmode=disable` or `sslmode=require` in the URL wins.
    #[default]
    Auto,
    /// Never use TLS.
    Disable,
    /// Always use TLS, even on loopback.
    Require,
}

/// Builder for [`PgPool`].
#[derive(Debug, Clone)]
pub struct PgPoolBuilder {
    url: DatabaseUrl,
    max_size: usize,
    tls: TlsPolicy,
    application_name: Option<String>,
    recycling: RecyclingMethod,
    wait: Duration,
    create: Duration,
    recycle: Duration,
    extra_roots: Vec<Vec<u8>>,
}

impl PgPoolBuilder {
    /// Start from a database URL.
    #[must_use]
    pub fn new(url: impl Into<DatabaseUrl>) -> Self {
        Self {
            url: url.into(),
            max_size: 8,
            tls: TlsPolicy::Auto,
            application_name: None,
            recycling: RecyclingMethod::Verified,
            wait: Duration::from_secs(5),
            create: Duration::from_secs(5),
            recycle: Duration::from_secs(5),
            extra_roots: Vec::new(),
        }
    }

    /// Maximum number of open connections (default 8).
    #[must_use]
    pub fn max_size(mut self, max_size: usize) -> Self {
        self.max_size = max_size.max(1);
        self
    }

    /// TLS policy (default [`TlsPolicy::Auto`]).
    #[must_use]
    pub fn tls(mut self, policy: TlsPolicy) -> Self {
        self.tls = policy;
        self
    }

    /// `application_name` reported to the server when the URL sets none.
    #[must_use]
    pub fn application_name(mut self, name: impl Into<String>) -> Self {
        self.application_name = Some(name.into());
        self
    }

    /// Recycling method (default [`RecyclingMethod::Verified`]). Use
    /// [`RecyclingMethod::Clean`] when callers issue session-level `SET`s.
    #[must_use]
    pub fn recycling(mut self, method: RecyclingMethod) -> Self {
        self.recycling = method;
        self
    }

    /// Timeouts for waiting on a free slot, creating and recycling a connection.
    #[must_use]
    pub fn timeouts(mut self, wait: Duration, create: Duration, recycle: Duration) -> Self {
        self.wait = wait;
        self.create = create;
        self.recycle = recycle;
        self
    }

    /// Trust an extra private CA (PEM bundle) in addition to the public roots.
    #[must_use]
    pub fn root_cert_pem(mut self, pem: impl Into<Vec<u8>>) -> Self {
        self.extra_roots.push(pem.into());
        self
    }

    /// Build the pool. No connection is opened.
    ///
    /// # Errors
    ///
    /// [`SqlError::InvalidUrl`] for an unparsable URL, [`SqlError::Tls`] when a
    /// root certificate cannot be read, [`SqlError::PoolBuild`] from deadpool.
    pub fn build(self) -> Result<PgPool> {
        let target = self.url.redacted();
        let (normalized, url_root_cert) = normalize_url(self.url.expose());
        let mut config = tokio_postgres::Config::from_str(&normalized)
            .map_err(|_| SqlError::InvalidUrl(format!("cannot parse `{target}`")))?;
        fill_defaults(&mut config);
        if let Some(name) = &self.application_name
            && config.get_application_name().is_none()
        {
            config.application_name(name);
        }
        if config.get_application_name().is_none() {
            config.application_name("aphrody");
        }

        let local = is_local(&config);
        let use_tls = match (self.tls, config.get_ssl_mode(), local) {
            (TlsPolicy::Require, _, _) => {
                config.ssl_mode(SslMode::Require);
                true
            },
            (TlsPolicy::Disable, _, _) => {
                config.ssl_mode(SslMode::Disable);
                false
            },
            (TlsPolicy::Auto, SslMode::Disable, local) => {
                if !local {
                    tracing::warn!(url = %target, "TLS disabled by sslmode=disable on a non-loopback host");
                }
                false
            },
            (TlsPolicy::Auto, SslMode::Require, _) => true,
            (TlsPolicy::Auto, _, true) => false,
            (TlsPolicy::Auto, _, false) => {
                config.ssl_mode(SslMode::Require);
                true
            },
        };

        let manager_config = ManagerConfig { recycling_method: self.recycling.clone() };
        let manager = if use_tls {
            let mut roots = self.extra_roots.clone();
            for path in url_root_cert.into_iter().chain(std::env::var("PGSSLROOTCERT").ok()) {
                if !path.is_empty() {
                    roots.push(std::fs::read(&path)?);
                }
            }
            Manager::from_config(config, make_tls_connector(&roots)?, manager_config)
        } else {
            Manager::from_config(config, NoTls, manager_config)
        };

        let mut pool_config = PoolConfig::new(self.max_size);
        pool_config.timeouts = Timeouts {
            wait: Some(self.wait),
            create: Some(self.create),
            recycle: Some(self.recycle),
        };
        let pool = deadpool_postgres::Pool::builder(manager)
            .config(pool_config)
            .runtime(Runtime::Tokio1)
            .build()?;
        Ok(PgPool { pool, tls: use_tls, target: Arc::from(target) })
    }
}

/// A lazily-connected, cloneable PostgreSQL pool.
#[derive(Clone)]
pub struct PgPool {
    pool: deadpool_postgres::Pool,
    tls: bool,
    target: Arc<str>,
}

impl PgPool {
    /// Start a builder.
    #[must_use]
    pub fn builder(url: impl Into<DatabaseUrl>) -> PgPoolBuilder {
        PgPoolBuilder::new(url)
    }

    /// Pool with default settings.
    ///
    /// # Errors
    ///
    /// See [`PgPoolBuilder::build`].
    pub fn connect_lazy(url: impl Into<DatabaseUrl>) -> Result<Self> {
        PgPoolBuilder::new(url).build()
    }

    /// Check a connection out (opening one if needed).
    ///
    /// # Errors
    ///
    /// [`SqlError::Pool`] on timeout, connection failure or a closed pool.
    pub async fn get(&self) -> Result<Client> {
        Ok(self.pool.get().await?)
    }

    /// The underlying deadpool pool.
    #[must_use]
    pub fn inner(&self) -> &deadpool_postgres::Pool {
        &self.pool
    }

    /// Whether connections are TLS-protected.
    #[must_use]
    pub fn uses_tls(&self) -> bool {
        self.tls
    }

    /// The URL with credentials redacted, for logs.
    #[must_use]
    pub fn target(&self) -> &str {
        &self.target
    }

    /// Pool occupancy.
    #[must_use]
    pub fn status(&self) -> deadpool_postgres::Status {
        self.pool.status()
    }

    /// Close the pool; later checkouts fail.
    pub fn close(&self) {
        self.pool.close();
    }
}

impl fmt::Debug for PgPool {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PgPool")
            .field("target", &self.target)
            .field("tls", &self.tls)
            .field("status", &self.pool.status())
            .finish()
    }
}

static SHARED: OnceLock<Mutex<HashMap<String, PgPool>>> = OnceLock::new();

/// The process-wide pool for `url`, created on first use.
///
/// Callers that only know a URL string (public `&str` APIs) share one pool per
/// distinct URL instead of connecting per call.
///
/// # Errors
///
/// See [`PgPoolBuilder::build`].
pub fn shared_pool(url: &str) -> Result<PgPool> {
    let mut pools =
        SHARED.get_or_init(Mutex::default).lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(pool) = pools.get(url)
        && !pool.pool.is_closed()
    {
        return Ok(pool.clone());
    }
    let pool = PgPoolBuilder::new(url).build()?;
    pools.insert(url.to_owned(), pool.clone());
    Ok(pool)
}

fn fill_defaults(config: &mut tokio_postgres::Config) {
    if config.get_user().is_none_or(str::is_empty)
        && let Ok(user) = std::env::var("PGUSER").or_else(|_| std::env::var("USER"))
    {
        config.user(user);
    }
    if config.get_hosts().is_empty() && config.get_hostaddrs().is_empty() {
        #[cfg(unix)]
        {
            config.host_path("/run/postgresql");
            config.host_path("/var/run/postgresql");
            config.host_path("/tmp");
        }
        #[cfg(not(unix))]
        config.host("127.0.0.1");
    }
}

/// `true` when every host is loopback or a Unix socket.
#[must_use]
fn is_local(config: &tokio_postgres::Config) -> bool {
    let hosts_local = config.get_hosts().iter().all(|host| match host {
        Host::Tcp(name) => is_loopback_name(name),
        #[cfg(unix)]
        Host::Unix(_) => true,
    });
    hosts_local && config.get_hostaddrs().iter().all(IpAddr::is_loopback)
}

fn is_loopback_name(name: &str) -> bool {
    let name = name.trim_end_matches('.').trim_matches(['[', ']']);
    name.eq_ignore_ascii_case("localhost")
        || name.to_ascii_lowercase().ends_with(".localhost")
        || name.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// Strip libpq options `tokio-postgres` rejects; returns the new URL and the
/// `sslrootcert` path, if any.
fn normalize_url(raw: &str) -> (Cow<'_, str>, Option<String>) {
    if !(raw.starts_with("postgres://") || raw.starts_with("postgresql://")) {
        return (Cow::Borrowed(raw), None);
    }
    let Some((base, query)) = raw.split_once('?') else {
        return (Cow::Borrowed(raw), None);
    };
    let mut root_cert = None;
    let mut kept: Vec<String> = Vec::new();
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        match key {
            "sslrootcert" => root_cert = Some(percent_decode(value)),
            "sslcert" | "sslkey" | "sslpassword" | "sslcrl" | "sslcompression" | "sslsni"
            | "gssencmode" => {},
            "sslmode" => {
                let mapped = match value {
                    "verify-ca" | "verify-full" => "require",
                    "allow" => "prefer",
                    other => other,
                };
                kept.push(format!("sslmode={mapped}"));
            },
            _ => kept.push(pair.to_owned()),
        }
    }
    let url = if kept.is_empty() { base.to_owned() } else { format!("{base}?{}", kept.join("&")) };
    (Cow::Owned(url), root_cert)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(hex) = value.get(i + 1..i + 3)
            && let Ok(byte) = u8::from_str_radix(hex, 16)
        {
            out.push(byte);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn make_tls_connector(extra_roots_pem: &[Vec<u8>]) -> Result<MakeRustlsConnect> {
    let mut roots = rustls::RootCertStore::empty();
    let native = rustls_native_certs::load_native_certs();
    if !native.errors.is_empty() {
        tracing::debug!(errors = native.errors.len(), "some native root certificates were skipped");
    }
    roots.add_parsable_certificates(native.certs);
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    for pem in extra_roots_pem {
        for cert in CertificateDer::pem_slice_iter(pem) {
            let cert =
                cert.map_err(|e| SqlError::Tls(format!("invalid root certificate PEM: {e}")))?;
            roots
                .add(cert)
                .map_err(|e| SqlError::Tls(format!("unusable root certificate: {e}")))?;
        }
    }
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| SqlError::Tls(e.to_string()))?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(MakeRustlsConnect::new(config))
}

/// Typed pgvector values (binary binds instead of `$1::text::vector` strings).
pub mod vector {
    pub use pgvector::{HalfVector, Vector};

    /// `vector` from `f32` values.
    #[must_use]
    pub fn from_f32(values: &[f32]) -> Vector {
        Vector::from(values.to_vec())
    }

    /// `vector` from `f64` values; `None` when any value is not finite.
    #[must_use]
    pub fn from_f64(values: &[f64]) -> Option<Vector> {
        values
            .iter()
            .all(|value| value.is_finite())
            .then(|| Vector::from(values.iter().map(|&value| value as f32).collect::<Vec<_>>()))
    }

    /// `halfvec` from `f32` values.
    #[must_use]
    pub fn half_from_f32(values: &[f32]) -> HalfVector {
        HalfVector::from_f32_slice(values)
    }

    /// `SET LOCAL hnsw.iterative_scan` for filtered HNSW queries (pgvector
    /// 0.8+). `SET LOCAL` keeps the setting out of the pooled session.
    ///
    /// # Errors
    ///
    /// Any server error, notably an unknown parameter on pgvector < 0.8.
    pub async fn set_iterative_scan_local(
        tx: &tokio_postgres::Transaction<'_>,
        relaxed_order: bool,
    ) -> Result<(), tokio_postgres::Error> {
        let mode = if relaxed_order { "relaxed_order" } else { "strict_order" };
        tx.batch_execute(&format!("SET LOCAL hnsw.iterative_scan = {mode}")).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(url: &str) -> tokio_postgres::Config {
        let (normalized, _) = normalize_url(url);
        tokio_postgres::Config::from_str(&normalized).unwrap()
    }

    #[test]
    fn loopback_hosts_are_local() {
        for url in [
            "postgres://u@localhost/db",
            "postgres://u@127.0.0.1:5432/db",
            "host=::1 user=u dbname=d",
            "postgres://u@pg.localhost/db",
            "host=localhost user=u dbname=d",
        ] {
            assert!(is_local(&config(url)), "{url} should be local");
        }
    }

    #[test]
    #[cfg(unix)]
    fn unix_socket_paths_are_local() {
        assert!(is_local(&config("postgresql:///db?host=/var/run/postgresql")));
    }

    #[test]
    #[cfg(not(unix))]
    fn unsupported_socket_paths_do_not_disable_tls() {
        assert!(!is_local(&config("postgresql:///db?host=/var/run/postgresql")));
    }

    #[test]
    fn remote_hosts_are_not_local() {
        for url in [
            "postgres://u@db.example.com/db",
            "postgres://u@10.0.0.5/db",
            "postgres://u@ep-x-pooler.eu-central-1.aws.neon.tech/db",
            "postgres://u@localhost,db.example.com/db",
            "host=localhost hostaddr=10.1.1.1 user=u dbname=d",
        ] {
            assert!(!is_local(&config(url)), "{url} should not be local");
        }
    }

    #[test]
    fn url_normalisation_maps_libpq_options() {
        let (url, root) = normalize_url(
            "postgres://u:example-password@h/db?sslmode=verify-full&sslrootcert=%2Fetc%2Fca.pem&sslcert=x&application_name=a",
        );
        assert_eq!(url, "postgres://u:example-password@h/db?sslmode=require&application_name=a");
        assert_eq!(root.as_deref(), Some("/etc/ca.pem"));
        let (url, root) = normalize_url("postgres://u@h/db?sslmode=allow");
        assert_eq!(url, "postgres://u@h/db?sslmode=prefer");
        assert!(root.is_none());
        let (url, _) = normalize_url("postgres://u@h/db?sslkey=k");
        assert_eq!(url, "postgres://u@h/db");
        let (url, _) = normalize_url("host=h dbname=d");
        assert_eq!(url, "host=h dbname=d");
    }

    #[test]
    fn local_pool_is_plain_and_remote_pool_uses_tls() {
        let local = PgPool::connect_lazy("postgres://u:example-password@localhost/db").unwrap();
        assert!(!local.uses_tls());
        let remote =
            PgPool::connect_lazy("postgres://u:example-password@db.example.com/db").unwrap();
        assert!(remote.uses_tls());
        assert!(!remote.target().contains(":example-password@"));
        assert!(remote.target().contains(":***@"));
        let forced =
            PgPool::builder("postgres://u@localhost/db").tls(TlsPolicy::Require).build().unwrap();
        assert!(forced.uses_tls());
        let disabled =
            PgPool::builder("postgres://u@db.example.com/db?sslmode=disable").build().unwrap();
        assert!(!disabled.uses_tls());
    }

    #[test]
    fn invalid_url_error_never_contains_the_password() {
        let error = PgPool::connect_lazy("postgres://u:example-secret@h:notaport/db").unwrap_err();
        assert!(!error.to_string().contains("example-secret"), "{error}");
        assert!(matches!(error, SqlError::InvalidUrl(_)));
    }

    #[test]
    fn shared_pool_is_reused_per_url() {
        let a = shared_pool("postgres://u@localhost/shared_a").unwrap();
        let b = shared_pool("postgres://u@localhost/shared_a").unwrap();
        let c = shared_pool("postgres://u@localhost/shared_c").unwrap();
        assert!(Arc::ptr_eq(&a.target, &b.target), "same URL must reuse the pool");
        assert!(!Arc::ptr_eq(&a.target, &c.target), "different URL must get its own pool");
    }

    #[test]
    fn vector_helpers_reject_non_finite_values() {
        assert!(vector::from_f64(&[0.5, f64::NAN]).is_none());
        assert_eq!(vector::from_f64(&[0.5, 1.0]).unwrap().as_slice(), &[0.5_f32, 1.0]);
        assert_eq!(vector::from_f32(&[1.0, 2.0]).to_vec(), vec![1.0_f32, 2.0]);
    }
}
