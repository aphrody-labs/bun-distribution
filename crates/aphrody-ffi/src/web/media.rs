// SPDX-License-Identifier: Apache-2.0
//! Media extraction and embed resolution through the shared Rust ABI.

use std::{ffi::c_char, sync::OnceLock, time::Duration};

use aphrody_web_extract::media::{MediaRequest, MediaResponse, MediaTransport, ResolveOptions};
use reqwest::header::{HeaderName, HeaderValue, REFERER};
use serde::Deserialize;
use url::Url;

use super::{
    ffi_util::{borrow_str, error_json, error_json_string, guard, into_c_string, to_json_string},
    jobs,
};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaOptions {
    referer: Option<String>,
    user_agent: Option<String>,
    enumerate_variants: Option<bool>,
    max_hops: Option<usize>,
}

struct HttpMediaTransport;

fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
            reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::limited(8))
                .build()
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn valid_url(raw: &str) -> Result<String, String> {
    let parsed = Url::parse(raw).map_err(|error| format!("invalid URL: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("only http and https are supported".to_string());
    }
    Ok(parsed.to_string())
}

#[async_trait::async_trait]
impl MediaTransport for HttpMediaTransport {
    async fn fetch(&self, request: MediaRequest) -> Result<MediaResponse, String> {
        let url = valid_url(&request.url)?;
        let method = reqwest::Method::from_bytes(request.method.as_bytes())
            .map_err(|error| error.to_string())?;
        let mut builder = client()?.request(method, url);
        for (name, value) in request.headers {
            let name =
                HeaderName::from_bytes(name.as_bytes()).map_err(|error| error.to_string())?;
            let value = HeaderValue::from_str(&value).map_err(|error| error.to_string())?;
            builder = builder.header(name, value);
        }
        if let Some(referer) = request.referer {
            builder = builder.header(REFERER, referer);
        }
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
        if let Some(timeout_ms) = request.timeout_ms {
            builder = builder.timeout(Duration::from_millis(timeout_ms));
        }
        let response = builder.send().await.map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        let url = Some(response.url().to_string());
        let body = response.text().await.map_err(|error| error.to_string())?;
        Ok(MediaResponse { status, body, url })
    }
}

/// Extract media candidates from HTML or player JavaScript without network I/O.
///
/// The returned JSON string is owned by this library and must be released with
/// `aphrody_string_free`.
///
/// # Safety
/// Both pointers must be readable, NUL-terminated C strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_media_extract(
    source_ptr: *const c_char,
    base_url_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        let Some(source) = (unsafe { borrow_str(source_ptr) }) else {
            return error_json("source is null or invalid UTF-8");
        };
        let Some(base_url) = (unsafe { borrow_str(base_url_ptr) }) else {
            return error_json("base URL is null or invalid UTF-8");
        };
        let base_url = match valid_url(base_url) {
            Ok(url) => url,
            Err(error) => return error_json(error),
        };
        let payload = serde_json::json!({
            "candidates": aphrody_web_extract::media::extract_media_candidates(source, &base_url),
            "poster": aphrody_web_extract::media::extract_poster(source, &base_url),
        });
        into_c_string(payload.to_string())
    })
}

/// Resolve an embed URL asynchronously through the shared Web job registry.
///
/// `options_json` accepts `referer`, `userAgent`, `enumerateVariants`, and
/// `maxHops`. Poll with `aphrody_web_job_status` and take the JSON result with
/// `aphrody_web_job_take`.
///
/// # Safety
/// Both pointers must be null or readable, NUL-terminated C strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_web_media_resolve_submit(
    embed_url_ptr: *const c_char,
    options_json_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || {
        let Some(raw_url) = (unsafe { borrow_str(embed_url_ptr) }) else {
            return jobs::resolved(error_json_string("embed URL is null or invalid UTF-8"));
        };
        let url = match valid_url(raw_url) {
            Ok(url) => url,
            Err(error) => return jobs::resolved(error_json_string(error)),
        };
        let options = match unsafe { borrow_str(options_json_ptr) } {
            None => MediaOptions::default(),
            Some(raw) => match serde_json::from_str::<MediaOptions>(raw) {
                Ok(options) => options,
                Err(error) => return jobs::resolved(error_json_string(error)),
            },
        };
        jobs::submit(timeout_ms, async move {
            let transport = HttpMediaTransport;
            let mut resolve = ResolveOptions::new(&transport);
            resolve.referer = options.referer.as_deref();
            resolve.user_agent = options.user_agent.as_deref();
            resolve.enumerate_variants = options.enumerate_variants.unwrap_or(false);
            resolve.max_hops = options.max_hops.unwrap_or(1).min(8);
            resolve.timeout_ms = (timeout_ms != 0).then_some(u64::from(timeout_ms));
            to_json_string(&aphrody_web_extract::media::resolve_embed(&url, &resolve).await)
        })
    })
}

#[cfg(test)]
mod tests {
    use std::ffi::{CStr, CString};

    use super::*;

    #[test]
    fn extracts_media_with_shared_allocator() {
        let source = CString::new("<script>file: 'https://cdn.test/video.m3u8'</script>").unwrap();
        let url = CString::new("https://embed.test/player").unwrap();
        let result = unsafe { aphrody_web_media_extract(source.as_ptr(), url.as_ptr()) };
        let payload: serde_json::Value =
            serde_json::from_str(unsafe { CStr::from_ptr(result) }.to_str().unwrap()).unwrap();
        assert_eq!(payload["candidates"][0]["kind"], "hls");
        unsafe { crate::aphrody_string_free(result) };
    }

    #[test]
    fn invalid_url_resolves_without_network() {
        let url = CString::new("file:///tmp/player").unwrap();
        let id = unsafe { aphrody_web_media_resolve_submit(url.as_ptr(), std::ptr::null(), 1000) };
        assert_eq!(jobs::web_internal_job_status(id), 1);
        let result = jobs::web_internal_job_take(id);
        assert!(
            unsafe { CStr::from_ptr(result) }
                .to_string_lossy()
                .contains("only http")
        );
        unsafe { crate::aphrody_string_free(result) };
    }
}
