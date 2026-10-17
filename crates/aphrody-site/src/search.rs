// SPDX-License-Identifier: Apache-2.0
use aphrody_google::search::{execute_search_request, parse_search_request};
use axum::{
    Json,
    extract::Query,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{sync::OnceLock, time::Duration};
use tokio::sync::Semaphore;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SearchQuery {
    query: String,
    vertical: Option<String>,
    hl: Option<String>,
    safe: Option<String>,
    start: Option<u32>,
}

impl SearchQuery {
    fn arguments(self) -> Result<Value, String> {
        if self.query.trim().is_empty() || self.query.len() > 1024 {
            return Err("query must contain 1 to 1024 bytes".to_owned());
        }
        if self.start.unwrap_or_default() > 90 {
            return Err("start must be between 0 and 90".to_owned());
        }
        let args = json!({
            "query": self.query.trim(),
            "vertical": self.vertical.unwrap_or_else(|| "web".to_owned()),
            "hl": self.hl.unwrap_or_else(|| "en".to_owned()),
            "safe": self.safe.unwrap_or_else(|| "active".to_owned()),
            "start": self.start.unwrap_or_default(),
            "num": 10,
            "anonymous": true,
            "rich": false,
        });
        parse_search_request(&args)?;
        Ok(args)
    }
}

fn search_response(status: StatusCode, body: Value) -> Response {
    let mut response = (status, Json(body)).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response
}

pub async fn search(Query(query): Query<SearchQuery>) -> Response {
    let args = match query.arguments() {
        Ok(args) => args,
        Err(error) => return search_response(StatusCode::BAD_REQUEST, json!({ "error": error })),
    };
    static CAPACITY: OnceLock<Semaphore> = OnceLock::new();
    let Ok(_permit) = CAPACITY.get_or_init(|| Semaphore::new(4)).try_acquire() else {
        return search_response(
            StatusCode::TOO_MANY_REQUESTS,
            json!({ "error": "Search is busy" }),
        );
    };
    match tokio::time::timeout(Duration::from_secs(20), execute_search_request(&args)).await {
        Ok(Ok(result)) => search_response(StatusCode::OK, result),
        Ok(Err(_)) => search_response(
            StatusCode::BAD_GATEWAY,
            json!({ "error": "Search is temporarily unavailable" }),
        ),
        Err(_) => search_response(
            StatusCode::GATEWAY_TIMEOUT,
            json!({ "error": "Search timed out" }),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_search_forces_anonymous_owner_request_and_bounds_pagination() {
        let query: SearchQuery = serde_json::from_value(json!({ "query": " Aphrody " })).unwrap();
        let args = query.arguments().unwrap();
        assert_eq!(args["query"], "Aphrody");
        assert_eq!(args["anonymous"], true);
        assert_eq!(args["safe"], "active");
        assert_eq!(args["num"], 10);
        for value in [
            json!({ "query": "" }),
            json!({ "query": "Aphrody", "start": 91 }),
        ] {
            assert!(
                serde_json::from_value::<SearchQuery>(value)
                    .unwrap()
                    .arguments()
                    .is_err()
            );
        }
    }

    #[test]
    fn public_search_cannot_select_cookie_stores_or_arbitrary_domains() {
        for field in ["anonymous", "cookie_path", "domain", "command", "num"] {
            let mut query = json!({ "query": "Aphrody" });
            query[field] = json!("unauthorized");
            assert!(serde_json::from_value::<SearchQuery>(query).is_err());
        }
    }
}
