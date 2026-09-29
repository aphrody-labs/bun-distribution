# Tenor v2 and GIPHY runtime audit

Audit date: 2026-09-13

## Executive result

Tenor v2 is no longer a viable production provider. Google stopped accepting new
integrations on 2026-01-13 and fully decommissioned the Tenor API on 2026-06-30.
Aphrody Web should retain Tenor parsing only as an offline compatibility fixture, remove
Tenor from runtime provider discovery, and direct new GIF search traffic to GIPHY.

The GIPHY adapter targets the correct search endpoint, but it needs stricter
response validation, a corrected safety-level mapping, country propagation,
pagination support, and a way to preserve GIPHY analytics URLs. The current
normalized attribution string is useful metadata but does not by itself satisfy
the requirement that the product conspicuously display an approved GIPHY mark.

No live authenticated probes were made: `TENOR_API_KEY`, `TENOR_CLIENT_KEY`, and
`GIPHY_API_KEY` were unset. No credential was obtained, printed, or persisted.

## Tenor v2 findings

### Lifecycle

The current Google support notice is definitive:

- new API keys and integrations stopped on 2026-01-13;
- agreements ended and existing integrations were fully decommissioned on
  2026-06-30;
- requests after that date are expected to fail.

Consequently, `TenorGifProvider.available()` must not become true merely because
`TENOR_API_KEY` is present. An environment variable can contain a historical key
without making the retired service available.

### Historical contract (useful only for compatibility tests)

The former endpoint was `GET https://tenor.googleapis.com/v2/search` with:

- required `q` and `key`;
- strongly recommended stable `client_key`, `country`, `locale`,
  `contentfilter`, and `media_filter`;
- `limit` default 20 and maximum 50;
- opaque cursor pagination: pass the response `next` value back as `pos`.
  `pos` is not a numeric offset and an empty `next` means no further page;
- content levels `high`, `medium`, `low`, and `off`, corresponding to G,
  G+PG, G+PG+PG-13, and G+PG+PG-13+R (without nudity);
- response shape `{ next, results }`; each result can contain `id`, `title`,
  `content_description`, `itemurl`, and `media_formats`;
- media objects contain `url`, `dims`, `duration`, and `size`;
- successful status 200 or 202; errors use 4xx/5xx with the standard Google API
  error shape.

The existing parser's `gif`/`tinygif` selection and dimensions are structurally
correct for archived responses. Historically, Tenor limited keys to 1 request
per second. Cached content URLs had to be refreshed at least every 24 hours and
responses' `Cache-Control` headers had to be respected.

Tenor required visible attribution in one of three contexts: “Powered By Tenor”
while browsing, “Search Tenor” in the search box, or “Via Tenor” on shared GIFs.
This is now relevant only when rendering retained historical Tenor content.

## GIPHY findings

### Search request

The endpoint is correctly selected:

`GET https://api.giphy.com/v1/gifs/search`

Current request requirements and bounds:

- `api_key` and `q` are required;
- `q` has a maximum length of 50 characters; an overlong URI/query can produce
  HTTP 414;
- `limit` defaults to 25; beta keys allow at most 50;
- numeric `offset` defaults to 0 and has a search maximum of 4999;
- `rating` accepts `g`, `pg`, `pg-13`, or `r`; omitting it allows all ratings;
- `lang` is a two-letter ISO 639-1 language code;
- `country_code` is the end user's two-letter ISO 3166-1 alpha-2 country;
- `customer_id` should be stable per user. If Aphrody Web has no suitable identifier,
  GIPHY offers `/v1/randomid`; this must not be synthesized from personal data;
- `bundle=messaging_non_clips` can reduce rendition payload for a GIF messaging
  integration. Fields-on-demand is another supported reduction mechanism.

The current adapter omits `offset`, `country_code`, `customer_id`, and `bundle`.
Its `query.slice(0, 50)` can split a UTF-16 surrogate pair. Truncation should use
Unicode code points and the caller should be told that truncation occurred, or
the query should be rejected before the request.

### Safety mapping defect

Aphrody Web's provider-neutral levels have the same ordering as Tenor. The exact GIPHY
mapping should be:

| Aphrody Web | GIPHY |
| --- | --- |
| `high` | `g` |
| `medium` | `pg` |
| `low` | `pg-13` |
| `off` | `r` |

The current implementation maps `medium` to `g`, making it stricter than the
declared option. Keeping an explicit safe default (`g`) is reasonable, but it
must be documented because GIPHY's server-side default is effectively unfiltered.

### Response and error contract

Successful search responses contain:

- `data: GifObject[]`;
- `pagination: { total_count, count, offset }`;
- `meta: { status, msg, response_id }`.

Every response must validate `meta.status`, not only HTTP `response.ok`. GIPHY's
official Tenor migration guide also identifies a synthetic error case: an empty
body/data with `meta.status === 200` and an empty `meta.response_id` must be
treated as failure. Relevant HTTP errors are 400, 401, 403, 404, 414, 429, and
5xx. Retry only 429 and transient 5xx/network failures, use bounded exponential
backoff with jitter, and do not retry authentication or malformed-query errors.

