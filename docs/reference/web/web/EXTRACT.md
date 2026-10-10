# Structured extraction to schema (`aphrody web extract`)

`aphrody web extract` turns pages into typed JSON records that follow a schema. The
common case needs no LLM: Aphrody Web learns CSS selectors from the DOM, checks the
values against the schema, and caches the selectors per registrable domain
(eTLD+1). An LLM is only called for required fields that stay unresolved.

```bash
aphrody web extract --schema '[{"title":"string","price":"number?","url":"uri","image":"uri"}]' \
  https://books.toscrape.com/
aphrody web extract --schema schema.json --format jsonl --concurrency 16 https://news.ycombinator.com/ ...
aphrody web extract --schema schema.json --base-url https://shop.example/c/1 ./saved-page.html
```

Each URL produces `{url, source, confidence, data, missingFields, profile, status}`
(`--selectors` adds the learned plan). `source` is `learned`, `cache`,
`structured-data` or `llm`.

Library API (`src/extract/index.ts`):

```ts
extractWithSchema(html, schema, { url?, cache?, llm?, minConfidence?, relearnThreshold?, now?, dayFirst? })
  -> Promise<{ records? | record?, selectors, confidence, missingFields, source, fillRate, issues, cache, llmFields }>
extractUrlWithSchema(url, schema, { profile? = "http", escalate? = true, fetchPage?, baseUrl?, ...same })
interface LlmFallback { complete(prompt: string, jsonSchema: object): Promise<unknown> }
new SelectorCache({ path? })   // default: defaultDomainMemoryPath(), table extract_selectors
```

## Schema subset

- JSON Schema (draft-07 subset). Use `{type:"object", properties, required}` for
  one record and `{type:"array", items:{type:"object", ...}}` for a list.
  Property types can be `string`, `number`, `integer`, `boolean`, `array` (of
  scalars) or `object` (one nesting level). Nullable unions such as
  `["number","null"]` are accepted. `format` can be `uri`, `date`,
  `date-time` or `email`. `description` feeds field matching, and
  `x-bxc-selector` (`css` or `css@attribute`) pins a field.
- Shorthand: `{ "title": "string", "price": "number?", "url": "uri", "tags": ["string"], "author": { "name": "string" } }`.
  Fields are required unless the type ends in `?`. Wrap the object in an
  array, `[ { ... } ]`, to get a record list. Accepted type names: `string`,
  `text`, `number`, `integer`/`int`, `boolean`/`bool`, `uri`/`url`, `date`,
  `date-time`/`datetime` and `email`, each optionally followed by `[]`.

Coercion (`src/extract/schema.ts`):

| Type | Examples |
| --- | --- |
| number | `€1 299,00` → 1299, `1.049,00 €` → 1049, `$12.50` → 12.5, `CHF 1'299.50`, `1,299.00`, `12,5`, `1.2k` → 1200, `-0.12%`, `Sold out` → null |
| integer | same parser; non-integers → null (`(2,431)` → 2431, `128 comments` → 128) |
| boolean | `In stock`/`Available`/`schema.org/InStock` → true; `Sold out`/`Out of stock`/`Unavailable`/`épuisé` → false |
| date / date-time | ISO-8601 (zone kept, zone-less = UTC), `<time datetime>`, unix seconds/ms, `Sep 17, 2026`, `17 septembre 2026`, `September 12th, 2026 10:30 PM`, `17/09/2026`, `3 hours ago` / `il y a 2 jours` (relative to `now`). A `/` date is month-first unless the first part is > 12 or `dayFirst` is set; `.` and `-` dates are day-first. |
| uri | resolved against the page URL. For `srcset` the largest candidate wins; `#`, `javascript:` and `data:` are dropped. |
| email | `mailto:` stripped, address extracted |

## Algorithm

1. **Native DOM snapshot** (`dom.ts`). The page is parsed once by the Rust
   bridge (`NativeDoc`). The bridge has no parent or child navigation, so the
   element tree is rebuilt from three queries: `*` (pre-order),
   `:first-child` and `:last-child`. A `:first-child` element is the first
   child of the previous element. Any other element is the next sibling of the
   nearest ancestor-or-self of the previous element that is not a
   `:last-child`. Text and attributes are read through node ids, with no
   re-parsing.
