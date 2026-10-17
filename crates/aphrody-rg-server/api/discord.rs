//! Discord HTTP interactions endpoint.
//!
//! Discord posts every interaction here and expects an answer within three
//! seconds. The edge verifies the Ed25519 signature, answers `PING` itself and
//! forwards everything else, raw, to the Bun executor of `apps/rg-bot`
//! (`RG_INTERACTIONS_EXECUTOR_URL`). The executor's JSON callback is relayed
//! when it arrives inside the budget; otherwise the edge acknowledges with a
//! deferred response and the executor finishes through the interaction
//! webhook.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use aphrody_rg_server::{
    deferred_response, interaction_kind, interaction_type, is_callback, parse_public_key,
    unavailable_response, verify_signature,
};
use ed25519_dalek::VerifyingKey;
use http_body_util::BodyExt;
use serde_json::Value;
use vercel_runtime::{Error, Request, Response, ResponseBody, run, service_fn};

/// Whole edge budget, from request arrival to the executor's answer. Discord
/// allows three seconds; the rest covers signature checks and the return trip.
const DEFAULT_BUDGET_MS: u64 = 2_500;

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}

fn public_key() -> Option<&'static VerifyingKey> {
    static KEY: OnceLock<Option<VerifyingKey>> = OnceLock::new();
    KEY.get_or_init(|| {
        std::env::var("DISCORD_PUBLIC_KEY")
            .ok()
            .as_deref()
            .and_then(parse_public_key)
    })
    .as_ref()
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("aphrody-rg-server/", env!("CARGO_PKG_VERSION")))
            .pool_idle_timeout(Duration::from_secs(60))
            .build()
            .expect("reqwest client")
    })
}

fn budget() -> Duration {
    let ms = std::env::var("RG_INTERACTIONS_BUDGET_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|ms| (100..=2_900).contains(ms))
        .unwrap_or(DEFAULT_BUDGET_MS);
    Duration::from_millis(ms)
}

fn json_response(status: u16, body: Value) -> Result<Response<ResponseBody>, Error> {
    Ok(Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(ResponseBody::from(body))?)
}

fn text_response(status: u16, body: &'static str) -> Result<Response<ResponseBody>, Error> {
    Ok(Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(ResponseBody::from(body))?)
}

async fn handler(req: Request) -> Result<Response<ResponseBody>, Error> {
    let started = Instant::now();
    if req.method() != "POST" {
        return text_response(405, "method not allowed");
    }
    let header = |name: &str| {
        req.headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };
    let signature = header("x-signature-ed25519");
    let timestamp = header("x-signature-timestamp");
    let body = req.into_body().collect().await?.to_bytes();

    let Some(key) = public_key() else {
        eprintln!("[rg-discord] DISCORD_PUBLIC_KEY missing or invalid");
        return text_response(500, "interactions endpoint not configured");
    };
    let (Some(signature), Some(timestamp)) = (signature, timestamp) else {
        return text_response(401, "invalid request signature");
    };
    if !verify_signature(key, &signature, &timestamp, &body) {
        return text_response(401, "invalid request signature");
    }

    let Some(kind) = serde_json::from_slice::<Value>(&body)
        .ok()
        .as_ref()
        .and_then(interaction_kind)
    else {
        return text_response(400, "malformed interaction");
    };
    if kind == interaction_type::PING {
        return json_response(200, deferred_response(kind));
    }

    let remaining = budget().saturating_sub(started.elapsed());
    match forward(body.to_vec(), remaining).await {
        Forwarded::Callback(callback) => Ok(Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .body(ResponseBody::from(callback))?),
        Forwarded::Deferred => json_response(200, deferred_response(kind)),
        Forwarded::Unavailable(reason) => {
            eprintln!("[rg-discord] executor unavailable for interaction type {kind}: {reason}");
            json_response(200, unavailable_response(kind))
        }
    }
}

enum Forwarded {
    /// The executor answered in time with a callback body (`{ "type": n, ... }`).
    Callback(Vec<u8>),
    /// The executor accepted the work (`202`) or the budget ran out: it keeps
    /// running and completes through the webhook.
    Deferred,
    /// The executor is not configured, unreachable or refused the call.
    Unavailable(String),
}

async fn forward(body: Vec<u8>, remaining: Duration) -> Forwarded {
    let Ok(url) = std::env::var("RG_INTERACTIONS_EXECUTOR_URL") else {
        return Forwarded::Unavailable("RG_INTERACTIONS_EXECUTOR_URL missing".into());
    };
    let Ok(secret) = std::env::var("RG_INTERNAL_SECRET") else {
        return Forwarded::Unavailable("RG_INTERNAL_SECRET missing".into());
    };
    let exchange = async {
        let response = http_client()
            .post(&url)
            .header("content-type", "application/json")
            .header("x-internal-secret", secret)
            .body(body)
            .send()
            .await?;
        let status = response.status().as_u16();
        let bytes = response.bytes().await?;
        Ok::<_, reqwest::Error>((status, bytes))
    };
    match tokio::time::timeout(remaining, exchange).await {
        Err(_) => Forwarded::Deferred,
        Ok(Err(error)) if error.is_timeout() => Forwarded::Deferred,
        Ok(Err(error)) => Forwarded::Unavailable(error.to_string()),
        Ok(Ok((202, _))) => Forwarded::Deferred,
        Ok(Ok((200, bytes))) if is_callback(&bytes) => Forwarded::Callback(bytes.to_vec()),
        Ok(Ok((status, _))) => Forwarded::Unavailable(format!("executor answered HTTP {status}")),
    }
}
