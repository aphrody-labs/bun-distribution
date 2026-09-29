//! Network-bound symbols: DNS OSINT, Gemini web and the X private API.
//!
//! Each operation has one async body shared by two entry points:
//! - `bxc_*` (legacy, synchronous): blocks the caller on the shared runtime. Kept for ABI
//!   compatibility; do not call it from an event loop.
//! - `bxc_*_submit` (non-blocking): returns a job id immediately; the result is collected with
//!   `bxc_job_take` (see `jobs.rs`).

use std::{future::Future, os::raw::c_char, process::Stdio};

use aphrody_x::{XClient, XSession};
use tokio::io::AsyncWriteExt;

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
    unsafe { borrow_str(ptr) }.map(str::to_string).ok_or_else(|| format!("invalid UTF-8 in {what}"))
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
/// once with `bxc_free_string`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_dns_recon(domain_ptr: *const c_char) -> *mut c_char {
    guard(std::ptr::null_mut(), || match owned(domain_ptr, "domain") {
        Ok(domain) => block_on_json(dns_recon_body(domain)),
        Err(_) => into_c_string("[]".to_string()),
    })
}

/// Non-blocking variant of [`bxc_dns_recon`]. Returns a job id.
///
/// # Safety
///
/// `domain_ptr` must be null or point to a readable, NUL-terminated C string
/// for the duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_dns_recon_submit(domain_ptr: *const c_char, timeout_ms: u32) -> u64 {
    guard(0, || match owned(domain_ptr, "domain") {
        Ok(domain) => jobs::submit(timeout_ms, dns_recon_body(domain)),
        Err(e) => jobs::resolved(error_json_string(e)),
    })
}

// ---------------------------------------------------------------------------
// Gemini web
// ---------------------------------------------------------------------------

async fn gemini_ask_body(cookie_path: String, prompt: String, model: Option<String>) -> String {
    let binary = std::env::var_os("APHRODY_GEMINI_WEB_BIN")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "aphrody-gemini-web".into());
    let mut child = match tokio::process::Command::new(binary)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(error) => return error_json_string(format!("Gemini AI process unavailable: {error}")),
    };
    let request = serde_json::json!({
        "cookie_path": cookie_path,
        "prompt": prompt,
        "model": model,
    })
    .to_string();
    match child.stdin.take() {
        Some(mut stdin) => {
            if let Err(error) = stdin.write_all(request.as_bytes()).await {
                return error_json_string(format!("Gemini AI process input failed: {error}"));
            }
        },
        _ => {
            return error_json_string("Gemini AI process has no stdin");
        },
    }
    let output = match child.wait_with_output().await {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            return error_json_string(format!("Gemini AI process exited with {}", output.status));
        },
        Err(error) => return error_json_string(format!("Gemini AI process failed: {error}")),
    };
    match serde_json::from_slice::<serde_json::Value>(&output.stdout) {
        Ok(value @ serde_json::Value::Object(_)) => value.to_string(),
        _ => error_json_string("Gemini AI process returned invalid JSON"),
    }
}

fn gemini_args(
    cookie_path_ptr: *const c_char,
    prompt_ptr: *const c_char,
    model_ptr: *const c_char,
) -> Result<(String, String, Option<String>), String> {
    Ok((owned(cookie_path_ptr, "cookie_path")?, owned(prompt_ptr, "prompt")?, optional(model_ptr)))
}

/// Submit a prompt through the Gemini web client and return JSON (blocking).
///
/// # Safety
///
/// Every non-null pointer argument must point to a readable, NUL-terminated C
/// string for the duration of this call. `model_ptr` may be null. The returned
/// string must be released exactly once with `bxc_free_string`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_gemini_web_ask(
    cookie_path_ptr: *const c_char,
    prompt_ptr: *const c_char,
    model_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || match gemini_args(cookie_path_ptr, prompt_ptr, model_ptr) {
        Ok((cookie_path, prompt, model)) => {
            block_on_json(gemini_ask_body(cookie_path, prompt, model))
        },
        Err(e) => error_json(e),
    })
}

/// Non-blocking variant of [`bxc_gemini_web_ask`]. Returns a job id.
///
/// # Safety
///
/// Same pointer contract as [`bxc_gemini_web_ask`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_gemini_web_ask_submit(
    cookie_path_ptr: *const c_char,
    prompt_ptr: *const c_char,
    model_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || match gemini_args(cookie_path_ptr, prompt_ptr, model_ptr) {
        Ok((cookie_path, prompt, model)) => {
            jobs::submit(timeout_ms, gemini_ask_body(cookie_path, prompt, model))
        },
        Err(e) => jobs::resolved(error_json_string(e)),
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
    match client.community_timeline(&community_id, page_size(count), None, 1).await {
        Ok(page) => to_json_string(&page),
        Err(e) => error_json_string(format!("community_tweets failed: {e}")),
    }
}

async fn x_community_info_and_tweets_body(
    client: XClient,
    community_id: String,
    count: u32,
) -> String {
    match client.community_info_and_timeline(&community_id, page_size(count), 1).await {
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
/// with `bxc_free_string`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_x_user_by_screen_name(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || match x_args(auth_token_ptr, ct0_ptr, handle_ptr, "handle") {
        Ok((client, handle)) => block_on_json(x_user_by_screen_name_body(client, handle)),
        Err(e) => error_json(e),
    })
}

