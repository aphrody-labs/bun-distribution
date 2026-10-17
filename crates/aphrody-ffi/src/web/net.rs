// SPDX-License-Identifier: Apache-2.0
//! Network-bound symbols: DNS OSINT, Gemini web and the X private API.
//!
//! Each operation has one async body shared by two entry points:
//! - `web_internal_*` (legacy, synchronous): blocks the caller on the shared runtime. Kept for ABI
//!   compatibility; do not call it from an event loop.
//! - `web_internal_*_submit` (non-blocking): returns a job id immediately; the result is collected with
//!   `web_internal_job_take` (see `jobs.rs`).

use std::{future::Future, os::raw::c_char};

use aphrody_gemini_web::{GeminiModel, GeminiWebClient};
use aphrody_x::{XClient, XSession};

use super::{
    ffi_util::{
        borrow_str, error_json, error_json_string, guard, into_c_string, shared_runtime,
        to_json_string,
    },
    jobs,
};

/// Run `body` synchronously on the shared runtime and hand the JSON result to
/// the caller.
fn block_on_json(body: impl Future<Output = String>) -> *mut c_char {
    match shared_runtime() {
        Ok(rt) => into_c_string(rt.block_on(body)),
        Err(e) => error_json(e),
    }
}

fn owned(ptr: *const c_char, what: &str) -> Result<String, String> {
    if ptr.is_null() {
        return Err(format!("null {what} pointer"));
    }
    unsafe { borrow_str(ptr) }
        .map(str::to_string)
        .ok_or_else(|| format!("invalid UTF-8 in {what}"))
}

fn optional(ptr: *const c_char) -> Option<String> {
    unsafe { borrow_str(ptr) }.map(str::to_string)
}

// ---------------------------------------------------------------------------
// DNS OSINT
// ---------------------------------------------------------------------------

async fn dns_recon_body(domain: String) -> String {
    let recon = obscura_net::dns::DnsRecon::new();
    match recon.run_osint(&domain).await {
        Ok(subdomains) => to_json_string(&subdomains),
        Err(e) => error_json_string(format!("Failed to run DNS OSINT: {e}")),
    }
}

/// Run DNS reconnaissance for a domain and return JSON (blocking).
///
/// # Safety
///
/// `domain_ptr` must be null or point to a readable, NUL-terminated C string
/// for the duration of this call. The returned string must be released exactly
/// once with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_dns_recon(domain_ptr: *const c_char) -> *mut c_char {
    guard(std::ptr::null_mut(), || match owned(domain_ptr, "domain") {
        Ok(domain) => block_on_json(dns_recon_body(domain)),
        Err(_) => into_c_string("[]".to_string()),
    })
}

/// Non-blocking variant of [`web_internal_dns_recon`]. Returns a job id.
///
/// # Safety
///
/// `domain_ptr` must be null or point to a readable, NUL-terminated C string
/// for the duration of this call.
pub unsafe extern "C" fn web_internal_dns_recon_submit(
    domain_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || match owned(domain_ptr, "domain") {
        Ok(domain) => jobs::submit(timeout_ms, dns_recon_body(domain)),
        Err(e) => jobs::resolved(error_json_string(e)),
    })
}

// ---------------------------------------------------------------------------
// Gemini web
// ---------------------------------------------------------------------------

async fn gemini_ask_body(cookie_path: String, prompt: String, model: Option<String>) -> String {
    let client = match GeminiWebClient::from_cookie_file(&cookie_path, "en").await {
        Ok(client) => client,
        Err(error) => {
            return error_json_string(format!("Failed to execute Gemini request: {error}"));
        }
    };
    let header = gemini_model_header(model);
    match client.ask(&prompt, header.as_deref()).await {
        Ok(reply) => serde_json::json!({
            "text": reply.text,
            "conversation_id": reply.metadata.conversation_id,
            "response_id": reply.metadata.response_id,
            "choice_id": reply.metadata.choice_id,
        })
        .to_string(),
        Err(error) => error_json_string(format!("Failed to execute Gemini request: {error}")),
    }
}

