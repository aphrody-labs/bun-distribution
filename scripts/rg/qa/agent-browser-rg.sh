#!/usr/bin/env bash
set -Eeuo pipefail

# Versioned, read-only browser QA workflow for rosegriffon.fr.
# The script deliberately does not replace the disabled external IE crawler.
WORKFLOW_VERSION="1.0.0"
SCHEMA_VERSION=1
BASE_URL="${RG_BROWSER_BASE_URL:-https://rosegriffon.fr}"
API_BASE_URL="${RG_BROWSER_API_BASE_URL:-https://api.rosegriffon.fr}"
MODE="${RG_BROWSER_MODE:-once}"
INTERVAL="${RG_BROWSER_INTERVAL_SECONDS:-900}"
MAX_PAGES="${RG_BROWSER_MAX_PAGES:-40}"
OUT_DIR="${RG_BROWSER_OUT_DIR:-${PWD}/.agent-browser/rg-qa}"
SESSION="${AGENT_BROWSER_SESSION:-$(agent-browser session id --scope worktree --prefix rg-qa)}"
FAIL_ON_ERRORS="${RG_BROWSER_FAIL_ON_ERRORS:-0}"
FAIL_ON_A11Y="${RG_BROWSER_FAIL_ON_A11Y:-0}"

command -v agent-browser >/dev/null || { echo "agent-browser est requis" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq est requis" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl est requis" >&2; exit 2; }

mkdir -p "$OUT_DIR"
LOCK_DIR="$OUT_DIR/.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
	 echo "Un workflow agent-browser est déjà actif: $OUT_DIR" >&2
	 exit 75
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="$OUT_DIR/$run_id"
mkdir -p "$RUN_DIR"
ln -sfn "$RUN_DIR" "$OUT_DIR/latest"
REPORT_JSON="$RUN_DIR/report.json"
REPORT_MD="$RUN_DIR/report.md"
PAGES_JSONL="$RUN_DIR/pages.jsonl"
API_JSONL="$RUN_DIR/api.jsonl"
touch "$PAGES_JSONL" "$API_JSONL"

browser() { agent-browser --session "$SESSION" --restore --restore-save auto "$@"; }
browser_json() { browser "$@" --json; }

json_data() {
	jq -c 'if (.data.result? | type) == "string" then (.data.result | fromjson?) elif .data.result? then .data.result elif (.data? | type) == "string" then (.data | fromjson?) else (.data // .result // .) end' 2>/dev/null || echo '{}'
}

safe_name() { echo "$1" | sed 's#^/##; s#[^A-Za-z0-9._-]#_#g; s#^$#home#'; }

normalise_url() {
	local url="$1"
	url="${url%%#*}"
	case "$url" in
		https://rosegriffon.fr/*|https://rosegriffon.fr) echo "$url" ;;
		https://www.rosegriffon.fr/*|https://www.rosegriffon.fr) echo "https://rosegriffon.fr${url#https://www.rosegriffon.fr}" ;;
		/*) echo "${BASE_URL%/}$url" ;;
		*) return 1 ;;
	esac
}

curl_probe() {
	local url="$1" body="$RUN_DIR/.curl-body"
	local meta code effective time
	meta="$(curl -ksS -L --max-time 25 -o "$body" -w '%{http_code}\t%{url_effective}\t%{time_total}' "$url" || true)"
	IFS=$'\t' read -r code effective time <<< "$meta"
	code="${code:-000}"
	jq -cn --arg url "$url" --arg effective "${effective:-}" --arg code "$code" --arg time "${time:-}" \
		'{url:$url,effectiveUrl:$effective,status:($code|tonumber),timeSeconds:($time|tonumber)}'
}

collect_sitemaps() {
	local robots="$RUN_DIR/robots.txt"
	curl -ksS --max-time 20 "${BASE_URL%/}/robots.txt" -o "$robots" || true
	grep -Eio 'Sitemap:[[:space:]]*[^[:space:]]+' "$robots" | sed -E 's/^[^:]+:[[:space:]]*//' || true
}

collect_urls() {
	local sitemap loc
	collect_sitemaps > "$RUN_DIR/sitemaps.txt"
	while IFS= read -r sitemap; do
		[ -n "$sitemap" ] || continue
		curl -ksS --max-time 30 "$sitemap" 2>/dev/null \
			| sed -n 's#.*<loc>\([^<]*\)</loc>.*#\1#p' || true
	done < "$RUN_DIR/sitemaps.txt"
	# Always include the root even if robots/sitemap is temporarily unavailable.
	printf '%s\n' "${BASE_URL%/}/"
}