2. **Record groups** (`structure.ts`), for list schemas:
   - sibling sets with the same signature (tag, class tokens without
     modifiers, role), merged across parents with the same ancestor
     signature, so grids split into rows still group together. Outliers by
     child-tag Jaccard are dropped. A wrapper that holds one element each
     (`li > article`) also yields the inner group;
   - periodic sibling sequences, where one record spans several rows
     (`tr.athing + tr + tr.spacer`, `dt + dd`);
   - `<table>` data rows with header texts mapped to columns.
   Groups are ranked by `log2(count) · √textMass · (1 + diversity/4) ·
   (1 − 0.6·linkDensity) · region`. Groups inside nav, header, footer, aside
   or form elements, or under nav/menu/pagination classes, get ×0.35; groups
   under `main` get ×1.25. Each group gets a CSS selector checked with the
   native engine. The preference order is itemprop/itemtype, then data-testid
   and similar attributes, role, stable classes, parent-anchored `>` chains,
   and hashed classes last. `nth-*` is never used.
3. **Field matching** (`field-matcher.ts`, `lexicon.ts`). Candidate locators
   come from sampled records (up to 30):
   - relative CSS keys: itemprop, data keys, classes, `rel~=`, `[aria-label]`,
     `time[datetime]`, `id^=` prefixes, `a[href^=…]` prefixes, and
     parent-anchored `>` keys with `:first-child`/`:last-child`;
   - `label` locators (`dt`/`th`/`label` text → next sibling) that survive
     changing fact order;
   - `column` locators (cell index);
   - `self`.
   Each locator is tried with each value accessor (`text`, `href`, `src`,
   `srcset`, `data-src`, `content`, `datetime`, `value`, `title`,
   `aria-label`, `alt`, `data-*`) and scored as
   `coverage^0.7 · (0.15 + 0.55·lexical + 0.30·prior) · valueQuality · distinctiveness · specificity`:
   - *lexical*: property name and description tokens (camelCase, snake and
     kebab split, light stemming, synonym concepts such as price, title, url,
     image, date, author, rating, description, sku, brand, category,
     availability, reviews, comments, points, location, company, salary and
     tags) are compared with node hints. Hints come from itemprop, class, id,
     name, rel, aria-label, data keys, `dt`/`th` labels, table headers, short
     own text, href path tokens and ancestor hints. Nested leaves
     (`author.name`) are damped when nothing matches the parent name;
   - *prior*: how well the type, tag and accessor fit together. Examples:
     `uri` + `href` on a link inside a heading, image `src`, `datetime` for
     dates, heading text for titles;
   - *type/quality*: the coerced value must be non-null. Quality prefers
     absolute dates over relative ones, prices with a currency, non-numeric
     titles and non-truncated text;
   - *coverage* across records, and *distinctiveness* (the same value in every
     record is penalised, except for booleans).
   Leaves are assigned greedily by score, and two leaves never share the same
   value sequence. After assignment, a title that sits around a link switches
   to the link text, and truncated text (`A Light in the ...`) switches to a
   `title`, `aria-label` or `alt` attribute that holds the full value. The
   group with the best applied fit wins. Applied fit is locator confidence ×
   fill rate, lowered by dropped records and by one-record page wrappers.
4. **Single-object schemas** map JSON-LD, microdata, OpenGraph and meta first
   (`structured-data.ts`, stable paths such as
   `jsonld:Product:offers.price`). Remaining fields are matched inside the
   content region (`main`, `[role=main]`, `#main`, `#content`, a single
   `article`, otherwise `<body>`) with a stricter lexical threshold.
5. **Validation.** Records with no filled required leaf are dropped (ad slots,
   separators). `missingFields` lists leaves that have no confident locator
   or are filled in fewer than half of the records. `issues` lists schema
   violations.
6. **LLM fallback**, only for *required* leaves that are still missing and
   only when an `LlmFallback` is injected. The prompt holds the page's main
   text (native `extractMain`, truncated to 12,000 characters) and the missing
   field names. The JSON Schema covers the missing leaves only. Returned
   values are coerced and merged by record index. Library code never creates
   a network client. The CLI offers `--llm gemini` through the existing
   Gemini toolbox (cookie session).

## Selector cache

Plans are stored in the domain-memory SQLite file (`defaultDomainMemoryPath()`,
`$BXC_DOMAIN_MEMORY_PATH`) in their own table:

```sql
extract_selectors(etld1, schema_hash, record_selector, fields_json, successes, failures, updated_at,
                  PRIMARY KEY (etld1, schema_hash))
```