fn gemini_model_header(model: Option<String>) -> Option<String> {
    model.map(|id| GeminiModel::from_id(&id).map_or(id, GeminiModel::header))
}

fn gemini_args(
    cookie_path_ptr: *const c_char,
    prompt_ptr: *const c_char,
    model_ptr: *const c_char,
) -> Result<(String, String, Option<String>), String> {
    Ok((
        owned(cookie_path_ptr, "cookie_path")?,
        owned(prompt_ptr, "prompt")?,
        optional(model_ptr),
    ))
}

/// Submit a prompt through the Gemini web client and return JSON (blocking).
///
/// # Safety
///
/// Every non-null pointer argument must point to a readable, NUL-terminated C
/// string for the duration of this call. `model_ptr` may be null. The returned
/// string must be released exactly once with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_gemini_web_ask(
    cookie_path_ptr: *const c_char,
    prompt_ptr: *const c_char,
    model_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        match gemini_args(cookie_path_ptr, prompt_ptr, model_ptr) {
            Ok((cookie_path, prompt, model)) => {
                block_on_json(gemini_ask_body(cookie_path, prompt, model))
            }
            Err(e) => error_json(e),
        }
    })
}

/// Non-blocking variant of [`web_internal_gemini_web_ask`]. Returns a job id.
///
/// # Safety
///
/// Same pointer contract as [`web_internal_gemini_web_ask`].
pub unsafe extern "C" fn web_internal_gemini_web_ask_submit(
    cookie_path_ptr: *const c_char,
    prompt_ptr: *const c_char,
    model_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || {
        match gemini_args(cookie_path_ptr, prompt_ptr, model_ptr) {
            Ok((cookie_path, prompt, model)) => {
                jobs::submit(timeout_ms, gemini_ask_body(cookie_path, prompt, model))
            }
            Err(e) => jobs::resolved(error_json_string(e)),
        }
    })
}

// ---------------------------------------------------------------------------
// X private web API (cookie auth: `auth_token` + `ct0`)
// ---------------------------------------------------------------------------

fn x_client(auth_token_ptr: *const c_char, ct0_ptr: *const c_char) -> Result<XClient, String> {
    let auth_token = owned(auth_token_ptr, "auth_token")?;
    let ct0 = owned(ct0_ptr, "ct0")?;
    XClient::new(XSession::new(&auth_token, &ct0))
        .map_err(|e| format!("Failed to build X client: {e}"))
}

fn page_size(count: u32) -> u32 {
    if count == 0 { 20 } else { count }
}

/// Validated inputs for an X operation: client plus the target identifier.
fn x_args(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    target_ptr: *const c_char,
    what: &str,
) -> Result<(XClient, String), String> {
    let target = owned(target_ptr, what)?;
    Ok((x_client(auth_token_ptr, ct0_ptr)?, target))
}

async fn x_user_by_screen_name_body(client: XClient, handle: String) -> String {
    match client.user_by_screen_name(&handle).await {
        Ok(info) => to_json_string(&info),
        Err(e) => error_json_string(format!("user_by_screen_name failed: {e}")),
    }
}

async fn x_user_tweets_body(client: XClient, handle: String, count: u32) -> String {
    let result = async {
        let uid = client.user_id_for(&handle).await?;
        client.user_tweets(&uid, page_size(count), None, 1).await
    }
    .await;
    match result {
        Ok(page) => to_json_string(&page),
        Err(e) => error_json_string(format!("user_tweets failed: {e}")),
    }
}

async fn x_community_by_rest_id_body(client: XClient, community_id: String) -> String {
    match client.community_by_rest_id(&community_id).await {
        Ok(value) => to_json_string(&value),
        Err(e) => error_json_string(format!("community_by_rest_id failed: {e}")),
    }
}

async fn x_community_tweets_body(client: XClient, community_id: String, count: u32) -> String {
    match client
        .community_timeline(&community_id, page_size(count), None, 1)
        .await
    {
        Ok(page) => to_json_string(&page),
        Err(e) => error_json_string(format!("community_tweets failed: {e}")),
    }
}

