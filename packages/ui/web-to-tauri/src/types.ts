// SPDX-License-Identifier: Apache-2.0

/** Schema of `src-tauri/wrap.json`, shared with the Rust runtime crate `aphrody-tauri-wrap`. */
export const WRAP_SCHEMA = "aphrody-web-to-tauri/1" as const;

/**
 * - `remote`: the webview loads the deployed origin. Page, API and backend are untouched.
 * - `bundle`: a built static bundle is served from loopback; backend routes are proxied.
 * - `sidecar`: the app's own server runs as a child process, the webview loads it from loopback.
 */
export type WrapMode = "remote" | "bundle" | "sidecar";

/** `wry` is the system webview; `cef` is Chromium (for pages that need Chromium-only APIs). */
export type WrapEngine = "wry" | "cef";

/** What happens to a navigation that leaves the app: system browser, same window, or blocked. */
export type ExternalLinks = "system" | "inapp" | "deny";

export interface WrapOrigins {
  /** URL patterns that stay in the app window (`https://example.com`, `https://*.example.com/app/*`). */
  app: string[];
  /** Identity providers and payment pages: allowed in-app, including popups with an opener. */
  auth: string[];
  /**
   * Third-party frames (video, maps, captcha): allowed in-app. WebKitGTK and WKWebView send iframe
   * loads through the same navigation hook as the top-level page, so a frame that is not listed
   * here would be treated as a link that leaves the app.
   */
  embeds: string[];
  external: ExternalLinks;
}

export interface WrapWindow {
  /** `null` follows `document.title`, like a browser tab. */
  title: string | null;
  width: number;
  height: number;
  minWidth: number | null;
  minHeight: number | null;
  /** Mirror `document.title` into the window title. */
  syncTitle: boolean;
  /** Ctrl/Cmd +, -, 0 zoom shortcuts of a browser. */
  zoomHotkeys: boolean;
  /** Native drag and drop. Off keeps HTML5 drag and drop (file drop zones, kanban boards). */
  dragDrop: boolean;
}

export interface WrapBundle {
  /** Directory of the built bundle, relative to `src-tauri`. */
  dir: string;
  /** Origin that receives proxied requests (`https://api.example.com`), or `null`. */
  backend: string | null;
  /** Path prefixes forwarded to the backend (`/api`, `/graphql`). */
  proxy: string[];
  /** Unknown paths that accept `text/html` answer with `index.html` (single-page apps). */
  spaFallback: boolean;
}

export interface WrapSidecar {
  /** Executable next to the app binary (`bundle.externalBin`). */
  program: string;
  args: string[];
  /** `0` asks the OS for a port and passes it as `PORT`. A fixed port keeps registered OAuth callbacks valid. */
  port: number;
  readyPath: string;
  readyTimeoutSecs: number;
  env: Record<string, string>;
}

export interface WrapConfig {
  schema: typeof WRAP_SCHEMA;
  name: string;
  identifier: string;
  mode: WrapMode;
  engine: WrapEngine;
  /** `remote`: the absolute URL to load. `bundle`/`sidecar`: a path appended to the loopback origin. */
  start: string;
  origins: WrapOrigins;
  window: WrapWindow;
  /** `null` keeps the webview user agent. */
  userAgent: string | null;
  bundle: WrapBundle | null;
  sidecar: WrapSidecar | null;
}

export interface CookieInfo {
  name: string;
  domain: string | null;
  path: string | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "strict" | "lax" | "none" | null;
  partitioned: boolean;
  /** `__Host-` and `__Secure-` prefixes require `Secure`; they cannot be served over plain loopback. */
  prefixed: boolean;
}

export interface RedirectHop {
  url: string;
  status: number;
  location: string | null;
}

export interface IconRef {
  href: string;
  rel: string;
  sizes: string | null;
  type: string | null;
}

export interface ManifestInfo {
  url: string;
  name: string | null;
  shortName: string | null;
  startUrl: string | null;
  scope: string | null;
  display: string | null;
  themeColor: string | null;
  backgroundColor: string | null;
  icons: IconRef[];
  hasShareTarget: boolean;
  hasProtocolHandlers: boolean;
}

export interface ApiSignal {
  id: string;
  /** Where the evidence was found (page URL or script URL). */
  where: string;
}

export interface SiteProbe {
  kind: "site";
  input: string;
  finalUrl: string;
  status: number;
  redirects: RedirectHop[];
  headers: Record<string, string>;
  cookies: CookieInfo[];
  title: string | null;
  lang: string | null;
  description: string | null;
  themeColor: string | null;
  icons: IconRef[];
  manifest: ManifestInfo | null;
  frameworks: string[];
  /** Origins referenced by the page, its scripts and its redirects (`scheme://host[:port]`). */
  origins: string[];
  /** Origins of the redirect chain, always kept in the app. */
  redirectOrigins: string[];
  idps: { id: string; kind: "idp" | "payment"; origin: string }[];
  signals: ApiSignal[];
  /** Same-origin links of the start page, used as parity paths. */
  links: string[];
  /** Other origins that a `<form action>` of the start page posts to. */
  formOrigins: string[];
  /** Origins of the `<iframe src>` of the start page. */
  frameOrigins: string[];
  /** Embed providers (video, maps, captcha) referenced by the page or its scripts. */
  embeds: { id: string; origin: string }[];
  popupLinks: number;
  scriptsScanned: number;
  warnings: string[];
}

export interface DirectoryProbe {
  kind: "directory";
  input: string;
  name: string | null;
  frameworks: string[];
  /** Directory holding a built bundle with an `index.html`, relative to `input`. */
  staticDir: string | null;
  /** `.html` files of the bundle; more than one means pre-rendered routes, not a single-page app. */
  htmlPages: number;
  /** Server entry that can run as a sidecar, relative to `input`. */
  serverEntry: string | null;
  /** `next.config` `output` value. */
  nextOutput: "export" | "standalone" | null;
  apiRoutes: number;
  /** Backend origins found in `.env*` files (values that are plain URLs only). */
  backends: string[];
  /** Path prefixes the bundle fetches (`/api`, `/graphql`). */
  proxyPrefixes: string[];
  signals: ApiSignal[];
  warnings: string[];
}

export type Probe = SiteProbe | DirectoryProbe;

export type RiskSeverity = "blocker" | "high" | "medium" | "low";
export type RiskArea = "ui" | "api" | "backend" | "auth" | "platform";

/**
 * - `applied`: handled by the generated project.
 * - `flag`: handled once the named option is set.
 * - `manual`: nothing in the generator can remove it; a person has to decide.
 */
export interface Risk {
  id: string;
  severity: RiskSeverity;
  area: RiskArea;
  summary: string;
  mitigation: { kind: "applied" | "flag" | "manual"; detail: string };
}

export interface ConversionPlan {
  schema: "aphrody-web-to-tauri.plan/1";
  config: WrapConfig;
  reasons: string[];
  risks: Risk[];
  /** `faithful`: no blocker and no unmitigated high risk. `needs-review`: a person has to look. */
  verdict: "faithful" | "needs-review";
  /** Paths compared against the original by `parity`. */
  parityPaths: string[];
  probe: Probe;
}

export interface PlanOptions {
  name?: string;
  identifier?: string;
  mode?: WrapMode | "auto";
  engine?: WrapEngine | "auto";
  /** Extra URL patterns kept in the app. */
  allowOrigins?: string[];
  external?: ExternalLinks;
  userAgent?: string | null;
  /** Backend origin of a bundle. */
  backend?: string;
  /** Port of the sidecar; fixed ports keep OAuth callbacks valid. */
  port?: number;
  maxParityPaths?: number;
}
