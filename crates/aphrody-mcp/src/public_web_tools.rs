// SPDX-License-Identifier: Apache-2.0
//! Public Archive and Google HTTP tools served directly by the Rust MCP host.

use std::{sync::LazyLock, time::Duration};

use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::{Value, json};

const ARCHIVE_ORG: &str = "https://archive.org";
const WAYBACK_CDX: &str = "https://web.archive.org/cdx/search/cdx";
const GOOGLE_DOH: &str = "https://dns.google/resolve";
const GOOGLE_SUGGEST: &str = "https://suggestqueries.google.com/complete/search";

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("static public web client configuration")
});

static TOOLS: LazyLock<Vec<Tool>> = LazyLock::new(|| {
    [
        json!({
            "name": "aphrody_detect_frameworks",
            "description": "Detect web technologies, CDN and challenge evidence from a bounded HTTP response and DNS lookup.",
            "inputSchema": {
                "type": "object", "properties": {
                    "url": { "type": "string", "format": "uri", "description": "HTTP or HTTPS URL to inspect." }
                },
                "required": ["url"], "additionalProperties": false
            }
        }),
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
        json!({
            "name": "aphrody_google_suggest",
            "description": "Get real-time query suggestions from Google Autocomplete.",
            "inputSchema": {
                "type": "object", "properties": {
                    "query": { "type": "string", "description": "Query prefix to suggest." },
                    "client": { "type": "string", "default": "chrome", "description": "Client profile (chrome, firefox)." }
                },
                "required": ["query"], "additionalProperties": false
            }
        }),
        json!({
            "name": "aphrody_google_supported_languages",
            "description": "List all 195 official supported Google Cloud Translation languages, optionally localized in target language.",
            "inputSchema": {
                "type": "object", "properties": {
                    "target": { "type": "string", "description": "Optional target language code to localize language names (e.g. 'fr', 'en', 'ja')." }
                },
                "additionalProperties": false
            }
        }),
        json!({
            "name": "aphrody_google_calendar_public",
            "description": "Fetch and parse events from any public Google iCalendar feed by ID.",
            "inputSchema": {
                "type": "object", "properties": {
                    "calendarId": { "type": "string", "description": "The public Google Calendar ID or email." }
                },
                "required": ["calendarId"], "additionalProperties": false
            }
        }),
        json!({
            "name": "aphrody_google_sheet_export",
            "description": "Export a publicly shared Google Spreadsheet to CSV.",
            "inputSchema": {
                "type": "object", "properties": {
                    "spreadsheetId": { "type": "string", "description": "Google Spreadsheet document ID." },
                    "gid": { "type": "string", "description": "Sheet tab GID." }
                },
                "required": ["spreadsheetId"], "additionalProperties": false
            }
        }),
        json!({
            "name": "aphrody_google_doc_export",
            "description": "Export a publicly shared Google Document to plain text.",
            "inputSchema": {
                "type": "object", "properties": {
                    "documentId": { "type": "string", "description": "Google Document ID." }
                },
                "required": ["documentId"], "additionalProperties": false
            }
        }),
    ]
    .into_iter()
    .map(|definition| serde_json::from_value(definition).expect("static public web tool schema"))
    .collect()
});

pub(crate) fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    TOOLS
        .iter()
        .filter(|tool| !taken(tool.name.as_ref()))
        .cloned()
        .collect()
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

fn text_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{key} must be a string"))
}

fn optional_text<'a>(args: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    args.get(key)
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| format!("{key} must be a string"))
        })
        .transpose()
}

fn optional_count(
    args: &Value,
    key: &str,
    default: u64,
    maximum: Option<u64>,
) -> Result<u64, String> {
    let Some(value) = args.get(key) else {
        return Ok(default);
    };
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
    url.path_segments_mut()
        .expect("HTTPS URL")
        .extend(["metadata", identifier]);
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
        pairs
            .append_pair("rows", &rows.to_string())
            .append_pair("page", &page.to_string());
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
        pairs
            .append_pair("url", page_url)
            .append_pair("output", "json");
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
    url.query_pairs_mut()
        .append_pair("name", name)
        .append_pair("type", record_type);
    url
}

fn google_suggest_url(query: &str, client: &str) -> reqwest::Url {
    let mut url = reqwest::Url::parse(GOOGLE_SUGGEST).expect("static URL");
    url.query_pairs_mut()
        .append_pair("client", client)
        .append_pair("q", query);
    url
}

fn google_calendar_url(calendar_id: &str) -> reqwest::Url {
    let mut url = reqwest::Url::parse("https://calendar.google.com").expect("static URL");
    url.path_segments_mut().expect("HTTPS URL").extend([
        "calendar",
        "ical",
        calendar_id,
        "public",
        "basic.ics",
    ]);
    url
}

