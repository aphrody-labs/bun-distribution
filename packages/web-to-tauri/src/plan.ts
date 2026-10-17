// SPDX-License-Identifier: Apache-2.0
/**
 * Turns a probe into a conversion plan: the wrap configuration, the reasons behind it and the
 * regression risks that remain. The default is the mode that changes nothing for the page, its API
 * and its backend (`remote`); the others are chosen only when the input is a directory.
 */
import { tauriIdentifier } from "@aphrody/scaffold";
import { originOf, parsePattern } from "./policy.ts";
import { EMBED_RULES, IDP_RULES, isChromiumOnly } from "./signals.ts";
import {
  WRAP_SCHEMA,
  type ConversionPlan,
  type DirectoryProbe,
  type PlanOptions,
  type Probe,
  type Risk,
  type SiteProbe,
  type WrapConfig,
  type WrapEngine,
  type WrapMode,
} from "./types.ts";

/** Identifier prefix of converted apps; the segment is derived from the host or name. */
export const WRAPPED_ID_PREFIX = "io.aphrody.wrapped";

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

/** Second-level public suffixes that must not become a `*.` wildcard. Not a full suffix list. */
const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "me.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.jp",
  "ne.jp",
  "or.jp",
  "co.in",
  "com.br",
  "com.cn",
  "com.mx",
  "com.tr",
  "com.ar",
  "co.za",
  "com.sg",
  "com.hk",
  "co.kr",
  "co.il",
  "github.io",
  "gitlab.io",
  "pages.dev",
  "vercel.app",
  "netlify.app",
  "herokuapp.com",
  "web.app",
  "firebaseapp.com",
  "azurewebsites.net",
  "cloudfront.net",
  "s3.amazonaws.com",
]);

/** Registrable domain of a host (`app.example.co.uk` -> `example.co.uk`); IPs and `localhost` map to themselves. */
export function registrableDomain(host: string): string {
  const lower = host.toLowerCase();
  if (lower === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(lower) || lower.includes(":")) return lower;
  const labels = lower.split(".");
  if (labels.length <= 2) return lower;
  const tail2 = labels.slice(-2).join(".");
  if (MULTI_LABEL_SUFFIXES.has(tail2)) return labels.slice(-3).join(".");
  return tail2;
}

function siteApp(probe: SiteProbe, extra: string[]): string[] {
  const out = new Set<string>();
  const finalOrigin = new URL(probe.finalUrl);
  const registrable = registrableDomain(finalOrigin.hostname);
  const scheme = finalOrigin.protocol.replace(":", "");
  const wildcardable = registrable !== "localhost" && !/^\d/.test(registrable) && registrable.includes(".");
  for (const origin of probe.redirectOrigins) out.add(origin);
  out.add(finalOrigin.origin);
  const input = originOf(probe.input.includes("://") ? probe.input : `https://${probe.input}`);
  if (input) out.add(input);
  if (wildcardable) {
    // Cookies are shared across the registrable domain; so is the app.
    out.add(`${scheme}://${registrable}`);
    out.add(`${scheme}://*.${registrable}`);
  }
  for (const pattern of extra) out.add(pattern);
  return [...out];
}

function authPatterns(probe: SiteProbe): string[] {
  const out = new Set<string>();
  for (const found of probe.idps) {
    const rule = IDP_RULES.find(candidate => candidate.id === found.id);
    for (const pattern of rule?.patterns ?? []) out.add(pattern);
  }
  return [...out];
}

function embedPatterns(probe: SiteProbe): string[] {
  const out = new Set<string>(probe.frameOrigins);
  for (const found of probe.embeds) {
    const rule = EMBED_RULES.find(candidate => candidate.id === found.id);
    for (const pattern of rule?.patterns ?? []) out.add(pattern);
  }
  return [...out];
}

function chromiumApis(probe: Probe): string[] {
  return probe.signals.filter(signal => isChromiumOnly(signal.id)).map(signal => signal.id);
}

function hasSignal(probe: Probe, id: string): boolean {
  return probe.signals.some(signal => signal.id === id);
}