/// Non-blocking variant of [`bxc_x_user_by_screen_name`]. Returns a job id.
///
/// # Safety
///
/// Same pointer contract as [`bxc_x_user_by_screen_name`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_x_user_by_screen_name_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || match x_args(auth_token_ptr, ct0_ptr, handle_ptr, "handle") {
        Ok((client, handle)) => {
            jobs::submit(timeout_ms, x_user_by_screen_name_body(client, handle))
        },
        Err(e) => jobs::resolved(error_json_string(e)),
    })
}

/// Fetch up to `count` tweets from a user's timeline by `@handle` (blocking).
///
/// # Safety
///
/// Same pointer contract as [`bxc_x_user_by_screen_name`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_x_user_tweets(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
    count: u32,
) -> *mut c_char {
    guard(std::ptr::null_mut(), || match x_args(auth_token_ptr, ct0_ptr, handle_ptr, "handle") {
        Ok((client, handle)) => block_on_json(x_user_tweets_body(client, handle, count)),
        Err(e) => error_json(e),
    })
}

/// Non-blocking variant of [`bxc_x_user_tweets`]. Returns a job id.
///
/// # Safety
///
/// Same pointer contract as [`bxc_x_user_by_screen_name`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_x_user_tweets_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    handle_ptr: *const c_char,
    count: u32,
    timeout_ms: u32,
) -> u64 {
    guard(0, || match x_args(auth_token_ptr, ct0_ptr, handle_ptr, "handle") {
        Ok((client, handle)) => jobs::submit(timeout_ms, x_user_tweets_body(client, handle, count)),
        Err(e) => jobs::resolved(error_json_string(e)),
    })
}

/// Fetch community metadata by numeric rest id (blocking).
///
/// # Safety
///
/// Same pointer contract as [`bxc_x_user_by_screen_name`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_x_community_by_rest_id(
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

/// Non-blocking variant of [`bxc_x_community_by_rest_id`]. Returns a job id.
///
/// # Safety
///
/// Same pointer contract as [`bxc_x_user_by_screen_name`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_x_community_by_rest_id_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    timeout_ms: u32,
) -> u64 {
    guard(0, || match x_args(auth_token_ptr, ct0_ptr, community_id_ptr, "community_id") {
        Ok((client, id)) => jobs::submit(timeout_ms, x_community_by_rest_id_body(client, id)),
        Err(e) => jobs::resolved(error_json_string(e)),
    })
}

/// Fetch up to `count` tweets from a community timeline (blocking).
///
/// # Safety
///
/// Same pointer contract as [`bxc_x_user_by_screen_name`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_x_community_tweets(
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

/// Non-blocking variant of [`bxc_x_community_tweets`]. Returns a job id.
///
/// # Safety
///
/// Same pointer contract as [`bxc_x_user_by_screen_name`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_x_community_tweets_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    count: u32,
    timeout_ms: u32,
) -> u64 {
    guard(0, || match x_args(auth_token_ptr, ct0_ptr, community_id_ptr, "community_id") {
        Ok((client, id)) => jobs::submit(timeout_ms, x_community_tweets_body(client, id, count)),
        Err(e) => jobs::resolved(error_json_string(e)),
    })
}

/// Fetch community info and initial tweets concurrently (blocking). Returns
/// `{"info": ..., "tweets": ...}` or `{"error": ...}`.
///
/// # Safety
///
/// Same pointer contract as [`bxc_x_user_by_screen_name`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_x_community_info_and_tweets(
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

/// Non-blocking variant of [`bxc_x_community_info_and_tweets`]. Returns a job id.
///
/// # Safety
///
/// Same pointer contract as [`bxc_x_user_by_screen_name`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_x_community_info_and_tweets_submit(
    auth_token_ptr: *const c_char,
    ct0_ptr: *const c_char,
    community_id_ptr: *const c_char,
    count: u32,
    timeout_ms: u32,
) -> u64 {
    guard(0, || match x_args(auth_token_ptr, ct0_ptr, community_id_ptr, "community_id") {
        Ok((client, id)) => {
            jobs::submit(timeout_ms, x_community_info_and_tweets_body(client, id, count))
        },
        Err(e) => jobs::resolved(error_json_string(e)),
    })
}

/// Rank post candidates (JSON array of `aphrody_x_algorithm::PostCandidate`) with the
/// native For You algorithm. `context_json_ptr` may be null. CPU-only, so it
/// stays synchronous.
///
/// # Safety
///
/// `candidates_json_ptr` must point to a readable, NUL-terminated C string;
/// `context_json_ptr` may be null or satisfy the same requirement. The returned
/// string must be released exactly once with `bxc_free_string`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bxc_x_algorithm_rank(
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
        match aphrody_x_algorithm::rank_posts_json(candidates, context, top_k) {
            Ok(json) => into_c_string(json),
            Err(e) => error_json(e),
        }
    })
}
