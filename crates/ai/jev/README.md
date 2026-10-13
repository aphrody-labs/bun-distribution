<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-jev

`aphrody-jev` sends typed Jev decisions to TypeSafe SaaS or a compatible
gateway, and can use local jeff or aphrody inference as a fallback.

## Native decision policy

Rust consumers share `aphrody_jev::confident_choice(&request, &response,
"tool", 0.8)`. It validates the request and response, returns the supplied Choice
candidate at or above the threshold, and returns `None` below it. Unknown
candidates, invalid thresholds and malformed answers remain errors. The response
and its distributions are retained; selection does not execute an action or grant
permissions.

`aphrody jev decide --minimum-confidence 0.8 < request.json` uses the same policy.
Its JSON adds `selections` for Choice questions: a candidate name or `null` for
abstention. Raw answers and distributions remain present. Without the option,
the existing output shape is unchanged; invalid options fail before inference.

This implements the abstention pattern described by
[Jev Workflows](https://github.com/integrate-your-mind/jev-codex-plugin/blob/f67f0f35df13cbc0556539e6f86fe14e2c04d6f8/README.md)
in the existing Rust owner, without another SDK dependency or MCP server.

## Vercel AI Gateway

Vercel AI Gateway exposes TypeSafe's `systemone` API. Jev is listed as free
through September 25, 2026; check the current model page before relying on the
promotion. Create an AI Gateway API key in the Vercel dashboard and keep it out
of source control.

Configure the existing TypeSafe SaaS route to use the gateway:

```powershell
$env:APHRODY_JEV_MODE = 'api-key'
$env:TYPESAFE_BASE_URL = 'https://ai-gateway.vercel.sh/typesafe'
$env:TYPESAFE_API_KEY = '<AI Gateway API key>'
```

Use Vercel's model identifier in the request (`typesafe-ai/jev`):

```powershell
'{"state":"A customer reports a duplicate charge.","model":"typesafe-ai/jev","questions":{"refund":{"type":"noul","instructions":"Is a refund explicitly requested?"}}}' |
  aphrody jev decide
```

The gateway endpoint and request format are documented by [Vercel](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe); the model promotion is listed on the [Jev model page](https://vercel.com/ai-gateway/models/jev).

Live access was not verified on September 23, 2026: an API-created gateway key
was rejected with HTTP 401 (`Authentication failed`). The temporary keys used
for this probe were revoked. A dashboard-created key may be needed; do not
assume the free promotion makes usage on this account available until a live
request succeeds.

## Local verification

```powershell
$env:RUSTC_WRAPPER = ''
cargo test -p aphrody-jev --features server --locked --offline -- --test-threads=1
```

The test suite uses local mock servers and does not require gateway
credentials or consume inference credits.
