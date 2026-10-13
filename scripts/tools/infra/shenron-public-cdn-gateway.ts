// SPDX-License-Identifier: Apache-2.0
/** Render a sealed-release candidate; Infra activation remains the sole host writer. */
export function publicCdnFallback(name: string, upstream: string): string {
  if (!/^@cdn_(?:worker|public_origin)$/.test(name)) throw Error("Unknown CDN fallback");
  if (
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(upstream) ||
    Number(new URL(upstream).port) > 65535
  )
    throw Error("Qualified loopback upstream required");
  return `location ${name} {
  if ($request_method !~ "^(GET|HEAD)$") { return 405; }
  if ($uri !~* "^/(?:assets/|wiki/.+\\.(?:avif|gif|jpe?g|png|svg|webp)$)") { return 404; }
  if ($uri ~* "(?:^|/)(?:api|_objects|_migration|private|manifests|cookies|node_modules)(?:/|$)") { return 404; }
  if ($uri ~* "\\.(?:sql|sqlite|db|env|jsonl|pem|key|toml|ya?ml|ini|log|bak)$") { return 404; }
  proxy_pass ${upstream};
  proxy_http_version 1.1;
  proxy_cache off;
  proxy_pass_request_headers off;
  proxy_pass_request_body off;
  proxy_set_header Host $host;
  proxy_set_header Content-Length "";
  proxy_set_header Connection "";
  proxy_set_header Accept $http_accept;
  proxy_set_header Accept-Encoding identity;
  proxy_set_header Range $http_range;
  proxy_set_header If-Range $http_if_range;
  proxy_set_header If-None-Match $http_if_none_match;
  proxy_set_header If-Modified-Since $http_if_modified_since;
  proxy_connect_timeout 5s;
  proxy_read_timeout 60s;
  proxy_intercept_errors off;
}`;
}

function closingBrace(source: string, start: number): number {
  let depth = 1,
    quote = "",
    comment = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i]!;
    if (comment) {
      if (c === "\n") comment = false;
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "#") {
      comment = true;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return i;
  }
  throw Error("Unclosed CDN fallback block");
}

/** Replace only named CDN fallback blocks; preserve site/API/TLS routing verbatim. */
export function renderPublicCdnGateway(source: string, upstream: string): string {
  const pattern = /^[ \t]*location\s+(@cdn_(?:worker|public_origin))\s*\{/gm;
  let result = "",
    previous = 0,
    count = 0;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const end = closingBrace(source, pattern.lastIndex);
    result += source.slice(previous, match.index) + publicCdnFallback(match[1]!, upstream);
    previous = end + 1;
    pattern.lastIndex = previous;
    count++;
  }
  if (!count) throw Error("No owned CDN fallback blocks found");
  return result + source.slice(previous);
}

if (import.meta.main) {
  const [source, destination, upstream] = process.argv.slice(2);
  if (!source || !destination || !upstream || source === destination)
    throw Error("Expected distinct SOURCE CANDIDATE and qualified LOOPBACK_UPSTREAM");
  const input = await Bun.file(source).text();
  const output = renderPublicCdnGateway(input, upstream);
  await Bun.write(destination, output);
  console.log(
    JSON.stringify({
      source,
      destination,
      upstream,
      inputSha256: new Bun.CryptoHasher("sha256").update(input).digest("hex"),
      candidateSha256: new Bun.CryptoHasher("sha256").update(output).digest("hex"),
    }),
  );
}
