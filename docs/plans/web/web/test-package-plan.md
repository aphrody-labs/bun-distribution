<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- docs-links: external-paths — backtick paths in this document name files of the microsoft/playwright upstream repository, not of this checkout. -->

# `@aphrody/bxc-test` — Playwright-compatible test package plan

Status: v1 implemented (2026-06-04). Bun `1.4.0-canary.1+5836485c9`.

A Playwright-compatible browser/site test package, backed by Aphrody Web's **own**
in-process CDP layer (`src/cdp/**` + `src/api/browser.ts`) and Bun's native test
runner (`bun:test`). No Chromium bundling, no Playwright dependency, no Node-only
deps. Pure Bun/Web APIs (`bun:test`, `Bun.serve`, `Bun.file`, `fetch`/`Response`).

## 1. What Playwright actually exposes (reference: `/tmp/playwright`)

The public surface a Next.js / site test author touches, read from source:

| Concept | Playwright source | Public API |
| --- | --- | --- |
| Test runner | `packages/playwright/src/index.ts:907` (`test = _utilityTest.extend(...)`) | `test()`, `test.describe`, `test.beforeEach`, `test.skip`, `test.only` |
| Fixtures | `packages/playwright/types/test.d.ts:2763` (`TestType.extend`) | `test.extend<Fixtures>({...})` — `page`, `request`, `context` injected per-test |
| Config | `packages/playwright/src/index.ts:909` (`defineConfig`) | `playwright.config.ts` → `{ use, timeout, retries, projects, workers }` |
| Web-first assertions | `packages/playwright/src/matchers/matchers.ts` | `expect(locator).toBeVisible()` (`:165`), `toHaveText()` (`:373`), `toHaveCount()` (`:310`), `toContainText()` (`:188`), `toHaveAttribute()` (`:243`), `toBeEnabled()` (`:132`), `toHaveValue()` (`:392`) |
| Auto-retry expect | `packages/playwright/src/matchers/toBeTruthy.ts:31-38` + `toEqual.ts` | every web-first matcher polls `query(isNot, timeout)` until pass or `timeout` |
| Locator engine | `packages/playwright-core/src/client/locator.ts:41` | `page.locator(sel)`, `.click()` (`:110`), `.fill()` (`:145`), `.textContent()` (`:359`), `.isVisible()` (`:314`), `.count()` (`:265`), `.waitFor()` (`:389`), `.filter()` (`:208`), `.first/.last/.nth` |
| Semantic locators | `locator.ts:176-201` → `packages/isomorphic/locatorUtils.ts:45,65,69` | `getByTestId`, `getByText`, `getByRole`, `getByLabel`, `getByPlaceholder`, `getByAltText`, `getByTitle` |
| Page/Context/Browser | `packages/playwright-core/src/client/{page,browserContext,browser}.ts` | `page.goto`, `page.setContent`, `page.title`, `page.content`, `page.locator`, `context.newPage` |

### How Playwright drives Chromium (for contrast)

Playwright speaks CDP over a WebSocket to a spawned Chromium:
`packages/playwright-core/src/server/chromium/crConnection.ts:45`
(`CRConnection`), `:68` (`_rawSend(sessionId, method, params)`), `:137`
(`CRSession.send`). Its `getByRole` / `getByText` selectors (`internal:role=…`,
`internal:text=…`) are resolved **inside the page** by an injected script
(`packages/injected`), because real Chromium has a JS engine and full layout.

**Aphrody Web differs fundamentally**: Aphrody Web's `src/cdp/**` is an *in-process CDP server*
(a `DomainHandler` chain answering CDP method calls — `src/cdp/types.ts:477`),
not a client driving Chromium. In the default `static` profile there is **no JS
engine and no layout engine** (probed: `Runtime.evaluate` returns `undefined`,
`DOM.getBoxModel` returns a zero box — `src/cdp/domains/DOM.ts:161`). So our
compat layer cannot inject a script; it resolves semantic locators to **CSS**
and queries via `DOM.querySelectorAll` (`src/cdp/domains/DOM.ts:121`).

## 2. Bun DOM testing audit (reference: official Bun docs)

