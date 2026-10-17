// SPDX-License-Identifier: Apache-2.0
/** Pure detectors over HTML, script text and headers. No I/O. */
import { matchesPattern, stripPath } from "./policy.ts";
import type { CookieInfo } from "./types.ts";

export interface ApiRule {
  id: string;
  re: RegExp;
  /** The API exists in Chromium but not (everywhere) in the system webviews. */
  chromiumOnly?: boolean;
}

export const API_RULES: ApiRule[] = [
  { id: "service-worker", re: /navigator\s*\.\s*serviceWorker\b/ },
  { id: "websocket", re: /\bnew\s+WebSocket\s*\(/ },
  { id: "event-source", re: /\bnew\s+EventSource\s*\(/ },
  { id: "webrtc", re: /\bRTCPeerConnection\b/ },
  {
    id: "media-devices",
    re: /navigator\s*\.\s*mediaDevices\b|\bgetUserMedia\b/,
  },
  { id: "geolocation", re: /navigator\s*\.\s*geolocation\b/ },
  {
    id: "notifications",
    re: /\bNotification\s*\.\s*requestPermission\b|\bnew\s+Notification\s*\(/,
  },
  {
    id: "webauthn",
    re: /navigator\s*\.\s*credentials\s*\.\s*(?:create|get)\b|\bPublicKeyCredential\b/,
  },
  { id: "shared-array-buffer", re: /\bSharedArrayBuffer\b/ },
  { id: "payment-request", re: /\bnew\s+PaymentRequest\s*\(/ },
  { id: "window-open", re: /\bwindow\s*\.\s*open\s*\(/ },
  { id: "print", re: /\bwindow\s*\.\s*print\s*\(/ },
  { id: "fullscreen", re: /\brequestFullscreen\b|\bwebkitRequestFullscreen\b/ },
  { id: "clipboard", re: /navigator\s*\.\s*clipboard\b/ },
  {
    id: "user-agent-sniffing",
    re: /navigator\s*\.\s*userAgent[^;\n]{0,80}(?:Chrome|Safari|Firefox|Edg|WebKit|Electron)|(?:Chrome|Safari|Firefox|Edg|Electron)[^;\n]{0,40}\.test\(\s*navigator\s*\.\s*userAgent/,
  },
  {
    id: "file-system-access",
    re: /\bshow(?:Open|Save)FilePicker\b|\bshowDirectoryPicker\b/,
    chromiumOnly: true,
  },
  { id: "web-usb", re: /navigator\s*\.\s*usb\b/, chromiumOnly: true },
  { id: "web-serial", re: /navigator\s*\.\s*serial\b/, chromiumOnly: true },
  {
    id: "web-bluetooth",
    re: /navigator\s*\.\s*bluetooth\b/,
    chromiumOnly: true,
  },
  { id: "web-hid", re: /navigator\s*\.\s*hid\b/, chromiumOnly: true },
  { id: "webgpu", re: /navigator\s*\.\s*gpu\b/, chromiumOnly: true },
  { id: "eye-dropper", re: /\bnew\s+EyeDropper\b/, chromiumOnly: true },
  {
    id: "speech-recognition",
    re: /\bwebkitSpeechRecognition\b|\bnew\s+SpeechRecognition\b/,
    chromiumOnly: true,
  },
];

/** API ids found in `text`, in rule order. */
export function detectApis(text: string): string[] {
  return API_RULES.filter(rule => rule.re.test(text)).map(rule => rule.id);
}

export function isChromiumOnly(id: string): boolean {
  return API_RULES.some(rule => rule.id === id && rule.chromiumOnly);
}

interface FrameworkRule {
  id: string;
  html?: RegExp;
  headers?: RegExp;
  scripts?: RegExp;
}

const FRAMEWORKS: FrameworkRule[] = [
  {
    id: "next",
    html: /__NEXT_DATA__|\/_next\/static\//,
    headers: /x-powered-by:\s*next\.js/i,
  },
  { id: "nuxt", html: /__NUXT__|\/_nuxt\// },
  { id: "sveltekit", html: /__sveltekit|\/_app\/immutable\// },
  { id: "remix", html: /__remixContext|__remix/ },
  { id: "astro", html: /astro-island|<meta name="generator" content="Astro/i },
  { id: "gatsby", html: /___gatsby|\/page-data\// },
  { id: "angular", html: /\bng-version=/ },
  {
    id: "vue",
    html: /\bdata-v-[0-9a-f]{6,}|__vue_app__|\bdata-server-rendered=/,
  },
  { id: "react", html: /data-reactroot|\bid="root"|\bid="__next"/ },
  {
    id: "vite",
    html: /\/@vite\/client|type="module"[^>]+\/assets\/index-[\w-]+\.js/,
  },
  { id: "wordpress", html: /\/wp-content\/|\/wp-includes\// },
  { id: "shopify", html: /cdn\.shopify\.com|Shopify\.theme/ },
  { id: "wix", html: /static\.parastorage\.com|wixstatic\.com/ },
  { id: "squarespace", html: /static1\.squarespace\.com|squarespace-cdn/ },
  {
    id: "webflow",
    html: /data-wf-page|assets\.website-files\.com|webflow\.js/,
  },
  { id: "ghost", html: /<meta name="generator" content="Ghost/i },
  { id: "phoenix-liveview", html: /data-phx-main|phx-socket/ },
  { id: "htmx", html: /\bhx-(?:get|post|boost)=/ },
];

export function detectFrameworks(html: string, rawHeaders: string, scripts = ""): string[] {
  const out: string[] = [];
  for (const rule of FRAMEWORKS) {
    if (
      (rule.html && rule.html.test(html)) ||
      (rule.headers && rule.headers.test(rawHeaders)) ||
      (rule.scripts && rule.scripts.test(scripts))
    ) {
      out.push(rule.id);
    }
  }
  return out;
}

export interface IdpRule {
  id: string;
  kind: "idp" | "payment";
  patterns: string[];
}

/** Sign-in and payment pages that must keep working in a popup or redirect with an opener. */
export const IDP_RULES: IdpRule[] = [
  {
    id: "google",
    kind: "idp",
    patterns: ["https://accounts.google.com", "https://accounts.youtube.com"],
  },
  {
    id: "apple",
    kind: "idp",
    patterns: ["https://appleid.apple.com", "https://idmsa.apple.com"],
  },
  {
    id: "microsoft",
    kind: "idp",
    patterns: ["https://login.microsoftonline.com", "https://login.live.com", "https://*.b2clogin.com"],
  },
  {
    id: "github",
    kind: "idp",
    patterns: ["https://github.com/login/*", "https://github.com/sessions/*"],
  },
  {
    id: "gitlab",
    kind: "idp",
    patterns: ["https://gitlab.com/oauth/*", "https://gitlab.com/users/*"],
  },
  {
    id: "facebook",
    kind: "idp",
    patterns: ["https://www.facebook.com/*/dialog/*", "https://m.facebook.com/*/dialog/*"],
  },
  {
    id: "discord",
    kind: "idp",
    patterns: ["https://discord.com/oauth2/*", "https://discord.com/api/oauth2/*"],
  },
  {
    id: "x",
    kind: "idp",
    patterns: ["https://x.com/i/oauth2/*", "https://api.twitter.com/oauth/*"],
  },
  {
    id: "linkedin",
    kind: "idp",
    patterns: ["https://www.linkedin.com/oauth/*"],
  },
  {
    id: "slack",
    kind: "idp",
    patterns: ["https://slack.com/oauth/*", "https://*.slack.com/openid/*"],
  },
  { id: "auth0", kind: "idp", patterns: ["https://*.auth0.com"] },
  {
    id: "okta",
    kind: "idp",
    patterns: ["https://*.okta.com", "https://*.oktapreview.com"],
  },
  { id: "cognito", kind: "idp", patterns: ["https://*.amazoncognito.com"] },
  {
    id: "firebase-auth",
    kind: "idp",
    patterns: ["https://*.firebaseapp.com/__/auth/*"],
  },
  {
    id: "stripe",
    kind: "payment",
    patterns: ["https://checkout.stripe.com", "https://*.stripe.com/*/checkout/*"],
  },
  {
    id: "paypal",
    kind: "payment",
    patterns: ["https://www.paypal.com/checkoutnow*", "https://*.paypal.com/webapps/*"],
  },
];

/** Providers of third-party frames: they load inside the page and must not be treated as links that leave the app. */
export const EMBED_RULES: { id: string; patterns: string[] }[] = [
  {
    id: "youtube",
    patterns: ["https://www.youtube.com", "https://www.youtube-nocookie.com", "https://youtube.com"],
  },
  { id: "vimeo", patterns: ["https://player.vimeo.com"] },
  {
    id: "google-maps",
    patterns: ["https://www.google.com/maps/*", "https://maps.google.com"],
  },
  {
    id: "recaptcha",
    patterns: ["https://www.google.com/recaptcha/*", "https://www.recaptcha.net"],
  },
  { id: "hcaptcha", patterns: ["https://*.hcaptcha.com"] },
  { id: "turnstile", patterns: ["https://challenges.cloudflare.com"] },
  {
    id: "stripe-js",
    patterns: ["https://js.stripe.com", "https://hooks.stripe.com"],
  },
  { id: "spotify", patterns: ["https://open.spotify.com"] },
  { id: "soundcloud", patterns: ["https://w.soundcloud.com"] },
  {
    id: "twitter-embed",
    patterns: ["https://platform.twitter.com", "https://platform.x.com"],
  },
  { id: "calendly", patterns: ["https://calendly.com"] },
  { id: "typeform", patterns: ["https://*.typeform.com"] },
];

/** Embed providers that a page loads: `urls` are `<iframe src>` and script URLs, never links. */
export function detectEmbeds(urls: Iterable<string>): { id: string; origin: string; patterns: string[] }[] {
  const found = new Map<string, { id: string; origin: string; patterns: string[] }>();
  for (const text of urls) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      continue;
    }
    for (const rule of EMBED_RULES) {
      const hit = rule.patterns.some(pattern => {
        const host = stripPath(pattern);
        return host !== null && matchesPattern(host, url);
      });
      if (hit && !found.has(rule.id))
        found.set(rule.id, {
          id: rule.id,
          origin: url.origin,
          patterns: rule.patterns,
        });
    }
  }
  return [...found.values()];
}

/**
 * Providers whose sign-in or payment pages the page links to or loads. `urls` are full URLs: a
 * path-scoped provider (`github.com/login/*`) only counts when the page really points at that path,
 * so a footer link to github.com is not mistaken for GitHub sign-in.
 */
export function detectIdps(urls: Iterable<string>): {
  id: string;
  kind: "idp" | "payment";
  origin: string;
  patterns: string[];
}[] {
  const found = new Map<string, { id: string; kind: "idp" | "payment"; origin: string; patterns: string[] }>();
  for (const text of urls) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      continue;
    }
    for (const rule of IDP_RULES) {
      if (rule.patterns.some(pattern => matchesPattern(pattern, url)) && !found.has(rule.id)) {
        found.set(rule.id, {
          id: rule.id,
          kind: rule.kind,
          origin: url.origin,
          patterns: rule.patterns,
        });
      }
    }
  }
  return [...found.values()];
}

const URL_RE =
  /\b(?:https?|wss?):\/\/(?:[a-z0-9.-]+\.[a-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?(?:[/?#][^\s"'`<>\\)]*)?/gi;

/** Every absolute http(s) or ws(s) URL in `text`, with `ws` mapped to `http`. */
export function extractUrls(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(URL_RE)) {
    out.add(match[0].replace(/^ws(s?):/i, "http$1:").replace(/[.,;:]+$/, ""));
  }
  return [...out];
}

/** `scheme://host[:port]` of every absolute http(s) or ws(s) URL in `text`. */
export function extractOrigins(text: string): string[] {
  const out = new Set<string>();
  for (const text_ of extractUrls(text)) {
    try {
      out.add(new URL(text_).origin);
    } catch {
      // not a URL
    }
  }
  return [...out];
}

/** Parses the `Set-Cookie` header values of a response. */
export function parseSetCookies(values: string[]): CookieInfo[] {
  return values.map(raw => {
    const [pair = "", ...attrs] = raw.split(";").map(part => part.trim());
    const name = pair.split("=")[0] ?? "";
    const lower = new Set(attrs.map(attr => attr.toLowerCase()));
    const attr = (key: string) => attrs.find(entry => entry.toLowerCase().startsWith(`${key}=`))?.split("=")[1] ?? null;
    const sameSite = attr("samesite")?.toLowerCase() ?? null;
    return {
      name,
      domain: attr("domain"),
      path: attr("path"),
      secure: lower.has("secure"),
      httpOnly: lower.has("httponly"),
      sameSite: sameSite === "strict" || sameSite === "lax" || sameSite === "none" ? sameSite : null,
      partitioned: lower.has("partitioned"),
      prefixed: /^__(?:host|secure)-/i.test(name),
    };
  });
}

/** Path prefixes of backend routes referenced by built JavaScript (`/api`, `/graphql`...). */
export function detectProxyPrefixes(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(
    /["'`](\/(?:api|graphql|trpc|rest|_api|auth|oauth|rpc|v\d+|socket\.io)(?=[/"'`?]))/g,
  )) {
    out.add(match[1]!);
  }
  return [...out].toSorted();
}