Beta keys are limited to 100 API calls per hour. Production capacity requires a
separately approved production key. A 429 therefore needs to remain observable;
the aggregate provider layer must not silently turn repeated quota exhaustion
into an indistinguishable “no results” response.

### Renditions and URL handling

The parser understands the documented `images` object, whose rendition fields
contain string `url`, `width`, and `height` values. However, selecting `original`
for every search result is unnecessarily expensive. GIPHY recommends smaller
`fixed_width` or `fixed_height` MP4/WebP renditions for a result grid, then a
larger `downsized_large`, `downsized_medium`, `downsized`, or original rendition
only after selection. For a GIF-only normalized contract, a practical order is:

- display/share URL: `downsized`, then `downsized_medium`, then `original`;
- preview URL: `fixed_width_small`, then `fixed_width`, then display URL.

The API documents rendition URLs as publicly accessible, but does not provide a
permanence guarantee. Aphrody Web should cache result metadata briefly, retain the GIPHY
ID and canonical page URL, and be prepared to refresh a missing media URL. It
must not copy third-party GIF binaries into a permanent asset store by default.

### Attribution and analytics

GIPHY requires every app using the API to conspicuously show an approved
“Powered By GIPHY” attribution mark where the API is used. Returning the text in
JSON is not sufficient unless the consuming UI actually renders the approved
mark.

Each GIF can also include `analytics.onload.url`, `analytics.onclick.url`, and
`analytics.onsent.url`. GIPHY recommends firing these action URLs when the item
is shown, clicked, or sent, appending `customer_id` and a millisecond `ts`. The
current normalization discards the analytics object, making compliant event
registration impossible downstream. Aphrody Web should either expose these three URLs
as provider metadata or expose dedicated view/click/send methods. It must never
log analytics URLs because their payloads and customer identifiers are runtime
data.

## Exact adapter changes for the parent

1. Disable Tenor runtime registration and availability unconditionally, with a
   clear retirement reason. Keep its parser only for offline fixture coverage.
2. Correct `medium -> pg` in GIPHY's rating mapping and test all four mappings.
3. Send normalized `country_code`; validate alpha-2 country and two-letter
   language values before constructing the request.
4. Extend the search contract with provider pagination: numeric GIPHY `offset`
   and returned pagination; do not reuse Tenor's opaque cursor semantics.
5. Add `bundle=messaging_non_clips` (or explicit fields-on-demand) and prefer
   bounded display/preview renditions instead of unconditional `original`.
6. Parse and validate `meta`, `pagination`, and `analytics`; reject synthetic
   200 errors and surface provider failures without secrets.
7. Add bounded retry/backoff for 429, 5xx, timeout, and network failures. Preserve
   the final provider/status category for observability.
8. Preserve analytics URLs behind an explicit provider metadata/event interface
   and pass a privacy-safe stable `customer_id` only when the consumer supports
   action registration.
9. Keep API keys exclusively in runtime environment/secret injection. Never put
   keys in cache keys, error messages, CLI output, fixtures, or persisted request
   URLs. Use separate GIPHY keys for distinct platforms/use sections as required
   by GIPHY's production guidance.
10. Ensure CLI/MCP documentation says GIPHY requires a key and Tenor is retired;
    provider discovery must not advertise Tenor.

## Safe validation performed

- Inspected the in-progress provider and focused tests without modifying the
  parent's reserved files.
- Confirmed all three relevant environment variables were unset by checking only
  presence, never values.
- Compared request construction and parser fields with current official schemas.
- No live authenticated endpoint was called and no fixture was necessary.

## Primary sources

- [Google Tenor API discontinuation notice](https://support.google.com/tenor/answer/10455265#whatll-happen-to-the-tenor-api&zippy=%2Cwhatll-happen-to-the-tenor-api)
- [Tenor search endpoints](https://developers.google.com/tenor/guides/endpoints)
- [Tenor response objects and errors](https://developers.google.com/tenor/guides/response-objects-and-errors)
- [Tenor content filtering](https://developers.google.com/tenor/guides/content-filtering)
- [Tenor rate limits and caching](https://developers.google.com/tenor/guides/rate-limits-and-caching)
- [Tenor attribution](https://developers.google.com/tenor/guides/attribution)
- [GIPHY endpoints and schemas](https://developers.giphy.com/docs/api/endpoint/)
- [GIPHY response codes](https://developers.giphy.com/docs/api/response-codes/)
- [GIPHY API quickstart and production-key guidance](https://developers.giphy.com/docs/api/quick-start-guide/)
- [GIPHY Tenor migration guide](https://developers.giphy.com/docs/api/tenor-migration/)
- [GIPHY rendition guide](https://developers.giphy.com/docs/optional-settings/rendition-guide/)
