// SPDX-License-Identifier: Apache-2.0

// Preserve the imported parser's behavior while the source migration closes.
#![allow(clippy::needless_borrow, clippy::ptr_arg, clippy::collapsible_if)]

use std::{fs, path::PathBuf, time::UNIX_EPOCH};

use aes_gcm::{Aes256Gcm, Key, KeyInit, Nonce, aead::Aead};
use anyhow::{Result, anyhow};
use base64::Engine;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use windows::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CryptUnprotectData};

#[cfg(target_os = "windows")]
unsafe extern "system" {
    fn LocalFree(hmem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
}

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
                .filter_map(move |profile_dir| profile_metadata(&browser, &root, profile_dir))
        })
        .collect::<Vec<_>>();
    sort_profiles(&mut profiles);
    profiles
}

fn profile_metadata(browser: &str, root: &PathBuf, profile_dir: String) -> Option<ChromiumProfile> {
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
        user_data_dir: root.clone(),
        display_name: profile_display_name(root, &profile_dir),
        profile_dir,
        last_write_unix_ms,
        completeness_score,
    })
}

fn sort_profiles(profiles: &mut Vec<ChromiumProfile>) {
    profiles.sort_by(|a, b| {
        b.completeness_score
            .cmp(&a.completeness_score)
            .then_with(|| b.last_write_unix_ms.cmp(&a.last_write_unix_ms))
            .then_with(|| a.user_data_dir.cmp(&b.user_data_dir))
            .then_with(|| a.profile_dir.cmp(&b.profile_dir))
    });
}

fn profile_display_name(root: &PathBuf, profile: &str) -> Option<String> {
    let preferences = root.join(profile).join("Preferences");
    let content = fs::read_to_string(preferences).ok()?;
    serde_json::from_str::<serde_json::Value>(&content)
        .ok()?
        .get("profile")?
        .get("name")?
        .as_str()
        .map(str::to_owned)
}

pub struct Crypto;