collect_home_links() {
	browser open "${BASE_URL%/}/" >/dev/null
	browser wait --load domcontentloaded >/dev/null || true
	browser_json eval 'JSON.stringify([...document.querySelectorAll("a[href]")].map(a => a.href))' 2>/dev/null \
		| json_data | jq -r '.[]? // empty' 2>/dev/null || true
}

probe_page() {
	local url="$1" path name status_json code open_ok title url_after data a11y vitals errors console layout
	path="${url#${BASE_URL%/}}"; [ -n "$path" ] || path="/"
	name="$(safe_name "$path")"
	status_json="$(curl_probe "$url")"
	code="$(jq -r '.status' <<<"$status_json")"
	open_ok=1
	if [[ "$code" =~ ^[23] ]]; then
		browser open "$url" >/dev/null 2>"$RUN_DIR/${name}.open.stderr" || open_ok=0
		browser wait --load domcontentloaded >/dev/null 2>&1 || true
	else
		open_ok=0
	fi

	title=""; url_after="$url"; data='{}'; a11y='{}'; vitals='{}'; errors='{}'; console='{}'; layout='{}'
	if [ "$open_ok" -eq 1 ]; then
		data="$(browser_json eval 'JSON.stringify({title:document.title,canonical:document.querySelector("link[rel=canonical]")?.href||null,lang:document.documentElement.lang||null,headings:[...document.querySelectorAll("h1,h2")].map(x=>x.innerText.trim()).filter(Boolean),links:[...document.querySelectorAll("a[href]")].map(a=>a.href),scripts:document.scripts.length,stylesheets:document.styleSheets.length,landmarks:[...document.querySelectorAll("main,nav,header,footer,aside")].map(x=>x.tagName.toLowerCase()),layout:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,clientHeight:document.documentElement.clientHeight}})' 2>/dev/null | json_data || echo '{}')"
		url_after="$(browser get url 2>/dev/null || echo "$url")"
		title="$(jq -r '.title // ""' <<<"$data")"
		a11y="$(browser_json a11y 2>/dev/null | json_data || echo '{}')"
		vitals="$(browser_json vitals 2>/dev/null | json_data || echo '{}')"
		errors="$(browser_json errors 2>/dev/null | json_data || echo '{}')"
		console="$(browser_json console 2>/dev/null | json_data || echo '{}')"
		browser set viewport 390 844 >/dev/null 2>&1 || true
		layout="$(browser_json eval 'JSON.stringify({mobileScrollWidth:document.documentElement.scrollWidth,mobileClientWidth:document.documentElement.clientWidth,horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth})' 2>/dev/null | json_data || echo '{}')"
		browser set viewport 1440 900 >/dev/null 2>&1 || true
		browser screenshot "$RUN_DIR/${name}.png" >/dev/null 2>&1 || true
	fi
	jq -cn --argjson status "$status_json" --arg url "$url" --arg effective "$url_after" --arg title "$title" \
		--argjson data "$data" --argjson a11y "$a11y" --argjson vitals "$vitals" --argjson errors "$errors" --argjson console "$console" --argjson layout "$layout" \
		'{url:$url,effectiveUrl:$effective,status:$status.status,openOk:('$open_ok'==1),title:$title,metadata:$data,a11y:$a11y,vitals:$vitals,errors:$errors,console:$console,layout:$layout}' >> "$PAGES_JSONL"
}

probe_api() {
	local origin="$1" path="$2" required="$3" result
	result="$(curl_probe "${origin%/}$path")"
	jq -cn --arg origin "$origin" --arg path "$path" --argjson required "$required" --argjson result "$result" \
		'{origin:$origin,path:$path,required:$required,status:$result.status,effectiveUrl:$result.effectiveUrl,timeSeconds:$result.timeSeconds}' >> "$API_JSONL"
}