fn google_sheet_url(spreadsheet_id: &str, gid: Option<&str>) -> reqwest::Url {
    let mut url = reqwest::Url::parse("https://docs.google.com").expect("static URL");
    url.path_segments_mut().expect("HTTPS URL").extend([
        "spreadsheets",
        "d",
        spreadsheet_id,
        "export",
    ]);
    let mut query = url.query_pairs_mut();
    query.append_pair("format", "csv");
    if let Some(gid) = gid.filter(|gid| !gid.is_empty()) {
        query.append_pair("gid", gid);
    }
    drop(query);
    url
}

fn google_doc_url(document_id: &str) -> reqwest::Url {
    let mut url = reqwest::Url::parse("https://docs.google.com").expect("static URL");
    url.path_segments_mut()
        .expect("HTTPS URL")
        .extend(["document", "d", document_id, "export"]);
    url.query_pairs_mut().append_pair("format", "txt");
    url
}

async fn get_text(url: reqwest::Url, service: &str) -> Result<String, String> {
    let response = CLIENT
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "{service} request failed: HTTP {status} — {}",
            body.chars().take(500).collect::<String>()
        ));
    }
    Ok(body)
}

async fn get_json(url: reqwest::Url, service: &str) -> Result<Value, String> {
    let body = get_text(url, service).await?;
    serde_json::from_str(&body).map_err(|error| format!("{service} JSON: {error}"))
}

fn suggestions(data: &Value) -> Value {
    let items = data
        .as_array()
        .and_then(|array| array.get(1))
        .and_then(Value::as_array);
    Value::Array(items.map_or_else(Vec::new, |items| {
        items
            .iter()
            .map(|item| {
                Value::String(match item {
                    Value::String(value) => value.clone(),
                    Value::Object(_) => "[object Object]".to_owned(),
                    Value::Array(array) => array
                        .iter()
                        .map(|item| {
                            item.as_str()
                                .map_or_else(|| item.to_string(), str::to_owned)
                        })
                        .collect::<Vec<_>>()
                        .join(","),
                    other => other.to_string(),
                })
            })
            .collect()
    }))
}

fn calendar_events(ics: &str) -> Value {
    let mut lines: Vec<String> = Vec::new();
    for raw in ics.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some(folded) = line.strip_prefix(' ').or_else(|| line.strip_prefix('\t')) {
            if let Some(previous) = lines.last_mut() {
                previous.push_str(folded);
            }
        } else {
            lines.push(line.to_owned());
        }
    }
    let mut events = Vec::new();
    let mut current: Option<serde_json::Map<String, Value>> = None;
    for line in lines {
        if line.starts_with("BEGIN:VEVENT") {
            current = Some(serde_json::Map::new());
        } else if line.starts_with("END:VEVENT") {
            if let Some(event) = current.take() {
                events.push(Value::Object(event));
            }
        } else if let Some(event) = current.as_mut()
            && let Some((key, value)) = line.split_once(':')
        {
            let key = key
                .split(';')
                .next()
                .unwrap_or_default()
                .to_ascii_lowercase();
            let value = value
                .replace("\\,", ",")
                .replace("\\;", ";")
                .replace("\\n", "\n")
                .replace("\\N", "\n");
            event.insert(key, Value::String(value));
        }
    }
    Value::Array(events)
}

fn captures(data: Value) -> Result<Value, String> {
    let rows = data
        .as_array()
        .ok_or("Wayback CDX response must be an array")?;
    let Some((columns, entries)) = rows.split_first() else {
        return Ok(json!([]));
    };
    let columns = columns
        .as_array()
        .ok_or("Wayback CDX columns must be an array")?;
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
                (
                    column.to_string(),
                    fields.get(index).cloned().unwrap_or(json!("")),
                )
            })
            .collect::<serde_json::Map<_, _>>();
        result.push(Value::Object(capture));
    }
    Ok(Value::Array(result))
}

enum Output {
    Json {
        value: Value,
        structured: Option<Value>,
    },
    Text(String),
}

impl Output {
    fn json(value: Value) -> Self {
        Self::Json {
            structured: value.is_object().then(|| value.clone()),
            value,
        }
    }
}