function chooseMode(probe: Probe, requested: WrapMode | "auto", reasons: string[]): WrapMode {
  if (probe.kind === "site") {
    if (requested !== "auto" && requested !== "remote") {
      throw new PlanError(
        `a URL can only be wrapped in remote mode, not ${requested}; pass the project directory for bundle or sidecar`,
      );
    }
    reasons.push(
      "remote: the webview loads the deployed origin, so the page, its API calls and its backend are exactly the ones that run today",
    );
    return "remote";
  }
  if (requested === "remote") {
    throw new PlanError("remote mode needs a URL, not a directory");
  }
  const { staticDir, serverEntry } = probe;
  if (requested === "bundle") {
    if (!staticDir) throw new PlanError(`no built bundle with an index.html in ${probe.input}; build it first`);
    reasons.push("bundle: requested; the static bundle is served from loopback");
    return "bundle";
  }
  if (requested === "sidecar") {
    if (!serverEntry) throw new PlanError(`no server entry found in ${probe.input}`);
    reasons.push(`sidecar: requested; ${serverEntry} runs next to the app`);
    return "sidecar";
  }
  if (serverEntry && (probe.apiRoutes > 0 || probe.nextOutput === "standalone" || !staticDir)) {
    reasons.push(
      `sidecar: ${serverEntry} serves the app and its API routes (${probe.apiRoutes}); a static bundle would lose them`,
    );
    return "sidecar";
  }
  if (staticDir) {
    reasons.push(`bundle: ${staticDir}/ is a built static bundle with no server of its own`);
    return "bundle";
  }
  throw new PlanError(
    `nothing to wrap in ${probe.input}: no built bundle (index.html) and no server entry; build the project first`,
  );
}

function chooseEngine(probe: Probe, requested: WrapEngine | "auto", reasons: string[]): WrapEngine {
  const apis = chromiumApis(probe);
  if (requested !== "auto") {
    reasons.push(`${requested} engine: requested`);
    return requested;
  }
  if (apis.length > 0) {
    reasons.push(
      `cef engine: the page uses Chromium-only APIs (${apis.join(", ")}) that the system webviews do not all provide`,
    );
    return "cef";
  }
  reasons.push("wry engine: no Chromium-only API found, the system webview is lighter on memory");
  return "wry";
}

function risk(
  id: string,
  severity: Risk["severity"],
  area: Risk["area"],
  summary: string,
  kind: Risk["mitigation"]["kind"],
  detail: string,
): Risk {
  return { id, severity, area, summary, mitigation: { kind, detail } };
}

