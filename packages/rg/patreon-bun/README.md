<!-- SPDX-License-Identifier: MIT -->
# @rosegriffon/patreon-bun

Bun and ESM client for the Patreon V2 API. This fork is based on
[`patreon-api.ts` v0.19.0](https://github.com/ghostrider-05/patreon-api.ts)
by ghostrider-05. See the [MIT license](LICENSE) and upstream project for the
original work.

The package requires Bun 1.4.2 or newer. It exports ESM JavaScript and
TypeScript declarations from `dist/`; build the package before using it from
this checkout.

## Install

```sh
bun add @rosegriffon/patreon-bun
```

## Creator API

```ts
import { PatreonCreatorClient } from "@rosegriffon/patreon-bun";

const client = new PatreonCreatorClient({
  oauth: {
    clientId: Bun.env.PATREON_CLIENT_ID!,
    clientSecret: Bun.env.PATREON_CLIENT_SECRET!,
    token: {
      access_token: Bun.env.PATREON_CREATOR_ACCESS_TOKEN!,
      refresh_token: Bun.env.PATREON_CREATOR_REFRESH_TOKEN!,
    },
  },
});

const campaigns = await client.fetchCampaigns();
console.log(campaigns);
```

## Webhook handler

```ts
import { parseWebhookRequest } from "@rosegriffon/patreon-bun";

Bun.serve({
  port: 3000,
  async fetch(request) {
    if (new URL(request.url).pathname !== "/webhook" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const result = await parseWebhookRequest(request, Bun.env.PATREON_WEBHOOK_SECRET!);
    if (!result.verified) return new Response("Unauthorized", { status: 401 });

    console.log(result.event, result.payload);
    return new Response("OK");
  },
});
```

`parseWebhookRequest` validates the Patreon signature and returns a result
with `verified`, `event`, and `payload`. The payload is available only when
verification succeeds. See the [guide](docs/guide/installation.md) and
[Bun example](examples/bun-esm/) for more usage.

## Development

```sh
bun run build
bun run type-check
bun run test
```

## Credits

The API client, OAuth flow, schema model, and webhook implementation originate
from the upstream `patreon-api.ts` project by ghostrider-05. This fork adapts
its build, tests, and package surface for Bun and the Rose Griffon monorepo.
