// SPDX-License-Identifier: Apache-2.0

use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use anyhow::{Result, anyhow};
use rookie_cookies::{FromPathRequest, from_path};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
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

/// Sanitized profile metadata safe to expose through the kernel.
/// Cookie values, encrypted databases and master keys never belong here.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ChromiumProfile {
    pub browser: String,
    pub user_data_dir: PathBuf,
    pub profile_dir: String,
    pub display_name: Option<String>,
    pub last_write_unix_ms: u128,
    pub completeness_score: u8,
}

/// Discover installed Chrome/Chromium user-data roots on the current platform.
/// This is read-only and does not start a browser or touch profile databases.
pub fn discover_profiles() -> Vec<ChromiumProfile> {
    let mut roots = Vec::new();
    #[cfg(target_os = "windows")]
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let base = PathBuf::from(local_app_data);
        roots.push(("chrome", base.join("Google/Chrome/User Data")));
        roots.push(("chromium", base.join("Chromium/User Data")));
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        let base = PathBuf::from(home);
        roots.push(("chrome", base.join("Library/Application Support/Google/Chrome")));
        roots.push(("chromium", base.join("Library/Application Support/Chromium")));
    }
    #[cfg(target_os = "linux")]
    if let Some(home) = std::env::var_os("HOME") {
        let base = PathBuf::from(home);
        roots.push(("chrome", base.join(".config/google-chrome")));
        roots.push(("chromium", base.join(".config/chromium")));
    }

    let mut profiles = roots
        .into_iter()
        .filter(|(_, root)| root.is_dir())
        .flat_map(|(browser, root)| {
            ChromiumParser::new(root.clone())
                .get_profiles()
                .into_iter()
                .filter_map(move |profile_dir| profile_metadata(browser, &root, profile_dir))
        })
        .collect::<Vec<_>>();
    sort_profiles(&mut profiles);
    profiles
}

fn profile_metadata(browser: &str, root: &Path, profile_dir: String) -> Option<ChromiumProfile> {
    let path = root.join(&profile_dir);
    let last_write_unix_ms =
        fs::metadata(&path).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis();

    // Presence/size only: never open credential, cookie, or session databases.
    let safe_files = ["Preferences", "Bookmarks", "History", "Web Data", "Extensions"];
    let completeness_score =
        safe_files.iter().filter(|name| path.join(name).exists()).count().min(u8::MAX as usize)
            as u8;

    Some(ChromiumProfile {
        browser: browser.to_owned(),
        user_data_dir: root.to_path_buf(),
        display_name: profile_display_name(root, &profile_dir),
        profile_dir,
        last_write_unix_ms,
        completeness_score,
    })
}

fn sort_profiles(profiles: &mut [ChromiumProfile]) {
    profiles.sort_by(|a, b| {
        b.completeness_score
            .cmp(&a.completeness_score)
            .then_with(|| b.last_write_unix_ms.cmp(&a.last_write_unix_ms))
            .then_with(|| a.user_data_dir.cmp(&b.user_data_dir))
            .then_with(|| a.profile_dir.cmp(&b.profile_dir))
    });
}

fn profile_display_name(root: &Path, profile: &str) -> Option<String> {
    let preferences = root.join(profile).join("Preferences");
    let content = fs::read_to_string(preferences).ok()?;
    serde_json::from_str::<serde_json::Value>(&content)
        .ok()?
        .get("profile")?
        .get("name")?
        .as_str()
        .map(str::to_owned)
}

pub struct ChromiumParser {
    user_data_path: PathBuf,
}

impl ChromiumParser {
    pub fn new(user_data_path: PathBuf) -> Self {
        Self { user_data_path }
    }

    pub fn get_profiles(&self) -> Vec<String> {
        let local_state_path = self.user_data_path.join("Local State");
        if !local_state_path.exists() {
            return vec!["Default".to_string()];
        }
        let content = fs::read_to_string(local_state_path).unwrap_or_default();
        let v: serde_json::Value = serde_json::from_str(&content).unwrap_or(serde_json::json!({}));

        let mut profiles = Vec::new();
        if let Some(info_cache) = v.get("profile").and_then(|p| p.get("info_cache"))
            && let Some(obj) = info_cache.as_object()
        {
            for key in obj.keys() {
                profiles.push(key.clone());
            }
        }

        if profiles.is_empty() {
            profiles.push("Default".to_string());
        }
        profiles
    }

    pub fn get_cookies(&self, profile: &str, host_key: &str) -> Result<Vec<(String, String)>> {
        Ok(self
            .get_cookies_full(profile, host_key)?
            .into_iter()
            .map(|cookie| (cookie.name, cookie.value))
            .collect())
    }

    pub fn get_cookies_full(&self, profile: &str, host_key_like: &str) -> Result<Vec<Cookie>> {
        let cookies_path = self.user_data_path.join(profile).join("Network/Cookies");
        if !cookies_path.exists() {
            return Err(anyhow!("Cookies file not found: {}", cookies_path.display()));
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
        if self.user_data_path.to_string_lossy().to_ascii_lowercase().contains("chromium") {
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
