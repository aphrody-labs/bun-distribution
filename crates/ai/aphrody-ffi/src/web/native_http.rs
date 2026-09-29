//! Native Obscura HTTP transport exposed to Bun.
//!
//! This is the single low-level HTTP entrypoint for Aphrody Web. Plain requests use
//! `ObscuraHttpClient`; stealth requests use Obscura's Rust `wreq` transport
//! and Chrome emulation. Neither path spawns curl, Bun, Node, or Deno.

#[cfg(feature = "native-stealth")]
use std::sync::Arc;
use std::{ffi::c_char, sync::OnceLock, time::Duration};

use obscura_net::ObscuraHttpClient;
#[cfg(feature = "native-stealth")]
use obscura_net::{CookieJar, StealthHttpClient};
use serde_json::json;
use url::Url;

use super::{
    ffi_util::{borrow_str, error_json_string, guard, into_c_string, shared_runtime},
    jobs,
};

fn plain_client() -> &'static ObscuraHttpClient {
    static CLIENT: OnceLock<ObscuraHttpClient> = OnceLock::new();
    CLIENT.get_or_init(ObscuraHttpClient::new)
}

#[cfg(feature = "native-stealth")]
fn stealth_client() -> &'static StealthHttpClient {
    static CLIENT: OnceLock<StealthHttpClient> = OnceLock::new();
    CLIENT.get_or_init(|| StealthHttpClient::new(Arc::new(CookieJar::default())))
}

fn parse_url(raw: Option<&str>) -> Result<Url, String> {
    let raw = raw.ok_or_else(|| "url is null".to_string())?;
    let url = Url::parse(raw).map_err(|_| "url must be absolute".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("only http and https are supported".to_string());
    }
    Ok(url)
}

async fn fetch_json(url: Url, stealth: u8, timeout_ms: u32) -> String {
    let request = async {
        if stealth != 0 {
            #[cfg(feature = "native-stealth")]
            {
                return stealth_client().fetch(&url).await;
            }
            #[cfg(not(feature = "native-stealth"))]
            {
                return Err(obscura_net::ObscuraNetError::Network(
                    "native-stealth feature is not installed".into(),
                ));
            }
        }
        plain_client().fetch(&url).await
    };
    let response = if timeout_ms == 0 {
        request.await
    } else {
        match tokio::time::timeout(Duration::from_millis(u64::from(timeout_ms)), request).await {
            Ok(response) => response,
            Err(_) => Err(obscura_net::ObscuraNetError::Network("request timeout".into())),
        }
    };
    match response {
        Ok(response) => json!({
            "ok": true,
            "url": response.url.to_string(),
            "status": response.status,
            "headers": response.headers,
            "body": response.text(),
            "transport": if stealth != 0 { "obscura-wreq" } else { "obscura-reqwest" },
        })
        .to_string(),
        Err(error) => error_json_string(format!("native Obscura fetch failed: {error}")),
    }
}

/// Fetch a URL through the native Obscura transport.
///
/// `stealth != 0` selects Obscura's Rust Chrome-emulated `wreq` path. The
/// returned JSON owns its body as UTF-8-lossy text and is released with
/// `web_internal_free_string`.
///
/// # Safety
/// `url_ptr` must be null or point to a readable, NUL-terminated C string for
/// the duration of the call.
pub unsafe extern "C" fn web_internal_obscura_fetch(
    url_ptr: *const c_char,
    stealth: u8,
    timeout_ms: u32,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let url = match parse_url(unsafe { borrow_str(url_ptr) }) {
            Ok(url) => url,
            Err(error) => return into_c_string(error_json_string(error)),
        };
        match shared_runtime() {
            Ok(runtime) => into_c_string(runtime.block_on(fetch_json(url, stealth, timeout_ms))),
            Err(error) => into_c_string(error_json_string(error)),
        }
    })
}

/// Submit native HTTP work without blocking the caller's thread.
///
/// # Safety
/// `url_ptr` must be null or point to a readable, NUL-terminated C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_obscura_fetch_submit(
    url_ptr: *const c_char,
    stealth: u8,
    timeout_ms: u32,
) -> u64 {
    guard(0, || match parse_url(unsafe { borrow_str(url_ptr) }) {
        Ok(url) => jobs::submit(0, fetch_json(url, stealth, timeout_ms)),
        Err(error) => jobs::resolved(error_json_string(error)),
    })
}

#[cfg(test)]
mod tests {
    use std::ffi::CString;

    use super::*;

    #[test]
    fn rejects_non_http_without_network() {
        let url = CString::new("file:///tmp/nope").unwrap();
        let ptr = unsafe { web_internal_obscura_fetch(url.as_ptr(), 0, 1000) };
        let value = unsafe { std::ffi::CStr::from_ptr(ptr) }.to_string_lossy();
        assert!(value.contains("only http and https"));
        unsafe { crate::web_internal_free_string(ptr) };
    }

    #[test]
    fn invalid_async_request_completes_without_network() {
        let url = CString::new("file:///tmp/nope").unwrap();
        // SAFETY: the URL is a live NUL-terminated string for the call.
        let id = unsafe { aphrody_web_obscura_fetch_submit(url.as_ptr(), 0, 1000) };
        assert!(id > 0);
        assert_eq!(super::jobs::web_internal_job_status(id), 1);
        let ptr = super::jobs::web_internal_job_take(id);
        assert!(
            unsafe { std::ffi::CStr::from_ptr(ptr) }
                .to_string_lossy()
                .contains("only http and https")
        );
        unsafe { crate::aphrody_string_free(ptr) };
    }
}
