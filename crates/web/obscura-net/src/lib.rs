pub mod blocklist;
pub mod client;
pub mod cookies;
pub mod encoding;
pub mod interceptor;
pub mod robots;
#[cfg(feature = "stealth")]
pub mod wreq_client;

/// Configure the workspace's rustls provider before constructing a reqwest client.
/// An existing provider remains authoritative when the host already installed one.
pub fn ensure_rustls_crypto_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

pub use blocklist::is_blocked as is_tracker_blocked;
pub use client::{
    CallbackRegistry, ObscuraHttpClient, ObscuraNetError, RequestCallback, RequestCredentials,
    RequestInfo, RequestMode, ResourceRequest, ResourceType, Response, ResponseCallback,
    SsrfGuardResolver, env_allows_private_network, is_forbidden_ip,
};
pub use cookies::{
    CookieInfo, CookieJar, SameSiteContext, canonical_domain, default_cookie_path, same_site,
};
pub use encoding::{
    decode_non_html, decode_response, decode_response_with_name, decode_with_label, label_name,
    url_encode_query,
};
pub use robots::RobotsCache;
#[cfg(feature = "stealth")]
pub use wreq_client::{
    STEALTH_NAVIGATOR_PLATFORM, STEALTH_UA_PLATFORM, STEALTH_UA_PLATFORM_VERSION,
    STEALTH_USER_AGENT, StealthHttpClient,
};

// aphrody addition: subdomain OSINT (crt.sh + hackertarget) used by the web engine.
pub mod dns;
pub use dns::DnsRecon;

// aphrody addition: RFC HAR 1.2 serialization and replay
pub mod har;
pub use har::{Har, HarEntry, HarLog, HarRequest, HarResponse};
mod operator_hint;
pub use operator_hint::private_network_error_hint;
