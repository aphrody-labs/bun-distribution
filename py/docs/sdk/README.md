<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Python SDK

`aphrody` provides Python clients for Aphrody AI, web, documents and media.
Domain implementations stay in dedicated modules; public imports load only the
requested feature. A plain `import aphrody` requires no provider import,
credential discovery, local executable, or model download.

```python
from aphrody import ActorClient, AphrodyClient, WebBrowserClient

with AphrodyClient.from_credential_manager() as client:
    profile = client.userinfo()

with WebBrowserClient(timeout=30) as web:
    page = web.fetch("https://example.com")

actors = ActorClient(timeout=120, discovery_timeout=10)
available = actors.list()
```

Web operations use the installed `aphrody-kernel`. Actor operations use the
installed Aphrody Web Browser or `APHRODY_WEB_BROWSER_BIN`. Each Actor call has
a finite timeout. Successful output storage belongs to the caller; failed runs
remove only the temporary storage created by the SDK. `list_actors()` and
`run_actor()` remain available for existing consumers.

HTTP clients close connections they create. A borrowed `httpx.Client` remains
owned by its caller. Web clients accept a public `WebBrowserTransport` protocol;
its `receive(timeout=...)` implementation must enforce the supplied deadline.
Injected public transports remain caller-owned. Closing a client is terminal
and idempotent. Notifications consume the current MCP request's total timeout.

Google integrations are available through `aphrody.google`. Providers keep
their own typed clients, configuration and errors. Image, document, voice,
training and local model dependencies remain declared at their owning packages.
The wheel includes the native RAG math extension, its source provenance,
`py.typed`, and the scripts required by `aphrody.bpy_runner`; installed SDK
consumers do not need the source layout.

Mutable review state resolves when `BackgroundReview` is constructed:
`APHRODY_HOME/memory/memory.md` and `APHRODY_HOME/skills`, with explicit
`APHRODY_SECRETS_DIR` taking precedence. Set these variables before constructing
clients. Explicit constructor paths remain authoritative.

Docling model and runtime defaults also honor `APHRODY_HOME`. Supply
`runner_bin` or `APHRODY_LLAMA_MTMD_CLI` to choose a runner; otherwise the SDK
resolves the platform executable through its runtime directory or PATH.
`verify_model_present()` checks weights; `verify_runtime_ready()` additionally
checks the executable. Installation does not download models.

See [native packaging](native-build.md), [validation](validation.md) and the
[remaining production work](PLAN.md). The workspace retains other Aphrody
domains and identified upstream sources until their consumer and license gates
permit migration or removal.