async fn run(name: &str, args: &Value) -> Result<Output, String> {
    match name {
        "aphrody_detect_frameworks" => {
            let url = required_text(args, "url")?;
            let report = aphrody_web_detect::detect_url(url)
                .await
                .map_err(|error| error.to_string())?;
            Ok(Output::json(
                serde_json::to_value(report).map_err(|error| error.to_string())?,
            ))
        }
        "aphrody_archive_item" => {
            let item = get_json(
                item_url(required_text(args, "identifier")?),
                "Internet Archive",
            )
            .await?;
            Ok(Output::json(item))
        }
        "aphrody_archive_search" => {
            let query = required_text(args, "query")?;
            let rows = optional_count(args, "rows", 50, Some(1000))?;
            let page = optional_count(args, "page", 1, None)?;
            let result = get_json(search_url(query, rows, page), "Internet Archive").await?;
            Ok(Output::json(result))
        }
        "aphrody_archive_wayback" => {
            let page_url = required_text(args, "url")?;
            reqwest::Url::parse(page_url).map_err(|error| format!("url: {error}"))?;
            let limit = optional_count(args, "limit", 100, Some(1000))?;
            let from = optional_text(args, "from")?;
            let to = optional_text(args, "to")?;
            let result =
                captures(get_json(wayback_url(page_url, from, to, limit), "Wayback CDX").await?)?;
            Ok(Output::Json {
                value: result.clone(),
                structured: Some(json!({ "captures": result })),
            })
        }
        "aphrody_google_dns" => {
            let domain = args
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| "name must be a string".to_owned())?;
            let record_type = optional_text(args, "type")?.unwrap_or("A");
            let result = get_json(google_dns_url(domain, record_type), "Google DNS").await?;
            Ok(Output::json(result))
        }
        "aphrody_google_suggest" => {
            let query = text_arg(args, "query")?;
            let client = optional_text(args, "client")?.unwrap_or("chrome");
            let data = get_json(google_suggest_url(query, client), "Google Suggest").await?;
            Ok(Output::json(suggestions(&data)))
        }
        "aphrody_google_supported_languages" => {
            let target = optional_text(args, "target")?;
            let mut response =
                serde_json::to_value(aphrody_google::languages::supported_languages(target))
                    .map_err(|error| format!("Google language registry: {error}"))?;
            let total = response["data"]["languages"].as_array().map_or(0, Vec::len);
            response["total"] = json!(total);
            Ok(Output::json(response))
        }
        "aphrody_google_calendar_public" => {
            let id = text_arg(args, "calendarId")?;
            let body = get_text(google_calendar_url(id), "Google Calendar").await?;
            Ok(Output::json(calendar_events(&body)))
        }
        "aphrody_google_sheet_export" => {
            let id = text_arg(args, "spreadsheetId")?;
            let gid = optional_text(args, "gid")?;
            Ok(Output::Text(
                get_text(google_sheet_url(id, gid), "Google Sheets").await?,
            ))
        }
        "aphrody_google_doc_export" => {
            let id = text_arg(args, "documentId")?;
            Ok(Output::Text(
                get_text(google_doc_url(id), "Google Docs").await?,
            ))
        }
        _ => Err(format!("unknown public web tool: {name}")),
    }
}

pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let name = request.name.as_ref();
    let args = request
        .arguments
        .as_ref()
        .map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    match run(name, &args).await {
        Ok(Output::Json { value, structured }) => {
            let mut result = CallToolResult::success(vec![ContentBlock::text(
                serde_json::to_string_pretty(&value).unwrap_or_else(|_| "null".to_owned()),
            )]);
            result.structured_content = structured;
            result
        }
        Ok(Output::Text(text)) => CallToolResult::success(vec![ContentBlock::text(text)]),
        Err(error) => CallToolResult::error(vec![ContentBlock::text(format!("{name}: {error}"))]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_source_tool_names_and_schemas() {
        for name in [
            "aphrody_detect_frameworks",
            "aphrody_archive_item",
            "aphrody_archive_search",
            "aphrody_archive_wayback",
            "aphrody_google_dns",
            "aphrody_google_suggest",
            "aphrody_google_supported_languages",
            "aphrody_google_calendar_public",
            "aphrody_google_sheet_export",
            "aphrody_google_doc_export",
        ] {
            assert!(owns(name), "{name}");
        }
        assert_eq!(TOOLS.len(), 10);
        let search = get("aphrody_archive_search").unwrap();
        assert_eq!(
            serde_json::to_value(search).unwrap()["inputSchema"]["properties"]["rows"]["default"],
            50
        );
    }

    #[tokio::test]
    async fn detection_rejects_non_web_url_before_network() {
        let result = run(
            "aphrody_detect_frameworks",
            &json!({ "url": "file:///tmp/a" }),
        )
        .await;
        assert!(result.is_err());
    }

    #[test]
    fn endpoints_preserve_source_query_shape_and_encode_values() {
        assert_eq!(item_url("with/slash").path(), "/metadata/with%2Fslash");
        let search = search_url("collection:test & more", 50, 1);
        let pairs: Vec<_> = search.query_pairs().collect();
        assert!(
            pairs
                .iter()
                .any(|(key, value)| key == "q" && value == "collection:test & more")
        );
        assert_eq!(pairs.iter().filter(|(key, _)| key == "fl[]").count(), 8);
        let wayback = wayback_url("https://example.com/a?b=1", Some("2020"), None, 100);
        assert!(
            wayback
                .query_pairs()
                .any(|(key, value)| key == "url" && value == "https://example.com/a?b=1")
        );
        let dns = google_dns_url("example.com", "MX");
        assert_eq!(
            dns.as_str(),
            "https://dns.google/resolve?name=example.com&type=MX"
        );
        assert_eq!(
            serde_json::to_value(get("aphrody_google_dns").unwrap()).unwrap()["inputSchema"]["properties"]
                ["type"]["default"],
            "A"
        );
        let suggest = google_suggest_url("rust & bun", "firefox");
        assert!(
            suggest
                .query_pairs()
                .any(|(key, value)| key == "q" && value == "rust & bun")
        );
        assert_eq!(
            google_calendar_url("team@example.com").as_str(),
            "https://calendar.google.com/calendar/ical/team@example.com/public/basic.ics"
        );
        assert_eq!(
            google_sheet_url("sheet-id", Some("123")).as_str(),
            "https://docs.google.com/spreadsheets/d/sheet-id/export?format=csv&gid=123"
        );
        assert_eq!(
            google_doc_url("doc-id").as_str(),
            "https://docs.google.com/document/d/doc-id/export?format=txt"
        );
    }

    #[test]
    fn suggestion_payload_extracts_array_and_keeps_string_values() {
        assert_eq!(
            suggestions(&json!(["r", ["rust", "rust bun", 5]])),
            json!(["rust", "rust bun", "5"])
        );
        assert_eq!(suggestions(&json!({ "unexpected": true })), json!([]));
    }

    #[test]
    fn public_calendar_unfolds_lines_and_unescapes_event_fields() {
        let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY;LANGUAGE=en:Team\\, plan\r\n ning\\; review\r\nDESCRIPTION:First\\nSecond\\NThird\r\nLOCATION:Paris\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Next\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        assert_eq!(
            calendar_events(ics),
            json!([
                {"summary": "Team, planning; review", "description": "First\nSecond\nThird", "location": "Paris"},
                {"summary": "Next"}
            ])
        );
        assert_eq!(calendar_events("BEGIN:VCALENDAR\nEND:VCALENDAR"), json!([]));
    }

    #[tokio::test]
    async fn supported_languages_uses_shared_registry_without_network() {
        let Output::Json { value, structured } = run(
            "aphrody_google_supported_languages",
            &json!({ "target": "fr-FR" }),
        )
        .await
        .unwrap() else {
            panic!("expected JSON output");
        };
        assert_eq!(value["total"], 195);
        assert_eq!(value["data"]["languages"][0]["name"], "Abkhaze");
        assert_eq!(structured, Some(value));
    }

    #[test]
    fn cdx_table_becomes_named_captures() {
        let value = captures(json!([
            ["timestamp", "original"],
            ["20200101", "https://example.com"]
        ]))
        .unwrap();
        assert_eq!(
            value,
            json!([{ "timestamp": "20200101", "original": "https://example.com" }])
        );
        assert_eq!(captures(json!([])).unwrap(), json!([]));
    }

    #[tokio::test]
    async fn invalid_input_fails_before_network() {
        assert!(
            run(
                "aphrody_archive_search",
                &json!({ "query": "x", "rows": 1001 })
            )
            .await
            .is_err()
        );
        assert!(
            run("aphrody_archive_wayback", &json!({ "url": "not a url" }))
                .await
                .is_err()
        );
        assert!(run("aphrody_google_dns", &json!({})).await.is_err());
        assert!(
            run(
                "aphrody_google_dns",
                &json!({ "name": "example.com", "type": 5 })
            )
            .await
            .is_err()
        );
        assert!(run("aphrody_google_suggest", &json!({})).await.is_err());
        assert!(
            run(
                "aphrody_google_supported_languages",
                &json!({ "target": 3 })
            )
            .await
            .is_err()
        );
        assert!(
            run("aphrody_google_calendar_public", &json!({}))
                .await
                .is_err()
        );
        assert!(
            run("aphrody_google_sheet_export", &json!({}))
                .await
                .is_err()
        );
        assert!(run("aphrody_google_doc_export", &json!({})).await.is_err());
    }
}
