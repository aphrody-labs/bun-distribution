// SPDX-License-Identifier: Apache-2.0

use std::path::PathBuf;

use anyhow::{Result, anyhow};
use rookie_cookies::{FromPathRequest, from_path};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct Cookie {
    pub host_key: String,
    pub name: String,
    pub value: String,
    pub path: String,
    pub expires_utc: i64,
    pub is_secure: bool,
    pub is_httponly: bool,
    pub is_session: bool,
    pub samesite: i64,
}

/// `Debug` never prints the cookie value: logs and error chains must not carry credentials.
impl std::fmt::Debug for Cookie {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Cookie")
            .field("host_key", &self.host_key)
            .field("name", &self.name)
            .field("value", &"<redacted>")
            .field("path", &self.path)
            .field("expires_utc", &self.expires_utc)
            .field("is_secure", &self.is_secure)
            .field("is_httponly", &self.is_httponly)
            .field("is_session", &self.is_session)
            .field("samesite", &self.samesite)
            .finish()
    }
}

pub struct ChromiumParser {
    user_data_path: PathBuf,
}

impl ChromiumParser {
    pub fn new(user_data_path: PathBuf) -> Self {
        Self { user_data_path }
    }

    pub fn get_cookies_full(&self, profile: &str, host_key_like: &str) -> Result<Vec<Cookie>> {
        let cookies_path = self.user_data_path.join(profile).join("Network/Cookies");
        if !cookies_path.exists() {
            return Err(anyhow!(
                "Cookies file not found: {}",
                cookies_path.display()
            ));
        }
        let request = FromPathRequest::new(cookies_path).include_expired(true);
        #[cfg(target_os = "windows")]
        let request = request.chromium_local_state(self.user_data_path.join("Local State"));
        #[cfg(not(target_os = "windows"))]
        let request = request.chromium_browser_id(self.browser_id());

        let snapshot = from_path(request)?;
        Ok(snapshot
            .into_cookies()
            .into_iter()
            .filter(|cookie| cookie.domain.contains(host_key_like))
            .map(Cookie::from)
            .collect())
    }

    #[cfg(not(target_os = "windows"))]
    fn browser_id(&self) -> &'static str {
        if self
            .user_data_path
            .to_string_lossy()
            .to_ascii_lowercase()
            .contains("chromium")
        {
            "chromium"
        } else {
            "chrome"
        }
    }
}

impl From<rookie_cookies::enums::Cookie> for Cookie {
    fn from(cookie: rookie_cookies::enums::Cookie) -> Self {
        let expires_utc = cookie.expires.map_or(0, |unix_seconds| {
            unix_seconds
                .saturating_add(11_644_473_600)
                .saturating_mul(1_000_000)
                .min(i64::MAX as u64) as i64
        });
        Self {
            host_key: cookie.domain,
            name: cookie.name,
            value: cookie.value,
            path: cookie.path,
            expires_utc,
            is_secure: cookie.secure,
            is_httponly: cookie.http_only,
            is_session: cookie.expires.is_none(),
            samesite: cookie.same_site,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rookie_cookie_keeps_existing_json_shape_and_chromium_epoch() {
        let cookie = Cookie::from(rookie_cookies::enums::Cookie {
            domain: ".example.com".into(),
            path: "/".into(),
            secure: true,
            expires: Some(1_700_000_000),
            name: "session".into(),
            value: "secret".into(),
            http_only: true,
            same_site: 2,
        });
        assert_eq!(cookie.expires_utc, 13_344_473_600_000_000);
        assert!(!cookie.is_session);
        let json = serde_json::to_value(cookie).unwrap();
        assert_eq!(json["host_key"], ".example.com");
        assert_eq!(json["is_httponly"], true);
        assert_eq!(json["samesite"], 2);
    }

    #[test]
    fn debug_output_redacts_the_cookie_value() {
        let cookie = Cookie::from(rookie_cookies::enums::Cookie {
            domain: ".example.com".into(),
            path: "/".into(),
            secure: true,
            expires: None,
            name: "session".into(),
            value: "hunter2-secret-value".into(),
            http_only: true,
            same_site: 0,
        });
        let debug = format!("{cookie:?} {:#?}", vec![cookie.clone()]);
        assert!(!debug.contains("hunter2-secret-value"));
        assert!(debug.contains("<redacted>"));
        assert!(debug.contains("session"));
    }

    #[test]
    fn rookie_session_cookie_keeps_zero_expiry() {
        let cookie = Cookie::from(rookie_cookies::enums::Cookie {
            domain: "example.com".into(),
            path: "/".into(),
            secure: false,
            expires: None,
            name: "session".into(),
            value: String::new(),
            http_only: false,
            same_site: -1,
        });
        assert_eq!(cookie.expires_utc, 0);
        assert!(cookie.is_session);
    }
}