- The key is the registrable domain of the page URL (`www.shop.example` and
  `m.shop.example` share one entry) plus a hash of the normalized schema.
  `file:` pages and pages without a URL are never cached.
- On a hit, the cached plan runs directly. If the required-leaf fill rate
  stays at or above `relearnThreshold` (default 0.6), the result has
  `source: "cache"` and `successes` goes up. Otherwise `failures` goes up,
  the plan is re-learned, and the new plan replaces the old one (counters
  reset).
- A freshly learned plan is stored only when its fill rate reaches the
  threshold.
- `--no-cache` skips the cache and `--cache-path` picks another file.

## Measured fixture scores

The offline fixtures live in `test/fixtures/extract/` (`<name>.html` plus
`<name>.expected.json`) and are checked by `test/extract/extract.test.ts`.
Precision and recall are counted per field over all records, matched by
position. A value counts as correct only when it equals the gold value after
coercion.

| Fixture | What it exercises | Records | Precision | Recall | Source |
| --- | --- | --- | --- | --- | --- |
| shop-listing | product cards: `€1 299,00`, `$12.50`, `1.049,00 €`, `Sold out`, old prices, ad slot, nav/filter/footer lists | 8 | 1.000 | 1.000 | learned |
| shop-listing-page2 | same template, other products (cache hit in the cache test) | 6 | 1.000 | 1.000 | learned / cache |
| shop-redesign | same site, new markup (`div[role=listitem]`, renamed classes): re-learn path | 6 | 1.000 | 1.000 | learned |
| news-list | articles with `<time datetime>`, `By` bylines, kickers, "most read" sidebar | 7 | 1.000 | 1.000 | learned |
| hn-table | HN-like 3-row records (`tr.athing` + subtext + spacer), `title` attribute timestamps, `discuss` | 7 | 1.000 | 1.000 | learned |
| jobs-dl | job cards with `<dl>` facts in varying order, missing salaries, facets `<dl>` distractor | 6 | 1.000 | 1.000 | learned |
| product-detail | JSON-LD Product (offers, brand, aggregateRating), related-products distractor | 1 | 1.000 | 1.000 | structured-data |
| blog-index | nested author blocks (`author.name/url/avatar`), tag arrays, tag cloud distractor | 5 | 1.000 | 1.000 | learned |
| hashed-classes | CSS-in-JS classes (`css-4hd82k`) only: role, aria-label and types carry the signal | 6 | 1.000 | 1.000 | learned |
| rates-table | `<table>` with header mapping, signed percentages, `17/09/2026 10:00` | 5 | 1.000 | 1.000 | learned |
| **overall** | 378 gold field values | 57 | **1.000** | **1.000** | |

Other checks:
- Product detail with JSON-LD and meta tags removed: DOM matching recovers
  name, brand, price, availability, rating, review count and image. `sku`
  keeps its label (`Item no. TR3-GTX-M-42`) and currency is reported missing.
- Live spot checks, run by hand and not in CI:
  - `news.ycombinator.com`: 30/30 records with all 8 fields.
  - `books.toscrape.com`: 20/20 records, full titles taken from `title`
    attributes.
  - `quotes.toscrape.com`: 10/10 records, tags array included, record
    selector `div[itemtype="http://schema.org/CreativeWork"]`.

## Known limitations

- The fixtures were written together with the heuristics. Treat the 1.000
  scores as regression guards, not as a benchmark of unseen sites. The
  `docs/research/web/apps/bxc/benchmarks` (not in repo) extraction F1 gold set is still to do.
- Pages rendered by client-side JavaScript need a rendering profile
  (`--profile stealth` or the render tier) before extraction. The `http`
  profile only sees server HTML.
- Records are aligned to the page by DOM grouping. Lists with no repeated
  structure at all (free-form prose) resolve only through the LLM fallback.
- Nesting stops at one level, and arrays of objects inside a record are not
  supported.
- Labels are not stripped from values (`Item no. X`), except for the
  `By`/`Par` prefixes on author-like fields.
- Relative dates depend on `now`. Ambiguous numeric dates with `/` default to
  month-first.
- The native selector engine does not support `:has()`, and `nth-*`
  pseudo-classes are unreliable. Generated selectors avoid both.
- Cached plans are keyed by schema hash, so any schema change re-learns.
