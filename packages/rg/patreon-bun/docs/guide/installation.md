---
webhook-examples:
  - title: Cloudflare webhook
    details: Worker to forward Patreon posts to Discord
    link: https://github.com/rose-griffon/rg/tree/main/packages/patreon-bun/examples/cloudflare-webhook/
    linkText: See on GitHub
  - title: Bun webhook
    details: Server to forward Patreon posts to Discord
    link: https://github.com/rose-griffon/rg/tree/main/packages/patreon-bun/examples/bun-webhook/
    linkText: See on GitHub
api-examples:
  - title: Bun - ESM
    details: Fetch creator campaigns and update or create webhooks
    link: https://github.com/rose-griffon/rg/tree/main/packages/patreon-bun/examples/bun-esm/
    linkText: See on GitHub
---

# Installation

## Platform

This fork requires Bun 1.4.2 or newer and exports ESM only.

## Set up

Install the package with Bun:

```sh
bun add @rosegriffon/patreon-bun
```


## Examples

To get started you can see one of the examples:

<Features fmkey="api-examples" />

or read more about [the features your application needs](./features/oauth).

To [create a webhook server](./features/webhooks#webhook-server) for receiving webhook events, see one of these examples for inspiration:

<Features fmkey="webhook-examples" />

<script setup>
import Features from '../.vitepress/components/DocFeatures.vue'
</script>
