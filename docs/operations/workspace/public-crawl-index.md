# Public Google crawl index

The Bun fork owns crawling, extraction, the public snapshot consumer and its
search cache. Aphrody owns the HTTP route and the declared Infra publication.
This pipeline indexes explicitly selected public sites; it does not establish
complete coverage of Google, an authenticated Google session or a private mirror.

## Isolation and source contract

The producer uses a dedicated anonymous crawl job with explicit seed hosts,
request and depth limits, robots rules, a timeout and a persisted policy. The
transport must enforce the domain scope before every HTTP redirect hop, including
robots and sitemap requests. Existing persisted URLs must match the job policy
before indexing. Failed robots retrieval refuses the page; a missing robots
document (404 or 410) is a separate case. Redirect destinations disallowed by
robots must be rejected before extraction and persistence. That latter check
does not prove robots enforcement before the redirected network request.

The producer exports public documents from that dedicated job. General home
indexes, browser profiles, cookies, account sessions and password stores are not
snapshot inputs. A working Mullvad tunnel proves egress availability only; it
does not prove the crawl, result availability or authorization for private pages.

Each immutable JSON snapshot has `schemaVersion: 1`, a collection slug,
`generatedAt`, provenance and documents. Provenance pins `owner` to
`aphrody-web-crawl`, a 40-character `sourceRevision`, a 64-character
`policySha256`, and `anonymous: true` and `public: true`. The consumer also checks
the configured owner, policy and allowed public hosts; those two booleans alone
do not authorize publication.

Documents contain `url`, `title`, plain UTF-8 `text`, `contentBytes` and
`contentSha256`. The checksum covers the exported text bytes. An optional
`originalContentSha256` identifies the source document separately. The snapshot
is bounded to 4 MiB, 1,000 documents and 32 KiB of text per document. Coverage
records actual `attempted`, `done`, `pending`, `failed`, `complete`, `timedOut`
and `exported` counts. A timeout or exhausted budget is not exhaustive coverage.

The producer writes the immutable `<sha256>.json` file before atomically changing
the collection pointer. The pointer contains `schemaVersion`, `collection`,
`file` and `sha256`; its filename and checksum identify the same snapshot.
Request parameters never select a filesystem path. Preserve the previous
qualified pointer and snapshot for rollback.

## HTTP adapter and explicit configuration

The proposed public endpoint is `GET /api/index/search`, on the declared site
hosts. It accepts `query`, a collection slug, `num` from 1 to 20 and `start` from
0 to 1,000. Invalid, repeated or unknown parameters are rejected. Cancellation
passes to the SDK. Live Google search remains the separately qualified
`/api/search` capability.

The standalone server loads an explicitly installed SDK module through
`PUBLIC_INDEX_SDK_MODULE`. `PUBLIC_INDEX_ROOT` selects the declared public export
root. `PUBLIC_INDEX_COLLECTIONS` supplies the collection pointer, exact public
hosts, policy checksum and owner for each enabled collection. No implicit home,
database or profile discovery supplies missing configuration.

The adapter delegates to Bun's `createPublicIndexSearch({ root, collections })`.
Its search function takes `{ query, collection, num, start }` and an optional
abort signal. It returns `body`, `etag` and `cache` (`hit` or `miss`). The body
contains `query`, `organic` results (`title`, `url`, `snippet`),
`source: "public-crawl-cache"`, `collection` and `generatedAt`. The SDK owns
snapshot validation, the bounded FTS projection, cache invalidation and ETags.
The HTTP adapter does not duplicate that index. A matching `If-None-Match`
returns 304 without a body. Unconfigured or unavailable indexes return a
redacted 503; fixtures never supply production results.

To serve the existing M3 search interface from that same public index, explicitly
set `PUBLIC_SEARCH_BACKEND=public-index` and `PUBLIC_INDEX_DEFAULT_COLLECTION`
to an approved collection. `/api/search` retains its anonymous request validation
and delegates to the same index response contract. It forwards cancellation and
conditional cache headers, not request cookies or authorization. Without that
configuration its existing Google provider remains selected. An unsupported
backend or missing index fails; it never silently switches providers.

## Publication and evidence gates

Before apply, Infra must declare the producer, export root, read-only service
access, module placement and public ingress route. The existing Downloads
publisher and [publication evidence](public-google-search-publication.md)
establish the prior UI and live-search deployment boundary; they do not prove
this new route. Preserve concurrent services and deployments.

Qualify the native crawl source and tests, build and checksum the actual Linux
CLI, then verify its installed capability. Run a bounded public crawl through
the selected explicit egress and record real recursion, refusals and coverage.
Validate and checksum its export before publishing the pointer. Activate the
coupled SDK, configuration and HTTP server through the reviewed owner plan,
with checksum-verified rollback. Finally verify external HTTPS responses,
result provenance, ETag/304 behavior and changed-snapshot invalidation. Source
tests, packaging, installation and public behavior are distinct gates.

Read-only VPS probes on 2026-10-11 found the Downloads service active, loopback
8797 `/health` returning 200 and `https://aphrody.com/` returning 200.
`https://aphrody.com/api/index/search?q=bun` returned 404. At that observation,
the public index endpoint and a production Google crawl were not qualified.
