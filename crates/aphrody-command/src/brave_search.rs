// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at
// https://mozilla.org/MPL/2.0/.
//
// Absorbed from brave/brave-search-cli v1.7.0 (fork aphrody-labs/brave-search-cli, 5df7479):
// web search request shape (src/main.rs), JSON body builder (src/query.rs) and API error
// formatting (src/api.rs), ported from blocking ureq to async reqwest.
//! Brave Search API backend of `aphrody search`.

use aphrody_secrets::{SecretStore, SecretValue};
use serde::Serialize;
use serde_json::Value;

pub(crate) const API_KEY_ENV: &str = "BRAVE_SEARCH_API_KEY";
pub(crate) const BASE_URL_ENV: &str = "APHRODY_BRAVE_BASE_URL";
const DEFAULT_BASE_URL: &str = "https://api.search.brave.com";
const WEB_SEARCH_PATH: &str = "/res/v1/web/search";
const MAX_RESPONSE_BODY_SIZE: usize = 3 * 1024 * 1024;

#[derive(Debug, Default, Clone)]
pub(crate) struct WebQuery {
    pub q: String,
    pub count: Option<u16>,
    pub offset: Option<u16>,
    pub freshness: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct Hit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Builds a JSON object from pre-typed key-value pairs, skipping `None` values.
fn build_json_body(params: &[(&str, Option<Value>)]) -> Value {
    let mut map = serde_json::Map::with_capacity(params.len());
    for (key, val) in params {
        if let Some(v) = val {
            map.insert((*key).into(), v.clone());
        }
    }
    Value::Object(map)
}

pub(crate) fn web_body(q: &WebQuery) -> Value {
    let mut body = build_json_body(&[
        ("country", q.country.clone().map(Into::into)),
        ("count", q.count.map(Into::into)),
        ("offset", q.offset.map(Into::into)),
        ("freshness", q.freshness.clone().map(Into::into)),
    ]);
    body["q"] = q.q.clone().into();
    body
}

/// `pd`, `pw`, `pm`, `py` or `YYYY-MM-DDtoYYYY-MM-DD`.
pub(crate) fn validate_freshness(v: &str) -> Result<String, String> {
    let date = |s: &str| {
        let b = s.as_bytes();
        b.len() == 10
            && b[4] == b'-'
            && b[7] == b'-'
            && b.iter()
                .enumerate()
                .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    };
    match v {
        "pd" | "pw" | "pm" | "py" => Ok(v.to_owned()),
        _ => match v.split_once("to") {
            Some((a, b)) if date(a) && date(b) => Ok(v.to_owned()),
            _ => Err("attendu pd, pw, pm, py ou YYYY-MM-DDtoYYYY-MM-DD".into()),
        },
    }
}

/// Formats an API error envelope (`{"error":{"code","detail"}}`).
fn format_error(status: u16, body: &str) -> String {
    let mut msg = match serde_json::from_str::<Value>(body) {
        Ok(v) if v["error"].is_object() => {
            let code = v["error"]["code"]
                .as_str()
                .unwrap_or("UNKNOWN")
                .to_lowercase()
                .replace('_', " ");
            match v["error"]["detail"].as_str().unwrap_or("") {
                "" => format!("{code} ({status})"),
                detail => format!("{code} ({status}) — {detail}"),
            }
        }
        _ => format!("HTTP {status}"),
    };
    match status {
        401 => msg.push_str(&format!("\nhint: vérifier {API_KEY_ENV}")),
        403 => msg.push_str("\nhint: cet endpoint peut exiger un autre plan API"),
        429 => msg.push_str("\nhint: réessayer après un court délai"),
        _ => {}
    }
    msg
}

fn parse_hits(body: &Value) -> Vec<Hit> {
    body["web"]["results"]
        .as_array()
        .map(|rs| {
            rs.iter()
                .map(|r| Hit {
                    title: r["title"].as_str().unwrap_or_default().to_owned(),
                    url: r["url"].as_str().unwrap_or_default().to_owned(),
                    snippet: r["description"].as_str().unwrap_or_default().to_owned(),
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) async fn api_key(store: &dyn SecretStore) -> miette::Result<SecretValue> {
    match store
        .get(API_KEY_ENV)
        .await
        .map_err(|e| miette::miette!("{e}"))?
    {
        Some(v) if !v.is_empty() => Ok(v),
        _ => Err(miette::miette!(
            "clé Brave Search absente : définir {API_KEY_ENV}"
        )),
    }
}

pub(crate) fn base_url() -> String {
    std::env::var(BASE_URL_ENV).unwrap_or_else(|_| DEFAULT_BASE_URL.to_owned())
}

pub(crate) async fn web_search(
    base: &str,
    key: &SecretValue,
    q: &WebQuery,
) -> miette::Result<Vec<Hit>> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("aphrody/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| miette::miette!("{e}"))?;
    let resp = client
        .post(format!("{}{WEB_SEARCH_PATH}", base.trim_end_matches('/')))
        .header("Accept", "application/json")
        .header("X-Subscription-Token", key.expose_secret())
        .json(&web_body(q))
        .send()
        .await
        .map_err(|e| miette::miette!("Brave Search : {e}"))?;
    let status = resp.status().as_u16();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| miette::miette!("Brave Search : {e}"))?;
    if bytes.len() > MAX_RESPONSE_BODY_SIZE {
        return Err(miette::miette!(
            "Brave Search : réponse trop grande ({} octets)",
            bytes.len()
        ));
    }
    let text = String::from_utf8_lossy(&bytes);
    if !(200..300).contains(&status) {
        return Err(miette::miette!(
            "Brave Search : {}",
            format_error(status, &text)
        ));
    }
    let body: Value = serde_json::from_str(&text)
        .map_err(|e| miette::miette!("Brave Search : JSON invalide : {e}"))?;
    Ok(parse_hits(&body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};

    #[test]
    fn body_skips_unset_params() {
        let q = WebQuery {
            q: "rust".into(),
            count: Some(5),
            offset: None,
            freshness: Some("pw".into()),
            country: Some("FR".into()),
        };
        assert_eq!(
            web_body(&q),
            serde_json::json!({"q":"rust","count":5,"freshness":"pw","country":"FR"})
        );
        assert_eq!(
            web_body(&WebQuery {
                q: "x".into(),
                ..Default::default()
            }),
            serde_json::json!({"q":"x"})
        );
    }

    #[test]
    fn freshness_values() {
        for ok in ["pd", "pw", "pm", "py", "2026-01-01to2026-02-01"] {
            assert_eq!(validate_freshness(ok).as_deref(), Ok(ok));
        }
        for bad in ["", "day", "2026-1-01to2026-02-01", "2026-01-01"] {
            assert!(validate_freshness(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn error_envelope() {
        let m = format_error(
            429,
            r#"{"error":{"code":"RATE_LIMITED","detail":"slow down"}}"#,
        );
        assert!(m.starts_with("rate limited (429) — slow down"), "{m}");
        assert_eq!(format_error(502, "<html>"), "HTTP 502");
    }

    /// One-shot local HTTP fixture: returns the base URL and a handle yielding the raw request.
    fn fixture(
        status: &'static str,
        body: &'static str,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            let mut len = 0usize;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap();
                }
                head.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let mut buf = vec![0; len];
            reader.read_exact(&mut buf).unwrap();
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            head + &String::from_utf8(buf).unwrap()
        });
        (base, handle)
    }

    #[tokio::test]
    async fn web_search_against_local_fixture() {
        let (base, server) = fixture(
            "200 OK",
            r#"{"type":"search","web":{"results":[{"title":"Rust","url":"https://www.rust-lang.org/","description":"A language"}]}}"#,
        );
        let q = WebQuery {
            q: "rust lang".into(),
            count: Some(3),
            offset: Some(1),
            freshness: Some("pm".into()),
            country: Some("US".into()),
        };
        let hits = web_search(&base, &SecretValue::from("test-key"), &q)
            .await
            .unwrap();
        assert_eq!(
            hits,
            vec![Hit {
                title: "Rust".into(),
                url: "https://www.rust-lang.org/".into(),
                snippet: "A language".into()
            }]
        );
        let req = server.join().unwrap();
        assert!(req.starts_with("POST /res/v1/web/search "), "{req}");
        assert!(
            req.to_ascii_lowercase()
                .contains("x-subscription-token: test-key"),
            "{req}"
        );
        let body: Value = serde_json::from_str(req.rsplit("\r\n\r\n").next().unwrap()).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"q":"rust lang","count":3,"offset":1,"freshness":"pm","country":"US"})
        );
    }

    #[tokio::test]
    async fn web_search_reports_api_error() {
        let (base, server) = fixture(
            "401 Unauthorized",
            r#"{"error":{"code":"SUBSCRIPTION_TOKEN_INVALID","detail":"bad"}}"#,
        );
        let err = web_search(
            &base,
            &SecretValue::from("k"),
            &WebQuery {
                q: "x".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        server.join().unwrap();
        let msg = err.to_string();
        assert!(
            msg.contains("subscription token invalid (401) — bad"),
            "{msg}"
        );
        assert!(msg.contains(API_KEY_ENV), "{msg}");
    }
}
