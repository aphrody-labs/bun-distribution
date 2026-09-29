// SPDX-License-Identifier: Apache-2.0
//! Public Archive and Google HTTP tools served directly by the Rust MCP host.

use std::{sync::LazyLock, time::Duration};

use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::{Value, json};

const ARCHIVE_ORG: &str = "https://archive.org";
const WAYBACK_CDX: &str = "https://web.archive.org/cdx/search/cdx";
const GOOGLE_DOH: &str = "https://dns.google/resolve";

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("static public web client configuration")
});

static TOOLS: LazyLock<Vec<Tool>> = LazyLock::new(|| {
    [
        json!({
            "name": "aphrody_archive_item",
            "description": "Retrieve an Internet Archive item's public metadata and file manifest without downloading media.",
            "inputSchema": {
                "type": "object", "properties": { "identifier": { "type": "string", "minLength": 1 } },
                "required": ["identifier"], "additionalProperties": false
            }
        }),
        json!({
            "name": "aphrody_archive_search",
            "description": "Search Internet Archive's public catalog via AdvancedSearch, for example: collection:prelinger AND mediatype:movies.",
            "inputSchema": {
                "type": "object", "properties": {
                    "query": { "type": "string", "minLength": 1 },
                    "rows": { "type": "integer", "minimum": 1, "maximum": 1000, "default": 50 },
                    "page": { "type": "integer", "minimum": 1, "default": 1 }
                },
                "required": ["query"], "additionalProperties": false
            }
        }),
        json!({
            "name": "aphrody_archive_wayback",
            "description": "List public Wayback Machine captures through the CDX API; no archived content is downloaded.",
            "inputSchema": {
                "type": "object", "properties": {
                    "url": { "type": "string", "format": "uri" },
                    "from": { "type": "string" },
                    "to": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 1000, "default": 100 }
                },
                "required": ["url"], "additionalProperties": false
            }
        }),
        json!({
            "name": "aphrody_google_dns",
            "description": "Query Google Public DNS-over-HTTPS (DoH) for any domain and record type (A, AAAA, MX, TXT, etc.).",
            "inputSchema": {
                "type": "object", "properties": {
                    "name": { "type": "string", "description": "Domain name to query." },
                    "type": { "type": "string", "default": "A", "description": "DNS record type." }
                },
                "required": ["name"], "additionalProperties": false
            }
        }),
    ]
    .into_iter()
    .map(|definition| serde_json::from_value(definition).expect("static public web tool schema"))
    .collect()
});

pub(crate) fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    TOOLS.iter().filter(|tool| !taken(tool.name.as_ref())).cloned().collect()
}

pub(crate) fn get(name: &str) -> Option<Tool> {
    TOOLS.iter().find(|tool| tool.name == name).cloned()
}

pub(crate) fn owns(name: &str) -> bool {
    get(name).is_some()
}

fn required_text<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{key} must be a non-empty string"))
}

fn optional_text<'a>(args: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    args.get(key)
        .map(|value| value.as_str().ok_or_else(|| format!("{key} must be a string")))
        .transpose()
}

fn optional_count(
    args: &Value,
    key: &str,
    default: u64,
    maximum: Option<u64>,
) -> Result<u64, String> {
    let Some(value) = args.get(key) else { return Ok(default) };
    let value = value
        .as_u64()
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("{key} must be a positive integer"))?;
    if let Some(maximum) = maximum
        && value > maximum
    {
        return Err(format!("{key} must be at most {maximum}"));
    }
    Ok(value)
}

fn item_url(identifier: &str) -> reqwest::Url {
    let mut url = reqwest::Url::parse(ARCHIVE_ORG).expect("static URL");
    url.path_segments_mut().expect("HTTPS URL").extend(["metadata", identifier]);
    url
}

fn search_url(query: &str, rows: u64, page: u64) -> reqwest::Url {
    const FIELDS: &[&str] = &[
        "identifier",
        "title",
        "creator",
        "date",
        "mediatype",
        "collection",
        "downloads",
        "description",
    ];
    let mut url =
        reqwest::Url::parse(&format!("{ARCHIVE_ORG}/advancedsearch.php")).expect("static URL");
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("q", query).append_pair("output", "json");
        pairs.append_pair("rows", &rows.to_string()).append_pair("page", &page.to_string());
        for field in FIELDS {
            pairs.append_pair("fl[]", field);
        }
    }
    url
}

fn wayback_url(page_url: &str, from: Option<&str>, to: Option<&str>, limit: u64) -> reqwest::Url {
    let mut url = reqwest::Url::parse(WAYBACK_CDX).expect("static URL");
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("url", page_url).append_pair("output", "json");
        if let Some(from) = from {
            pairs.append_pair("from", from);
        }
        if let Some(to) = to {
            pairs.append_pair("to", to);
        }
        pairs.append_pair("limit", &limit.to_string());
    }
    url
}

fn google_dns_url(name: &str, record_type: &str) -> reqwest::Url {
    let mut url = reqwest::Url::parse(GOOGLE_DOH).expect("static URL");
    url.query_pairs_mut().append_pair("name", name).append_pair("type", record_type);
    url
}

async fn get_json(url: reqwest::Url, service: &str) -> Result<Value, String> {
    let response = CLIENT.get(url).send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "{service} request failed: HTTP {status} — {}",
            body.chars().take(500).collect::<String>()
        ));
    }
    serde_json::from_str(&body).map_err(|error| format!("{service} JSON: {error}"))
}

