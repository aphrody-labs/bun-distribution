// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { publicCdnFallback, renderPublicCdnGateway } from "./shenron-public-cdn-gateway";

test("preserves API/site/TLS blocks and replaces both legacy fallback owners", () => {
  const api = "location /api/ { proxy_pass http://site; }";
  const source = `server { ${api}\n# location @cdn_worker { example only; }\nlocation @cdn_worker { if ($uri ~ "x{2}") { return 404; } proxy_pass https://old; }\nlocation @cdn_public_origin { proxy_pass http://wrong-host; }\nssl_certificate /cert.pem; }`;
  const result = renderPublicCdnGateway(source, "http://127.0.0.1:9077");
  expect(result).toContain(api);
  expect(result).toContain("# location @cdn_worker { example only; }");
  expect(result).toContain("ssl_certificate /cert.pem;");
  expect(result).not.toContain("https://old");
  expect(result).not.toContain("wrong-host");
  expect(result.match(/proxy_pass http:\/\/127.0.0.1:9077/g)).toHaveLength(2);
  expect(renderPublicCdnGateway(result, "http://127.0.0.1:9077")).toBe(result);
});

test("public fallback strips inbound authentication and preserves range conditions", () => {
  const result = publicCdnFallback("@cdn_worker", "http://127.0.0.1:9077");
  for (const expected of [
    "GET|HEAD",
    "proxy_pass_request_headers off",
    "proxy_pass_request_body off",
    "_objects",
    "private",
    "proxy_set_header Range $http_range",
    "proxy_set_header If-Range $http_if_range",
    "proxy_intercept_errors off",
    "proxy_cache off",
    "wiki|dbz|adn|media",
    "Accept-Encoding identity",
  ])
    expect(result).toContain(expected);
  expect(result).not.toContain("$http_cookie");
  expect(result).not.toContain("$http_authorization");
  expect(() => publicCdnFallback("@cdn_worker", "http://10.200.77.1")).toThrow();
  expect(() => renderPublicCdnGateway("server {}", "http://127.0.0.1:9077")).toThrow();
});

test("public fallback admits catalog video and audio paths without broadening private routes", () => {
  const result = publicCdnFallback("@cdn_public_origin", "http://127.0.0.1:9077");
  const expression = result.match(/if \(\$uri !~\* "([^"]+)"\)/)?.[1];
  expect(expression).toBeDefined();
  const allowed = new RegExp(expression!, "i");
  for (const path of [
    "/assets/wiki/bardock.web.mp4",
    "/wiki/vegetagokukaioken.web.mp4",
    "/sfx/official/nimbus.mp3",
    "/media/episodes/beerus-01/optimized-720p.mp4",
    "/wiki/chapter/cover.webp",
  ])
    expect(allowed.test(path)).toBe(true);
  for (const path of [
    "/private/cookies.mp3",
    "/sfx/private.env",
    "/wiki/hidden.sqlite",
    "/api/public/video.mp4",
    "/sfx/official/nimbus.mp3/secret",
  ])
    expect(allowed.test(path)).toBe(false);
  expect(result).toContain("proxy_set_header Range $http_range");
  expect(result).toContain("proxy_set_header If-Range $http_if_range");
});
