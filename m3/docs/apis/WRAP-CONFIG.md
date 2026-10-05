<!-- SPDX-License-Identifier: Apache-2.0 -->

# `wrap.json` (`aphrody-web-to-tauri/1`)

Written to `src-tauri/wrap.json` by `@aphrody/web-to-tauri` (`packages/web-to-tauri/src/types.ts`),
read at startup by `aphrody-tauri-wrap` (`crates/ui/tauri-wrap/src/config.rs`). The app does not
start when the file is invalid. Guide: [`docs/guides/ui/WEB-TO-TAURI.md`](../guides/WEB-TO-TAURI.md).

| Field | Type | Meaning |
| --- | --- | --- |
| `schema` | `"aphrody-web-to-tauri/1"` | refused when different |
| `name`, `identifier` | string | product name; reverse-DNS identifier (`io.aphrody.wrapped.<host>`) |
| `mode` | `remote` \| `bundle` \| `sidecar` | see the guide; `bundle` needs `bundle`, `sidecar` needs `sidecar`; `bundle` also needs a runtime built with the `bundle` Cargo feature (default), else the app refuses to start |
| `engine` | `wry` \| `cef` | system webview or Chromium |
| `start` | string | `remote`: absolute `http(s)` URL. Others: a path appended to the loopback origin |
| `origins.app` | string[] | patterns that stay in the app |
| `origins.auth` | string[] | sign-in and payment pages, allowed in-app including popups |
| `origins.embeds` | string[] | third-party frames, allowed in-app |
| `origins.external` | `system` \| `inapp` \| `deny` | what happens to any other URL |
| `window` | object | `title` (`null` follows `document.title`), `width`, `height`, `minWidth`, `minHeight`, `syncTitle`, `zoomHotkeys`, `dragDrop` |
| `userAgent` | string \| null | fixed user agent; `null` keeps the webview's |
| `bundle` | object \| null | `dir`, `backend` (origin or `null`), `proxy` (path prefixes), `spaFallback` |
| `sidecar` | object \| null | `program`, `args`, `port` (`0` = free port, passed as `PORT`), `readyPath`, `readyTimeoutSecs`, `env` |

## Origin patterns

`scheme://[*.]host[:port|:*][/path]`, `http` or `https` only. A pattern that does not parse refuses
the whole file, so a typo never silently matches nothing.

- no port means the default port of the scheme; `:*` any port;
- `*.` matches subdomains only; list the bare host too;
- a path is a prefix: `/app/*` and `/app/` match `/app/x`, not `/application`;
- a `*` path segment matches exactly one segment: `/*/dialog/*` matches `/v19.0/dialog/oauth`.

## Decisions

`allow` (stay in the window), `external` (system browser), `deny`. `about:blank`, `about:srcdoc`,
`blob:`, `data:` and `javascript:` are allowed, `file:` is denied, other schemes follow
`origins.external` (`system` hands them to the OS only for `mailto:`, `tel:`, `sms:`, `http(s):`).

The table is implemented twice (`packages/web-to-tauri/src/policy.ts`,
`crates/ui/tauri-wrap/src/policy.rs`) and both run
`packages/web-to-tauri/fixtures/policy-cases.json`.

## Bundle proxy

Requests under `bundle.proxy` go to `bundle.backend` with: hop-by-hop headers and
`Accept-Encoding` dropped; `Origin` and `Referer` rewritten from the loopback origin to the
backend's; `Set-Cookie` re-scoped (no `Domain`, `Secure` or `Partitioned`; `SameSite=None` becomes
`Lax`; `__Host-` and `__Secure-` cookies pass unchanged); `Location` to the backend made relative.
WebSocket upgrades answer 501.