async fn x_community_info_and_tweets_body(
    client: XClient,
    community_id: String,
    count: u32,
) -> String {
    match client
        .community_info_and_timeline(&community_id, page_size(count), 1)
        .await
    {
        Ok((info, page)) => to_json_string(&serde_json::json!({ "info": info, "tweets": page })),
        Err(e) => error_json_string(format!("community_info_and_tweets failed: {e}")),
    }
}

/// Fetch a public user profile by `@handle` (blocking). Returns a JSON
/// `UserInfo` or `{"error": ...}`.
///
/// # Safety
///
/// Every pointer argument must point to a readable, NUL-terminated C string for
/// the duration of this call. The returned string must be released exactly once
/// with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_x_user_by_screen_name(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        match x_args(auth_token_ptr, ct0_ptr, handle_ptr, "handle") {
            Ok((client, handle)) => block_on_json(x_user_by_screen_name_body(client, handle)),
            Err(e) => error_json(e),
        }
    })
}

/// Non-blocking variant of [`web_internal_x_user_by_screen_name`]. Returns a job id.
///
/// # Safety
///
/// Same pointer contract as [`web_internal_x_user_by_screen_name`].
pub unsafe extern "C" fn web_internal_x_user_by_screen_name_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || {
        match x_args(auth_token_ptr, ct0_ptr, handle_ptr, "handle") {
            Ok((client, handle)) => {
                jobs::submit(timeout_ms, x_user_by_screen_name_body(client, handle))
            }
            Err(e) => jobs::resolved(error_json_string(e)),
        }
    })
}

/// Fetch up to `count` tweets from a user's timeline by `@handle` (blocking).
///
/// # Safety
///
/// Same pointer contract as [`web_internal_x_user_by_screen_name`].
pub unsafe extern "C" fn web_internal_x_user_tweets(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
    count: u32,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        match x_args(auth_token_ptr, ct0_ptr, handle_ptr, "handle") {
            Ok((client, handle)) => block_on_json(x_user_tweets_body(client, handle, count)),
            Err(e) => error_json(e),
        }
    })
}

/// Non-blocking variant of [`web_internal_x_user_tweets`]. Returns a job id.
///
/// # Safety
///
/// Same pointer contract as [`web_internal_x_user_by_screen_name`].
pub unsafe extern "C" fn web_internal_x_user_tweets_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
    count: u32,
    timeout_ms: u32,
) -> u64 {
    guard(0, || {
        match x_args(auth_token_ptr, ct0_ptr, handle_ptr, "handle") {
            Ok((client, handle)) => {
                jobs::submit(timeout_ms, x_user_tweets_body(client, handle, count))
            }
            Err(e) => jobs::resolved(error_json_string(e)),
        }
    })
}

/// Fetch community metadata by numeric rest id (blocking).
///
/// # Safety
///
/// Same pointer contract as [`web_internal_x_user_by_screen_name`].
pub unsafe extern "C" fn web_internal_x_community_by_rest_id(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        match x_args(auth_token_ptr, ct0_ptr, community_id_ptr, "community_id") {
            Ok((client, id)) => block_on_json(x_community_by_rest_id_body(client, id)),
            Err(e) => error_json(e),
        }
    })
}

/// Non-blocking variant of [`web_internal_x_community_by_rest_id`]. Returns a job id.
///
/// # Safety
///
/// Same pointer contract as [`web_internal_x_user_by_screen_name`].
pub unsafe extern "C" fn web_internal_x_community_by_rest_id_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || {
        match x_args(auth_token_ptr, ct0_ptr, community_id_ptr, "community_id") {
            Ok((client, id)) => jobs::submit(timeout_ms, x_community_by_rest_id_body(client, id)),
            Err(e) => jobs::resolved(error_json_string(e)),
        }
    })
}

/// Fetch up to `count` tweets from a community timeline (blocking).
///
/// # Safety
///
/// Same pointer contract as [`web_internal_x_user_by_screen_name`].
pub unsafe extern "C" fn web_internal_x_community_tweets(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    count: u32,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        match x_args(auth_token_ptr, ct0_ptr, community_id_ptr, "community_id") {
            Ok((client, id)) => block_on_json(x_community_tweets_body(client, id, count)),
            Err(e) => error_json(e),
        }
    })
}