/** Everything that can still differ from the original once the plan is applied. */
export function assessRisks(probe: Probe, config: WrapConfig): Risk[] {
  const risks: Risk[] = [];
  const engine = config.engine;
  const mode = config.mode;
  const chromium = chromiumApis(probe);
  if (chromium.length > 0) {
    risks.push(
      engine === "cef"
        ? risk(
            "chromium-only-apis",
            "low",
            "ui",
            `uses ${chromium.join(", ")}`,
            "applied",
            "the Chromium (CEF) engine is selected",
          )
        : risk(
            "chromium-only-apis",
            "high",
            "ui",
            `uses ${chromium.join(", ")}, which WebKitGTK/WKWebView do not all provide`,
            "manual",
            "select the cef engine or accept the difference",
          ),
    );
  }
  if (hasSignal(probe, "service-worker")) {
    risks.push(
      engine === "cef"
        ? risk(
            "service-worker",
            "low",
            "platform",
            "registers a service worker",
            "applied",
            "Chromium runs it like the browser does",
          )
        : risk(
            "service-worker",
            "medium",
            "platform",
            "registers a service worker; WKWebView limits them to app-bound domains and WebKitGTK support varies",
            "manual",
            "online behaviour is unchanged, offline caching may differ; use the cef engine to match Chromium",
          ),
    );
  }
  if (hasSignal(probe, "notifications")) {
    risks.push(
      risk(
        "notifications",
        "medium",
        "platform",
        "uses the Web Notifications API, absent from WebKitGTK and WKWebView",
        "manual",
        "needs a native notification bridge (tauri-plugin-notification) limited to the app origin; not generated",
      ),
    );
  }
  if (hasSignal(probe, "media-devices") || hasSignal(probe, "geolocation")) {
    risks.push(
      risk(
        "device-permissions",
        "medium",
        "platform",
        "asks for camera, microphone or location",
        "manual",
        "the OS prompt and the macOS usage descriptions belong to the packaged app; check on each platform",
      ),
    );
  }
  if (hasSignal(probe, "webauthn")) {
    risks.push(
      risk(
        "webauthn",
        "medium",
        "auth",
        "uses WebAuthn / passkeys",
        "manual",
        "platform support differs per webview; test sign-in on each OS",
      ),
    );
  }
  if (hasSignal(probe, "user-agent-sniffing")) {
    risks.push(
      config.userAgent
        ? risk(
            "user-agent-sniffing",
            "low",
            "ui",
            "branches on the user agent",
            "applied",
            "a fixed user agent is configured",
          )
        : risk(
            "user-agent-sniffing",
            "medium",
            "ui",
            "branches on the user agent; the system webview reports a different one than Chrome",
            "flag",
            "set --user-agent to the string the page expects",
          ),
    );
  }
  if (hasSignal(probe, "print")) {
    risks.push(
      risk("print", "low", "platform", "calls window.print()", "manual", "native print support differs per webview"),
    );
  }
  if (probe.kind === "site") {
    risks.push(...siteRisks(probe, config));
  } else {
    risks.push(...directoryRisks(probe, config));
  }
  if (mode !== "remote" && probe.kind === "directory") {
    risks.push(
      risk(
        "origin-change",
        "medium",
        "auth",
        "the page is served from loopback instead of its public origin",
        "applied",
        "Secure, Domain and SameSite cookie attributes are rewritten by the proxy; `__Host-` cookies and OAuth callbacks registered for the public origin are not (see the entries above)",
      ),
    );
  }
  return risks;
}

function siteRisks(probe: SiteProbe, config: WrapConfig): Risk[] {
  const risks: Risk[] = [];
  if (probe.status >= 400) {
    risks.push(
      risk(
        "start-status",
        "medium",
        "backend",
        `the start page answered HTTP ${probe.status}`,
        "manual",
        "check the URL; the app will open that page as is",
      ),
    );
  }
  risks.push(
    risk(
      "network-required",
      "low",
      "platform",
      "remote mode needs a connection at launch",
      "manual",
      "offline launch shows the webview error page; use the project directory for an offline bundle",
    ),
  );
  risks.push(
    risk(
      "api-and-backend",
      "low",
      "backend",
      "API calls and backend are untouched",
      "applied",
      "requests leave the webview to the same origin as in a browser; no proxy, no rewriting",
    ),
  );
  if (probe.popupLinks > 0 || hasSignal(probe, "window-open")) {
    risks.push(
      risk(
        "popups",
        "low",
        "ui",
        "opens popups or target=_blank links",
        "applied",
        "in-app origins open as windows that keep their opener; other origins go to the system browser",
      ),
    );
  }
  if (probe.idps.length > 0) {
    const names = probe.idps.map(idp => idp.id).join(", ");
    risks.push(
      risk(
        "sign-in-providers",
        "medium",
        "auth",
        `sign-in or payment pages of ${names}`,
        "applied",
        "their origins are allowed in-app, popups keep their opener",
      ),
    );
    const strict = probe.idps.filter(idp => idp.id === "google" || idp.id === "apple");
    if (strict.length > 0 && config.engine === "wry") {
      risks.push(
        risk(
          "embedded-webview-sign-in",
          "medium",
          "auth",
          `${strict.map(idp => idp.id).join(", ")} may refuse sign-in in an embedded webview`,
          "manual",
          "test the sign-in flow; use the cef engine or a system-browser callback if it is refused",
        ),
      );
    }
  }
  const unlisted = probe.formOrigins.filter(
    origin => !config.origins.app.includes(origin) && !config.origins.auth.some(pattern => pattern.startsWith(origin)),
  );
  if (unlisted.length > 0) {
    risks.push(
      risk(
        "form-cross-origin",
        "medium",
        "api",
        `forms post to ${unlisted.join(", ")}`,
        "flag",
        "a POST navigation to an origin outside the allowlist opens in the system browser without its body; add the origin with --allow-origin",
      ),
    );
  }
  if (probe.frameOrigins.length > 0 || probe.embeds.length > 0) {
    risks.push(
      risk(
        "frame-navigation",
        "medium",
        "ui",
        `loads third-party frames (${[...probe.frameOrigins, ...probe.embeds.map(embed => embed.id)].slice(0, 4).join(", ")})`,
        "applied",
        "their origins are allowed in-app; WebKitGTK and WKWebView send frame loads through the navigation hook, a frame created later by script from an unlisted origin would open in the system browser",
      ),
    );
  }
  if (probe.cookies.some(cookie => cookie.sameSite === "none")) {
    risks.push(
      risk(
        "third-party-cookies",
        "medium",
        "auth",
        "sets SameSite=None cookies",
        "manual",
        "WebKit-based webviews restrict third-party cookies; cross-site embedded flows may differ from Chrome",
      ),
    );
  }
  return risks;
}