fn captures(data: Value) -> Result<Value, String> {
    let rows = data.as_array().ok_or("Wayback CDX response must be an array")?;
    let Some((columns, entries)) = rows.split_first() else { return Ok(json!([])) };
    let columns = columns.as_array().ok_or("Wayback CDX columns must be an array")?;
    let columns: Vec<&str> = columns
        .iter()
        .map(|column| column.as_str().ok_or("Wayback CDX column must be a string"))
        .collect::<Result<_, _>>()?;
    let mut result = Vec::with_capacity(entries.len());
    for entry in entries {
        let fields = entry.as_array().ok_or("Wayback CDX row must be an array")?;
        let capture = columns
            .iter()
            .enumerate()
            .map(|(index, column)| {
                (column.to_string(), fields.get(index).cloned().unwrap_or(json!("")))
            })
            .collect::<serde_json::Map<_, _>>();
        result.push(Value::Object(capture));
    }
    Ok(Value::Array(result))
}

async fn run(name: &str, args: &Value) -> Result<(Value, Value), String> {
    match name {
        "aphrody_archive_item" => {
            let item =
                get_json(item_url(required_text(args, "identifier")?), "Internet Archive").await?;
            Ok((item.clone(), item))
        },
        "aphrody_archive_search" => {
            let query = required_text(args, "query")?;
            let rows = optional_count(args, "rows", 50, Some(1000))?;
            let page = optional_count(args, "page", 1, None)?;
            let result = get_json(search_url(query, rows, page), "Internet Archive").await?;
            Ok((result.clone(), result))
        },
        "aphrody_archive_wayback" => {
            let page_url = required_text(args, "url")?;
            reqwest::Url::parse(page_url).map_err(|error| format!("url: {error}"))?;
            let limit = optional_count(args, "limit", 100, Some(1000))?;
            let from = optional_text(args, "from")?;
            let to = optional_text(args, "to")?;
            let result =
                captures(get_json(wayback_url(page_url, from, to, limit), "Wayback CDX").await?)?;
            Ok((result.clone(), json!({ "captures": result })))
        },
        "aphrody_google_dns" => {
            let domain = args
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| "name must be a string".to_owned())?;
            let record_type = optional_text(args, "type")?.unwrap_or("A");
            let result = get_json(google_dns_url(domain, record_type), "Google DNS").await?;
            Ok((result.clone(), result))
        },
        _ => Err(format!("unknown public web tool: {name}")),
    }
}

pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let name = request.name.as_ref();
    let args =
        request.arguments.as_ref().map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    match run(name, &args).await {
        Ok((text, structured)) => {
            let mut result = CallToolResult::success(vec![ContentBlock::text(
                serde_json::to_string_pretty(&text).unwrap_or_else(|_| "null".to_owned()),
            )]);
            result.structured_content = Some(structured);
            result
        },
        Err(error) => CallToolResult::error(vec![ContentBlock::text(format!("{name}: {error}"))]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_source_tool_names_and_schemas() {
        for name in [
            "aphrody_archive_item",
            "aphrody_archive_search",
            "aphrody_archive_wayback",
            "aphrody_google_dns",
        ] {
            assert!(owns(name), "{name}");
        }
        assert_eq!(TOOLS.len(), 4);
        let search = get("aphrody_archive_search").unwrap();
        assert_eq!(
            serde_json::to_value(search).unwrap()["inputSchema"]["properties"]["rows"]["default"],
            50
        );
    }

    #[test]
    fn endpoints_preserve_source_query_shape_and_encode_values() {
        assert_eq!(item_url("with/slash").path(), "/metadata/with%2Fslash");
        let search = search_url("collection:test & more", 50, 1);
        let pairs: Vec<_> = search.query_pairs().collect();
        assert!(pairs.iter().any(|(key, value)| key == "q" && value == "collection:test & more"));
        assert_eq!(pairs.iter().filter(|(key, _)| key == "fl[]").count(), 8);
        let wayback = wayback_url("https://example.com/a?b=1", Some("2020"), None, 100);
        assert!(
            wayback
                .query_pairs()
                .any(|(key, value)| key == "url" && value == "https://example.com/a?b=1")
        );
        let dns = google_dns_url("example.com", "MX");
        assert_eq!(dns.as_str(), "https://dns.google/resolve?name=example.com&type=MX");
        assert_eq!(
            serde_json::to_value(get("aphrody_google_dns").unwrap()).unwrap()["inputSchema"]["properties"]
                ["type"]["default"],
            "A"
        );
    }

    #[test]
    fn cdx_table_becomes_named_captures() {
        let value =
            captures(json!([["timestamp", "original"], ["20200101", "https://example.com"]]))
                .unwrap();
        assert_eq!(value, json!([{ "timestamp": "20200101", "original": "https://example.com" }]));
        assert_eq!(captures(json!([])).unwrap(), json!([]));
    }

    #[tokio::test]
    async fn invalid_input_fails_before_network() {
        assert!(
            run("aphrody_archive_search", &json!({ "query": "x", "rows": 1001 })).await.is_err()
        );
        assert!(run("aphrody_archive_wayback", &json!({ "url": "not a url" })).await.is_err());
        assert!(run("aphrody_google_dns", &json!({})).await.is_err());
        assert!(
            run("aphrody_google_dns", &json!({ "name": "example.com", "type": 5 })).await.is_err()
        );
    }
}