run_once() {
	: > "$PAGES_JSONL"; : > "$API_JSONL"
	collect_urls | while IFS= read -r url; do normalise_url "$url" || true; done | awk '!seen[$0]++' | head -n "$MAX_PAGES" > "$RUN_DIR/urls.txt"
	collect_home_links | while IFS= read -r url; do normalise_url "$url" || true; done | awk '!seen[$0]++' | head -n "$MAX_PAGES" >> "$RUN_DIR/urls.txt"
	sort -u "$RUN_DIR/urls.txt" | head -n "$MAX_PAGES" > "$RUN_DIR/urls.unique"
	while IFS= read -r url; do [ -n "$url" ] && probe_page "$url"; done < "$RUN_DIR/urls.unique"
	probe_api "$BASE_URL" /api/health true
	probe_api "$BASE_URL" /api/auth/get-session true
	probe_api "$API_BASE_URL" /v1/auth/get-session true
	probe_api "$API_BASE_URL" /v1/auth/agent-configuration true
	probe_api "$API_BASE_URL" /.well-known/agent-configuration false

	local pages_total pages_bad overflow errors_count a11y_count api_bad status
	pages_total="$(wc -l < "$PAGES_JSONL" | tr -d ' ')"
	pages_bad="$(jq -s '[.[] | select(.status < 200 or .status >= 400 or .openOk == false)] | length' "$PAGES_JSONL")"
	overflow="$(jq -s '[.[] | select(.layout.horizontalOverflow == true)] | length' "$PAGES_JSONL")"
	errors_count="$(jq -s '[.[] | select((.errors|length)>0 or (.console|length)>0)] | length' "$PAGES_JSONL")"
	a11y_count="$(jq -s '[.[] | select((.a11y.violations // [])|length > 0)] | length' "$PAGES_JSONL")"
	api_bad="$(jq -s '[.[] | select(.required == true and (.status < 200 or .status >= 400))] | length' "$API_JSONL")"
	status="ok"
	[ "$pages_bad" -eq 0 ] && [ "$overflow" -eq 0 ] || status="failed"
	[ "$FAIL_ON_ERRORS" = 1 ] && [ "$errors_count" -eq 0 ] || [ "$FAIL_ON_ERRORS" != 1 ] || status="failed"
	[ "$FAIL_ON_A11Y" = 1 ] && [ "$a11y_count" -eq 0 ] || [ "$FAIL_ON_A11Y" != 1 ] || status="failed"
	[ "$api_bad" -eq 0 ] || status="failed"
	jq -n --arg version "$WORKFLOW_VERSION" --argjson schema "$SCHEMA_VERSION" --arg runId "$run_id" --arg baseUrl "$BASE_URL" --arg status "$status" \
		--argjson pagesTotal "$pages_total" --argjson pagesBad "$pages_bad" --argjson overflow "$overflow" --argjson errors "$errors_count" --argjson a11y "$a11y_count" --argjson apiBad "$api_bad" \
		'{workflowVersion:$version,schemaVersion:$schema,runId:$runId,baseUrl:$baseUrl,status:$status,summary:{pagesTotal:$pagesTotal,pagesBad:$pagesBad,horizontalOverflow:$overflow,consoleOrRuntimeErrors:$errors,a11yPages:$a11y,apiBad:$apiBad}}' > "$REPORT_JSON"
	jq -r '"# RG browser QA \(.runId)\n\n- Status: **\(.status)**\n- Workflow: `\(.workflowVersion)` / schema `\(.schemaVersion)`\n- Base URL: \(.baseUrl)\n- Pages: \(.summary.pagesTotal), HTTP/open failures: \(.summary.pagesBad)\n- Horizontal overflows: \(.summary.horizontalOverflow)\n- API failures: \(.summary.apiBad)\n- Pages with console/runtime errors: \(.summary.consoleOrRuntimeErrors)\n- Pages with axe violations: \(.summary.a11yPages)\n\nArtifacts: `pages.jsonl`, `api.jsonl`, `urls.unique`, screenshots and raw browser diagnostics."' "$REPORT_JSON" > "$REPORT_MD"
	echo "RG_BROWSER_REPORT=$REPORT_JSON"
	echo "RG_BROWSER_STATUS=$status"
	[ "$status" = ok ]
}

while :; do
	if run_once; then exit 0; else exit_code=$?; fi
	[ "$MODE" = loop ] || exit "$exit_code"
	echo "Nouvelle passe dans ${INTERVAL}s (Ctrl-C pour arrêter)" >&2
	sleep "$INTERVAL"
done
