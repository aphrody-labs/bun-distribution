// SPDX-License-Identifier: Apache-2.0
/** Reuse the existing owned-host rule; never introduce another host registry. */
export function nativeMediaCacheRule(ownedHostExpression: string) {
  if (
    !ownedHostExpression.startsWith("(http.host ") ||
    !ownedHostExpression.endsWith(")") ||
    ownedHostExpression.length > 512 ||
    /[\r\n]/.test(ownedHostExpression)
  )
    throw Error("Bounded canonical host expression required");
  const prefixes = ["/assets/", "/wiki/", "/sfx/"];
  const extensions = [".mp4", ".webm", ".mp3", ".m4a", ".ogg", ".wav"];
  const paths = prefixes
    .map((value) => `starts_with(http.request.uri.path, "${value}")`)
    .join(" or ");
  const media = extensions
    .map((value) => `ends_with(http.request.uri.path, "${value}")`)
    .join(" or ");
  return {
    ref: "aphrody-native-media-range",
    description:
      "Public native media: preserve uncached ranges and validators while full streams lack fixed lengths",
    expression: `${ownedHostExpression} and (${paths}) and (${media})`,
    enabled: true,
    action: "set_cache_settings",
    action_parameters: { cache: false, origin_range_requests: { mode: "off" } },
  };
}

if (import.meta.main) console.log(JSON.stringify(nativeMediaCacheRule(Bun.argv[2] ?? "")));
