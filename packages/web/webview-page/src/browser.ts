// SPDX-License-Identifier: Apache-2.0
// Launcher: Playwright's `chromium.launch` / `newContext` / `newPage` shape over Bun.WebView.
import { Page, type PageOptions, type Route, type WebViewLike } from "./page.ts";

export type LaunchOptions = {
  /** Accepted for Playwright compatibility; Bun.WebView is always headless. */
  headless?: boolean;
  channel?: string;
  /** Extra Chrome flags (appended after Bun's defaults). */
  args?: string[];
  /** Chrome executable; defaults to BUN_CHROME_PATH or the PATH search Bun performs. */
  executablePath?: string;
};

type ViewFactory = (
  options: { width: number; height: number },
  console: (type: string, ...args: unknown[]) => void,
) => WebViewLike;

const describeArg = (arg: unknown): string => {
  if (arg && typeof arg === "object") {
    const remote = arg as { description?: string; value?: unknown };
    return (
      remote.description ??
      (remote.value !== undefined ? String(remote.value) : JSON.stringify(arg))
    );
  }
  return String(arg);
};

export class BrowserContext {
  private readonly pages: Page[] = [];
  private readonly routes: { glob: string; handler: (route: Route) => Promise<void> | void }[] = [];

  constructor(
    private readonly create: ViewFactory,
    private readonly options: PageOptions,
  ) {}

  async newPage(): Promise<Page> {
    const viewport = this.options.viewport ?? { width: 1280, height: 720 };
    let page: Page | undefined;
    const view = this.create(viewport, (type, ...args) => {
      page?.emitConsole(type, args.map(describeArg).join(" "));
    });
    page = new Page(view, this.options);
    await page.init();
    for (const route of this.routes) await page.route(route.glob, route.handler);
    this.pages.push(page);
    return page;
  }

  async route(glob: string, handler: (route: Route) => Promise<void> | void) {
    this.routes.push({ glob, handler });
    for (const page of this.pages) await page.route(glob, handler);
  }

  async close() {
    for (const page of this.pages) page.close();
    this.pages.length = 0;
  }
}

export class Browser {
  constructor(
    private readonly create: ViewFactory,
    private readonly productVersion: string,
  ) {}

  /** Product string reported by Chrome, for example "HeadlessChrome/141.0.0.0". */
  version(): string {
    return this.productVersion;
  }

  async newContext(options: PageOptions = {}) {
    return new BrowserContext(this.create, options);
  }

  async newPage(options: PageOptions = {}) {
    return (await this.newContext(options)).newPage();
  }

  async close() {
    (globalThis as { Bun?: { WebView?: { closeAll(): void } } }).Bun?.WebView?.closeAll();
  }
}

/** Launch the Chrome backend of Bun.WebView and read its product version. */
export async function launch(options: LaunchOptions = {}): Promise<Browser> {
  const WebView = (globalThis as { Bun?: { WebView?: new (init: object) => WebViewLike } }).Bun
    ?.WebView;
  if (!WebView) throw new Error("Bun.WebView is not available in this runtime");
  const create: ViewFactory = ({ width, height }, console) =>
    new WebView({
      width,
      height,
      backend: {
        type: "chrome",
        url: false,
        ...(options.executablePath ? { path: options.executablePath } : {}),
        ...(options.args ? { argv: options.args } : {}),
      },
      console,
    });
  const probe = new Page(create({ width: 800, height: 600 }, () => undefined));
  try {
    await probe.view.navigate("about:blank");
    const { product } = (await probe.view.cdp("Browser.getVersion")) as { product: string };
    return new Browser(create, product);
  } finally {
    probe.close();
  }
}

/** Mirror of Playwright's `chromium` export. */
export const chromium = { launch };

/** Build a Browser over any view factory (tests, alternative backends). */
export function browserFrom(create: ViewFactory, version = "test"): Browser {
  return new Browser(create, version);
}