function directoryRisks(probe: DirectoryProbe, config: WrapConfig): Risk[] {
  const risks: Risk[] = [];
  if (config.mode === "bundle") {
    if (probe.apiRoutes > 0) {
      risks.push(
        risk(
          "api-routes-without-server",
          "blocker",
          "backend",
          `${probe.apiRoutes} API route(s) need a server that a static bundle does not have`,
          "manual",
          "use sidecar mode so the project's own server keeps answering them",
        ),
      );
    }
    const prefixes = config.bundle?.proxy ?? [];
    if (!config.bundle?.backend && probe.proxyPrefixes.length > 0) {
      risks.push(
        risk(
          "backend-unset",
          "high",
          "backend",
          `the bundle calls ${probe.proxyPrefixes.join(", ")} but no backend origin is set`,
          "flag",
          "pass --backend https://api.example.com so those routes are proxied",
        ),
      );
    } else if (config.bundle?.backend) {
      risks.push(
        risk(
          "backend-proxy",
          "medium",
          "api",
          `${prefixes.join(", ") || "no path"} proxied to ${config.bundle.backend}`,
          "applied",
          "Origin and Referer are rewritten to the backend, cookies are re-scoped to loopback, redirects stay in the app",
        ),
      );
      if (hasSignal(probe, "websocket") || hasSignal(probe, "event-source")) {
        risks.push(
          risk(
            "streaming-through-proxy",
            "high",
            "api",
            "uses WebSocket or EventSource",
            "manual",
            "the proxy forwards plain HTTP and server-sent bodies; WebSocket upgrades are not proxied, the backend must accept the loopback Origin",
          ),
        );
      }
    }
    if (probe.backends.length > 1 && !config.bundle?.backend) {
      risks.push(
        risk(
          "backend-ambiguous",
          "medium",
          "backend",
          `several backend origins found: ${probe.backends.join(", ")}`,
          "flag",
          "choose one with --backend",
        ),
      );
    }
  }
  if (config.mode === "sidecar") {
    risks.push(
      risk(
        "sidecar-process",
        "medium",
        "backend",
        "the project's server runs as a child of the app",
        "applied",
        "started on loopback, waited until ready, stopped with the app; compile it with `bun run build:sidecar`",
      ),
    );
    if (config.sidecar && config.sidecar.port === 0) {
      risks.push(
        risk(
          "sidecar-random-port",
          "low",
          "auth",
          "the server listens on a random port",
          "flag",
          "pass --port to keep OAuth callbacks and CORS allowlists valid",
        ),
      );
    }
    if (probe.nextOutput === null && probe.frameworks.includes("next")) {
      risks.push(
        risk(
          "next-server",
          "medium",
          "backend",
          "Next.js server without output: standalone",
          "manual",
          'set output: "standalone" and run the build so the sidecar has a self-contained server',
        ),
      );
    }
  }
  return risks;
}

function nameOf(probe: Probe, options: PlanOptions): string {
  if (options.name) return options.name;
  if (probe.kind === "directory") return probe.name ?? "wrapped-app";
  return probe.manifest?.name ?? probe.manifest?.shortName ?? probe.title ?? new URL(probe.finalUrl).hostname;
}

