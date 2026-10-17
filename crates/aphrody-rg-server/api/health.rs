use serde_json::json;
use vercel_runtime::{Error, Request, Response, ResponseBody, run, service_fn};

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}

async fn handler(_req: Request) -> Result<Response<ResponseBody>, Error> {
    let body = json!({
        "status": "ok",
        "service": "rg-discord",
        "version": env!("CARGO_PKG_VERSION"),
        "publicKeyConfigured": std::env::var("DISCORD_PUBLIC_KEY").is_ok_and(|key| aphrody_rg_server::parse_public_key(&key).is_some()),
        "executorConfigured": std::env::var("RG_INTERACTIONS_EXECUTOR_URL").is_ok_and(|url| !url.is_empty()),
    });
    Ok(Response::builder()
        .status(200)
        .header("content-type", "application/json")
        .header("cache-control", "no-store")
        .body(ResponseBody::from(body))?)
}
