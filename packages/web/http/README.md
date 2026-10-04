# Aphrody HTTP transport

`@aphrody/http` owns the portable HTTP/JSON mechanism used by the Shenron API,
Aphrody compute and OCR clients. It has no production dependencies, environment
lookup, subprocess, service or domain store.

`requestJson(url, init, { timeoutMs, fetch?, readErrorBody?, emptyStatus? })`
makes one request. The deadline and caller signal cover headers and body.
Redirects are refused; discarded error/absence bodies are cancelled.
Successful JSON is returned as `unknown` for the caller's schema.
`JsonTransportError` distinguishes request, body and JSON failures and retains
the original cause. Callers own any user-facing error policy and redaction.

API clients retain their paths, signing, credentials, schemas, pagination and
domain errors. AI clients retain personas, model selection, grounding,
embedding batches and their existing failure contracts. No automatic retry.

Run `bun test`, `bun run typecheck`, and scoped oxlint/oxfmt from this package.
The tests use ephemeral loopback HTTP servers and synthetic inputs.