impl Crypto {
    #[cfg(target_os = "windows")]
    pub fn decrypt_dpapi(data: &[u8]) -> Result<Vec<u8>> {
        unsafe {
            let input =
                CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
            let mut output = CRYPT_INTEGER_BLOB::default();

            if CryptUnprotectData(&input, None, None, None, None, 0, &mut output).is_ok() {
                let result =
                    std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
                let _ = LocalFree(output.pbData.cast());
                Ok(result)
            } else {
                Err(anyhow!("DPAPI decryption failed"))
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub fn decrypt_dpapi(_data: &[u8]) -> Result<Vec<u8>> {
        Err(anyhow!("DPAPI is only supported on Windows"))
    }

    pub fn decrypt_aes_gcm(ciphertext: &[u8], key: &[u8]) -> Result<Vec<u8>> {
        if ciphertext.len() < 15 {
            return Err(anyhow!("Ciphertext too short"));
        }

        let nonce_bytes = &ciphertext[3..15];
        let encrypted_data = &ciphertext[15..];

        let key = Key::<Aes256Gcm>::from_slice(key);
        let cipher = Aes256Gcm::new(key);
        let nonce = Nonce::from_slice(nonce_bytes);

        cipher
            .decrypt(nonce, encrypted_data)
            .map_err(|e| anyhow!("AES-GCM decryption failed: {}", e))
    }
}

pub struct ChromiumParser {
    user_data_path: PathBuf,
    master_key: Option<Vec<u8>>,
}

impl ChromiumParser {
    pub fn new(user_data_path: PathBuf) -> Self {
        Self { user_data_path, master_key: None }
    }

    pub fn get_profiles(&self) -> Vec<String> {
        let local_state_path = self.user_data_path.join("Local State");
        if !local_state_path.exists() {
            return vec!["Default".to_string()];
        }
        let content = fs::read_to_string(local_state_path).unwrap_or_default();
        let v: serde_json::Value = serde_json::from_str(&content).unwrap_or(serde_json::json!({}));

        let mut profiles = Vec::new();
        if let Some(info_cache) = v.get("profile").and_then(|p| p.get("info_cache")) {
            if let Some(obj) = info_cache.as_object() {
                for key in obj.keys() {
                    profiles.push(key.clone());
                }
            }
        }

        if profiles.is_empty() {
            profiles.push("Default".to_string());
        }
        profiles
    }

    pub fn load_master_key(&mut self) -> Result<()> {
        let local_state_path = self.user_data_path.join("Local State");
        let content = fs::read_to_string(local_state_path)?;
        let v: serde_json::Value = serde_json::from_str(&content)?;

        let b64_key = v["os_crypt"]["encrypted_key"]
            .as_str()
            .ok_or_else(|| anyhow!("Master key not found in Local State"))?;

        let decoded = base64::engine::general_purpose::STANDARD
            .decode(b64_key)
            .map_err(|e| anyhow!("Base64 decode error: {}", e))?;

        if decoded.len() < 5 || &decoded[0..5] != b"DPAPI" {
            return Err(anyhow!("Invalid key format (expected DPAPI prefix)"));
        }

        let encrypted_key = &decoded[5..];
        let master_key = Crypto::decrypt_dpapi(encrypted_key)?;

        self.master_key = Some(master_key);
        Ok(())
    }

    pub fn get_master_key(&self) -> Option<&Vec<u8>> {
        self.master_key.as_ref()
    }

    pub fn get_cookies(&self, profile: &str, host_key: &str) -> Result<Vec<(String, String)>> {
        let master_key =
            self.master_key.as_ref().ok_or_else(|| anyhow!("Master key not loaded"))?;

        let cookies_path = self.user_data_path.join(profile).join("Network/Cookies");
        if !cookies_path.exists() {
            return Err(anyhow!("Cookies file not found: {}", cookies_path.display()));
        }

        let temp_cookies = std::env::temp_dir().join("aphrody_web_chromium_cookies_temp.db");
        fs::copy(&cookies_path, &temp_cookies)?;

        let conn = rusqlite::Connection::open(&temp_cookies)?;
        let mut stmt =
            conn.prepare("SELECT name, encrypted_value FROM cookies WHERE host_key LIKE ?")?;

        let cookie_iter = stmt.query_map([format!("%{}%", host_key)], |row| {
            let name: String = row.get(0)?;
            let encrypted_value: Vec<u8> = row.get(1)?;
            Ok((name, encrypted_value))
        })?;

        let mut results = Vec::new();
        for cookie in cookie_iter {
            let (name, encrypted_value) = cookie?;
            if let Ok(decrypted) = Crypto::decrypt_aes_gcm(&encrypted_value, master_key) {
                if let Ok(value) = String::from_utf8(decrypted) {
                    results.push((name, value));
                }
            }
        }

        let _ = fs::remove_file(temp_cookies);
        Ok(results)
    }

    pub fn get_cookies_full(&self, profile: &str, host_key_like: &str) -> Result<Vec<Cookie>> {
        let master_key =
            self.master_key.as_ref().ok_or_else(|| anyhow!("Master key not loaded"))?;

        let cookies_path = self.user_data_path.join(profile).join("Network/Cookies");
        if !cookies_path.exists() {
            return Err(anyhow!("Cookies file not found: {}", cookies_path.display()));
        }

        let temp_cookies = std::env::temp_dir().join("aphrody_web_chromium_cookies_full_temp.db");
        fs::copy(&cookies_path, &temp_cookies)?;

        let conn = rusqlite::Connection::open(&temp_cookies)?;
        let mut stmt = conn.prepare(
            "SELECT host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly, \
             samesite FROM cookies WHERE host_key LIKE ?",
        )?;

        let pattern = format!("%{}%", host_key_like);
        let row_iter = stmt.query_map([pattern], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)? != 0,
                row.get::<_, i64>(6)? != 0,
                row.get::<_, i64>(7).unwrap_or(0),
            ))
        })?;

        let mut results = Vec::new();
        for row in row_iter {
            let (host_key, name, encrypted, path, expires_utc, is_secure, is_httponly, samesite) =
                row?;
            if let Ok(decrypted) = Crypto::decrypt_aes_gcm(&encrypted, master_key) {
                if let Ok(value) = String::from_utf8(decrypted) {
                    results.push(Cookie {
                        host_key,
                        name,
                        value,
                        path,
                        expires_utc,
                        is_secure,
                        is_httponly,
                        is_session: expires_utc == 0,
                        samesite,
                    });
                }
            }
        }

        let _ = fs::remove_file(temp_cookies);
        Ok(results)
    }
}