/// Non-blocking variant of [`web_internal_x_community_tweets`]. Returns a job id.
///
/// # Safety
///
/// Same pointer contract as [`web_internal_x_user_by_screen_name`].
pub unsafe extern "C" fn web_internal_x_community_tweets_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    count: u32,
    timeout_ms: u32,
) -> u64 {
    guard(0, || {
        match x_args(auth_token_ptr, ct0_ptr, community_id_ptr, "community_id") {
            Ok((client, id)) => {
                jobs::submit(timeout_ms, x_community_tweets_body(client, id, count))
            }
            Err(e) => jobs::resolved(error_json_string(e)),
        }
    })
}

/// Fetch community info and initial tweets concurrently (blocking). Returns
/// `{"info": ..., "tweets": ...}` or `{"error": ...}`.
///
/// # Safety
///
/// Same pointer contract as [`web_internal_x_user_by_screen_name`].
pub unsafe extern "C" fn web_internal_x_community_info_and_tweets(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    count: u32,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        match x_args(auth_token_ptr, ct0_ptr, community_id_ptr, "community_id") {
            Ok((client, id)) => block_on_json(x_community_info_and_tweets_body(client, id, count)),
            Err(e) => error_json(e),
        }
    })
}

/// Non-blocking variant of [`web_internal_x_community_info_and_tweets`]. Returns a job id.
///
/// # Safety
///
/// Same pointer contract as [`web_internal_x_user_by_screen_name`].
pub unsafe extern "C" fn web_internal_x_community_info_and_tweets_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    count: u32,
    timeout_ms: u32,
) -> u64 {
    guard(0, || {
        match x_args(auth_token_ptr, ct0_ptr, community_id_ptr, "community_id") {
            Ok((client, id)) => jobs::submit(
                timeout_ms,
                x_community_info_and_tweets_body(client, id, count),
            ),
            Err(e) => jobs::resolved(error_json_string(e)),
        }
    })
}

/// Rank post candidates (JSON array of `aphrody_x::algorithm::PostCandidate`) with the
/// native For You algorithm. `context_json_ptr` may be null. CPU-only, so it
/// stays synchronous.
///
/// # Safety
///
/// `candidates_json_ptr` must point to a readable, NUL-terminated C string;
/// `context_json_ptr` may be null or satisfy the same requirement. The returned
/// string must be released exactly once with `web_internal_free_string`.
pub unsafe extern "C" fn web_internal_x_algorithm_rank(
    candidates_json_ptr: *const c_char,
    context_json_ptr: *const c_char,
    top_k: u32,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || {
        if candidates_json_ptr.is_null() {
            return error_json("null candidates pointer");
        }
        let Some(candidates) = (unsafe { borrow_str(candidates_json_ptr) }) else {
            return error_json("invalid utf8 in candidates json");
        };
        let context = unsafe { borrow_str(context_json_ptr) }.unwrap_or_default();
        match aphrody_x::algorithm::rank_posts_json(candidates, context, top_k) {
            Ok(json) => into_c_string(json),
            Err(e) => error_json(e),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gemini_model_mapping_preserves_custom_header() {
        assert_eq!(
            gemini_model_header(Some("flash".into())),
            Some(GeminiModel::Flash.header())
        );
        assert_eq!(
            gemini_model_header(Some("custom".into())),
            Some("custom".into())
        );
        assert_eq!(gemini_model_header(None), None);
    }

    #[test]
    fn gemini_missing_cookie_file_returns_json_error() {
        let missing =
            std::env::temp_dir().join(format!("aphrody-ffi-missing-cookie-{}", std::process::id()));
        let response = shared_runtime().unwrap().block_on(gemini_ask_body(
            missing.display().to_string(),
            "hello".into(),
            None,
        ));
        let json: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert!(
            json["error"]
                .as_str()
                .is_some_and(|error| error.contains("Gemini"))
        );
    }
}