/** Refuses options the runtime would refuse at startup, so a typo fails here and not in the shipped app. */
function validateOptions(options: PlanOptions): void {
  for (const pattern of options.allowOrigins ?? []) {
    if (parsePattern(pattern) === null) {
      throw new PlanError(
        `--allow-origin ${JSON.stringify(pattern)} is not scheme://[*.]host[:port][/path/*] with http or https`,
      );
    }
  }
  if (options.backend !== undefined) {
    let url: URL | null = null;
    try {
      url = new URL(options.backend);
    } catch {
      // reported below
    }
    if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
      throw new PlanError(`--backend ${JSON.stringify(options.backend)} is not an http(s) origin`);
    }
  }
  if (options.port !== undefined && !(Number.isInteger(options.port) && options.port >= 0 && options.port <= 65_535)) {
    throw new PlanError(`--port ${options.port} is not a port number`);
  }
}

export function planConversion(probe: Probe, options: PlanOptions = {}): ConversionPlan {
  validateOptions(options);
  const reasons: string[] = [];
  const mode = chooseMode(probe, options.mode ?? "auto", reasons);
  const engine = chooseEngine(probe, options.engine ?? "auto", reasons);
  const name = nameOf(probe, options).trim().slice(0, 80) || "wrapped-app";
  const external = options.external ?? "system";
  const extra = options.allowOrigins ?? [];

  let start: string;
  let appOrigins: string[];
  let auth: string[] = [];
  let embeds: string[] = [];
  let bundle: WrapConfig["bundle"] = null;
  let sidecar: WrapConfig["sidecar"] = null;

  if (probe.kind === "site") {
    const input = probe.input.includes("://") ? probe.input : `https://${probe.input}`;
    start = new URL(input).href;
    appOrigins = siteApp(probe, extra);
    auth = authPatterns(probe);
    embeds = embedPatterns(probe);
    reasons.push(
      `origins: ${appOrigins.length} in-app pattern(s) from the redirect chain and the registrable domain, ${auth.length} sign-in pattern(s), ${embeds.length} frame pattern(s)`,
    );
  } else {
    start = "/";
    const backend = options.backend ?? (probe.backends.length === 1 ? probe.backends[0]! : null);
    appOrigins = [...extra];
    if (backend) appOrigins.push(backend);
    if (mode === "bundle") {
      bundle = {
        dir: `../${probe.staticDir && probe.staticDir !== "." ? probe.staticDir : "dist"}`,
        backend: backend ?? null,
        proxy: backend ? (probe.proxyPrefixes.length > 0 ? probe.proxyPrefixes : ["/api"]) : [],
        spaFallback: probe.htmlPages <= 1,
      };
    } else {
      sidecar = {
        program: "server",
        args: [],
        port: options.port ?? 0,
        readyPath: "/",
        readyTimeoutSecs: 30,
        env: {},
      };
    }
  }

  const config: WrapConfig = {
    schema: WRAP_SCHEMA,
    name,
    identifier:
      options.identifier ??
      tauriIdentifier(probe.kind === "site" ? new URL(probe.finalUrl).hostname : name, WRAPPED_ID_PREFIX),
    mode,
    engine,
    start,
    origins: { app: appOrigins, auth, embeds, external },
    window: {
      title: mode === "remote" ? null : name,
      width: 1280,
      height: 800,
      minWidth: null,
      minHeight: null,
      syncTitle: true,
      zoomHotkeys: true,
      dragDrop: false,
    },
    userAgent: options.userAgent ?? null,
    bundle,
    sidecar,
  };

  const risks = assessRisks(probe, config);
  const blocking = risks.some(
    entry => entry.severity === "blocker" || (entry.severity === "high" && entry.mitigation.kind !== "applied"),
  );
  const parityPaths =
    probe.kind === "site"
      ? ["/", ...probe.links.filter(path => path !== "/").slice(0, (options.maxParityPaths ?? 8) - 1)]
      : ["/"];

  return {
    schema: "aphrody-web-to-tauri.plan/1",
    config,
    reasons,
    risks,
    verdict: blocking ? "needs-review" : "faithful",
    parityPaths,
    probe,
  };
}