- `@happy-dom/global-registrator` + `bunfig.toml [test] preload` injects
  `document`/`window` globals for component tests
  (see the [Bun DOM testing guide](https://bun.com/docs/guides/test/happy-dom)).
  That path is for **unit/component** DOM
  tests, orthogonal to driving a real navigated page.
- Bun ships Web APIs natively: `fetch`, `Response`, `Request`, `Headers`,
  `DOMParser`, `URL`, `Blob`, `structuredClone`. `bun:test` is Jest-like
  (`test`, `describe`, `expect`, `beforeAll/Each`, `afterAll/Each`, `mock`).
- **Design choice**: aphrody web already navigates and parses real HTML through its CDP
  DOM domain (zigquery / JS fallback). We therefore drive *Aphrody Web pages*, not
  happy-dom globals — this matches Playwright's "navigate a page, assert on
  locators" model far more closely than happy-dom's "mutate `document.body`".
  happy-dom stays available for callers who want pure component tests; it is
  documented as a roadmap seam, not wired into the locator API.

## 3. Aphrody Web CDP capability map (the substrate)

Public entry: `src/api/browser.ts` → `Browser.newPage({ profile })` returns an
`AnyPage` (`src/api/types.ts:35`). Probed capabilities in `static` profile
(fully offline, no binary):

| aphrody web capability | CDP method (handler) | Works in `static`? |
| --- | --- | --- |
| navigate | `Page.navigate` (`StaticDomTransport`) | yes (fetch + parse) |
| title | `Runtime.evaluate document.title` → `Page.title` fallback | yes |
| content / outerHTML | `DOM.getDocument` + `DOM.getOuterHTML` (`DOM.ts:85,132`) | yes |
| setContent | `Page.setDocumentContent` (`Page.ts`) | yes |
| query one | `DOM.querySelector` (`DOM.ts:110`) | yes (CSS) |
| query all | `DOM.querySelectorAll` (`DOM.ts:121`) | yes (CSS, incl. `[attr="v"]`) |
| node text | `DOM.getOuterHTML` → strip tags | yes |
| attribute | `DOM.describeNode` (`DOM.ts:141`) | yes |
| box model | `DOM.getBoxModel` (`DOM.ts:161`) | returns **zero** box (no layout) |
| evaluate JS | `Runtime.evaluate` | **no** (returns `undefined`) |
| screenshot | `Page.captureScreenshot` | throws (needs `fast` profile) |

**Consequence for visibility**: with no layout, "visible" cannot mean "non-zero
box". v1 defines visibility as Playwright does *minus* layout: attached to the
DOM and **not** `hidden` / `display:none` / `[hidden]` / `aria-hidden="true"`
(parsed from the `style`/attribute set). Documented honestly as "adapted".

## 4. Architecture of `@aphrody/bxc-test`

```
packages/test/
├── package.json            # @aphrody/bxc-test, workspace member (packages/*)
├── tsconfig.json           # mirror packages/x: moduleResolution Bundler, types ["bun"]
├── README.md               # usage + compat table
├── src/
│   ├── index.ts            # public surface: test, describe, expect, defineConfig, fixtures
│   ├── runner.ts           # bun:test re-export + aphrody web fixture seam (test.extend-style)
│   ├── page.ts             # TestPage wrapper over Aphrody Web AnyPage (navigate/locator/getBy*)
│   ├── locator.ts          # BxcLocator: CSS + semantic resolution over src/cdp DOM
│   ├── selectors.ts        # getByRole/getByTestId/getByText → CSS mapping (role table)
│   ├── expect.ts           # web-first expect(locator): auto-retry matchers
│   └── config.ts           # defineConfig + TestOptions (playwright.config shape)
└── test/
    └── locator.test.ts     # real passing test: Bun.serve(:0) + CDP locator asserts
```

### 4.1 Runner / fixture seam (`runner.ts`)

- Re-export `test`, `describe`, `it`, `beforeAll`, `afterAll`, `beforeEach`,
  `afterEach`, `mock` straight from `bun:test` so any file runs under
  `bun test`. (`test.describe` alias provided for Playwright muscle memory.)
- `bxcTest(name, fn)` / `createTest(opts)` provide a Playwright-style fixture: a
  fresh `TestPage` (Aphrody Web `static` page) is created before the body and closed
  after, via `bun:test`'s try/finally — mirrors Playwright's per-test `page`
  fixture (`packages/playwright/src/index.ts:907`) without a worker pool.

### 4.2 CDP → locator mapping (`locator.ts` + `selectors.ts`)

| Playwright call | aphrody web resolution |
| --- | --- |
| `page.locator("css")` | CSS verbatim → `DOM.querySelectorAll` |
| `getByTestId("x")` | `[data-testid="x"]` (configurable attr) |
| `getByRole("button")` | role→CSS table: `button,[role="button"]`; `heading`→`h1..h6,[role=heading]`; `link`→`a[href],[role=link]`; `textbox`→`input,textarea,[role=textbox]`; … + `name` ⇒ accessible-name text filter |
| `getByText("hi")` | querch all, filter by stripped `textContent` (exact / substring) |
| `getByLabel`, `getByPlaceholder`, `getByAltText`, `getByTitle` | attribute-based CSS (`[placeholder=…]`, `[alt=…]`, `[title=…]`, `label[for]`/`aria-label`) |
| `.filter({ hasText })` | post-filter resolved nodeIds by text (reuses existing `internal:has-text` convention in `src/api/Locator.ts:128`) |
| `.first()/.last()/.nth(i)` | index into resolved nodeId list |

Resolution returns **nodeIds** from `DOM.querySelectorAll`; text via
`DOM.getOuterHTML` strip; attributes via `DOM.describeNode`. Identical substrate
to the shipping `src/api/Locator.ts`, so behaviour is consistent with aphrody web proper.

### 4.3 Auto-waiting expect (`expect.ts`)

Mirrors `toBeTruthy.ts:31-38`: each web-first matcher runs a `query()` closure
in a poll loop (`Bun.sleep(intervalMs)`) until it passes or `timeout` elapses,
then throws a Playwright-shaped message (`Expected: …  Received: …  Timeout …ms`).
- `toBeVisible()` → attached & not hidden (see §3 visibility note).
- `toHaveText(s|re)` → exact (string) / regex match of stripped text.
- `toContainText(s)` → substring.
- `toHaveCount(n)` → resolved nodeId count equals `n`.
- `toHaveAttribute(name, value?)` → `DOM.describeNode` attr equals/exists.
- `toBeEnabled()` / `toBeDisabled()` → absence/presence of `disabled`.
- `.not` inverts the predicate (poll for the negation).

Non-locator values fall through to `bun:test`'s `expect` unchanged, so
`expect(2+2).toBe(4)` still works in the same file.

### 4.4 Config (`config.ts`)

`defineConfig({ use: { baseURL, testIdAttribute, profile }, timeout, expect: {
timeout }, retries })` — a typed options object identical in shape to
`playwright.config.ts`. Consumed by the fixture seam (`baseURL` prefixing,
`testIdAttribute` for `getByTestId`, `profile` selecting the aphrody web transport).
Retries/projects/workers are accepted and surfaced but delegate to `bun test`'s
own runner (Bun owns parallelism), documented under compat.

## 5. v1 scope vs roadmap

**In scope v1 (implemented, tested):** `test`/`describe`/`expect` over `bun:test`;
`TestPage` (`goto`, `setContent`, `title`, `content`, `locator`, `getByTestId`,
`getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`); `BxcLocator`
(`click`, `fill`, `textContent`, `getAttribute`, `isVisible`, `count`,
`waitFor`, `filter`, `first/last/nth`); web-first auto-retry `expect`
(`toBeVisible`, `toHaveText`, `toContainText`, `toHaveCount`, `toHaveAttribute`,
`toBeEnabled`, `toBeDisabled`, `.not`); `defineConfig` + fixture seam; one real
green test driving `Bun.serve({port:0})` fully offline.

**Roadmap (documented, not stubbed):**
- Layout-aware visibility / `toBeInViewport` — needs the `fast` (Lightpanda)
  profile's real layout; static has no box model.
- `expect(locator).toHaveScreenshot()` / trace viewer / video — needs a
  rendering engine; `Page.captureScreenshot` throws in `static`.
- Full accessibility-tree `getByRole` (ARIA name computation) — v1 uses a
  role→CSS heuristic table + text filter; a complete a11y tree can read
  `src/cdp/domains/Accessibility.ts`.
- React Testing Library / happy-dom component path — available via Bun's
  `@happy-dom/global-registrator` preload, kept orthogonal.
- Worker-pool parallelism / projects / retries semantics — delegated to Bun's
  test runner; the config fields are accepted for source-compat.

## 6. Playwright-compat guarantees

| Playwright API | Status | Note |
| --- | --- | --- |
| `import { test, expect } from <pkg>` | drop-in | re-exports `bun:test` + web-first `expect` |
| `test.describe / beforeEach / afterEach / skip / only` | drop-in | `bun:test` equivalents |
| `page.goto / setContent / title / content` | drop-in | Aphrody Web `AnyPage` |
| `page.locator(css)` | drop-in | CSS over `DOM.querySelectorAll` |
| `getByTestId` | drop-in | `[data-testid=…]`, configurable attr |
| `getByText` (string/exact) | drop-in | text filter |
| `getByRole(role, { name })` | adapted | role→CSS heuristic, not full ARIA tree |
| `getByLabel/Placeholder/AltText/Title` | adapted | attribute-based CSS |
| `locator.click/fill/textContent/count/isVisible/waitFor/filter/nth` | drop-in (static caveats) | over CDP DOM/Input |
| `expect(locator).toBeVisible/toHaveText/toContainText/toHaveCount/toHaveAttribute/toBeEnabled` | drop-in (visibility adapted) | auto-retry |
| `defineConfig({ use, timeout, expect })` | drop-in (shape) | consumed by fixture seam |
| `projects / workers / retries` | adapted | Bun owns parallelism |
| `toHaveScreenshot / trace / video` | not-yet | needs render engine (roadmap) |
| `getByRole` full ARIA name | not-yet | heuristic in v1 |

## 7. References

- Aphrody Web: `src/api/browser.ts`, `src/api/Locator.ts`, `src/cdp/domains/DOM.ts`,
  `src/cdp/types.ts`, `src/api/types.ts`.
- Playwright `/tmp/playwright`: `packages/playwright/src/index.ts:907`,
  `packages/playwright/src/matchers/{matchers.ts,toBeTruthy.ts}`,
  `packages/playwright-core/src/client/locator.ts`,
  `packages/isomorphic/locatorUtils.ts`,
  `packages/playwright-core/src/server/chromium/crConnection.ts:45`.
- Bun docs: [happy-dom](https://bun.com/docs/guides/test/happy-dom),
  [bun:test](https://bun.com/docs/test).

## 8. `@aphrody/bxc-test/next` — the Next.js `instant()` port

Consolidated directly into `@aphrody/bxc-test` as `@aphrody/bxc-test/next` (formerly `packages/next-playwright`). It is a
faithful, publishable port of vercel's
[`packages/next-playwright`](https://github.com/vercel/next.js/tree/canary/packages/next-playwright)
(`16.3.0-canary.39`, MIT) onto this test package + Aphrody Web's CDP layer — **no
`@playwright/test` runtime dependency**.

`instant(page, fn, options?)` runs `fn` while the
`next-instant-navigation-testing` cookie is set, so a Next app with Cache
Components serves only the prefetched shell inside the scope.

**Copied byte-for-byte** (the load-bearing Next.js contract): the cookie name
`next-instant-navigation-testing`, the value shape
`JSON.stringify([0, "p"+Math.random()])` with `domain`/`path` scoping, the
nesting guard (`context().cookies()` read), `resolveURL` + its `about:blank`
error text, and the acquire→`fn`→release-in-`finally` semantics.

**Reimplemented on Aphrody Web:**
- `src/next/context.ts` — `CdpCookieContext`, a `PlaywrightBrowserContext`-shaped
  adapter mapping `addCookies` / `cookies` / `clearCookies` onto
  `Network.setCookies` / `Network.getCookies` / `Network.deleteCookies`. Plus
  `adaptPage(testPage)` bridging an Aphrody Web `TestPage` (`_cdp` / `_send` + `url()`)
  to the structural `PlaywrightPage`.
- `src/next/step.ts` — the step seam targets a pluggable aphrody web reporter
  (`setStepReporter`), defaulting to direct execution (upstream's Jest fallback),
  instead of probing `@playwright/test`'s `test.step`.
- `src/sites/index.ts` — canonical site helpers and presets for Rose Griffon, Shenron,
  and Aphrody UI / Next.js.

This port surfaced and fixed a real gap: Aphrody Web's `static` Network domain did not
implement `Network.deleteCookies` (so `Page.clearCookies({name})` — and thus the
`instant()` release step — was broken offline). Added in
`src/cdp/domains/Network.ts` with domain-level tests in
`test/cdp/domains/Network.test.ts`.

**Relationship to `src/next`:** aphrody web core also ships `@aphrody/bxc/next`
(`src/next/`), a bxc-native, page-direct `instant()` variant (the page itself
exposes the cookie ops; nesting is guarded by an in-process flight lock) plus
`withPlaywrightPage()`. The test package (`@aphrody/bxc-test/next`) is the faithful `context()`-shaped mirror of
vercel's package for `bun test` suites; the core module is the ergonomic path
for quick aphrody web scripts. Both share the cookie constant.

**Test:** `bun test packages/bxc-test/test/next-instant.test.ts` — offline tests driving the
real cookie protocol through the `static` CDP jar (acquire/release, release-on-
throw, hostname scoping, nesting rejection, baseURL fallback, descriptive
fresh-page error, delete-by-name). Green: `tsc --noEmit`, `oxlint`.
