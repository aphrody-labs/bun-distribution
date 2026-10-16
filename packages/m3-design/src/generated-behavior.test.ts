// SPDX-License-Identifier: Apache-2.0
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import type { ComponentType, ReactNode } from "react";
import type { Root } from "react-dom/client";
import { DesignCompiler } from "./generator.ts";

// Load React DOM only after the shared DOM/ElementInternals preload is installed.
if (typeof document === "undefined")
  await import("../../m3-config/test/dom.ts");
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
environment.IS_REACT_ACT_ENVIRONMENT = true;

type Action = { type: string; id?: string; open?: boolean; liked?: boolean };
type Artifact = ComponentType<{
  stream?: AsyncIterable<string>;
  thinking?: boolean;
  onAction?: (action: Action) => void;
}>;
type DialogElement = HTMLElement & { open: boolean };
const artifacts: Record<string, Artifact> = {};
const mounts: { root: Root; host: HTMLElement; unmounted: boolean }[] = [];
let workspace = "";

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "m3-generated-behavior-"));
  const compiler = new DesignCompiler();
  const entries = await Promise.all(
    Object.entries({
      scaffold: "standard streaming action router thinking",
      detail: "list-detail streaming action router thinking",
      supporting: "supporting-pane streaming action router thinking",
      feed: "feed streaming action router thinking",
    }).flatMap(([layout, brief]) =>
      ["default", "compact", "aéré"].map(async (density) => {
        const name = density === "default" ? layout : `${layout}-${density}`;
        const customBrief =
          density === "default" ? brief : `${brief} ${density} mobile`;
        const source = compiler
          .compile(customBrief)
          .files.find((file) => file.path === "src/index.tsx");
        if (!source)
          throw new Error("Compiler did not produce a React artifact");
        const entry = join(workspace, `${name}.tsx`);
        await Bun.write(entry, source.content);
        return entry;
      }),
    ),
  );
  const featurelessEntry = join(workspace, "featureless.tsx");
  const featureless = compiler
    .compile("standard")
    .files.find((file) => file.path === "src/index.tsx");
  if (!featureless)
    throw new Error("Compiler did not produce a featureless React artifact");
  await Bun.write(featurelessEntry, featureless.content);
  entries.push(featurelessEntry);
  const checkout = resolvePath(import.meta.dir, "../../..");
  const reactTypes = resolvePath(
    Bun.resolveSync("@types/react/package.json", checkout),
    "..",
  );
  const reactDomTypes = resolvePath(
    Bun.resolveSync("@types/react-dom/package.json", checkout),
    "..",
  );
  const configuration = join(workspace, "tsconfig.json");
  await Bun.write(
    configuration,
    JSON.stringify({
      extends: join(checkout, "packages/m3-config/tsconfig.json"),
      compilerOptions: {
        types: ["react", "react-dom"],
        typeRoots: [
          ...new Set(
            [reactTypes, reactDomTypes].map((dir) => resolvePath(dir, "..")),
          ),
        ],
        paths: {
          "@aphrody/m3-react": [join(checkout, "packages/m3-react/index.ts")],
          react: [join(reactTypes, "index.d.ts")],
          "react/jsx-runtime": [join(reactTypes, "jsx-runtime.d.ts")],
        },
      },
      include: entries,
    }),
  );
  const checked = Bun.spawn(["tsc", "--project", configuration, "--noEmit"], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [typecheckExit, stdout, stderr] = await Promise.all([
    checked.exited,
    new Response(checked.stdout).text(),
    new Response(checked.stderr).text(),
  ]);
  if (typecheckExit !== 0)
    throw new Error(`Generated React typecheck failed:\n${stdout}${stderr}`);
  // A deliverable browser build bundles React and the actual M3 wrapper dependencies.
  const browser = await Bun.build({
    entrypoints: entries,
    target: "browser",
    splitting: true,
    plugins: [
      {
        name: "browser-consumer-dependencies",
        setup(builder) {
          builder.onResolve({ filter: /^@aphrody\/m3-react$/ }, () => ({
            path: join(checkout, "packages/m3-react/index.ts"),
          }));
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({
            path: Bun.resolveSync(path, checkout),
          }));
        },
      },
    ],
  });
  if (!browser.success)
    throw new AggregateError(browser.logs, "Standalone browser build failed");
  const built = await Bun.build({
    entrypoints: entries,
    outdir: join(workspace, "browser"),
    target: "browser",
    splitting: true,
    naming: "[name].js",
    plugins: [
      {
        name: "checkout-react-components",
        setup(builder) {
          // The compiler package does not depend on React wrappers; consumers do.
          // Bind its generated import to the real local consumer package.
          builder.onResolve({ filter: /^@aphrody\/m3-react$/ }, () => ({
            path: join(checkout, "packages/m3-react/index.ts"),
          }));
          // Use the renderer's React instance while executing browser bundles in Bun.
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({
            path: Bun.resolveSync(path, checkout),
            external: true,
          }));
        },
      },
    ],
  });
  if (!built.success)
    throw new AggregateError(built.logs, "Generated browser build failed");
  // outdir writes the build outputs; writing each file-backed blob to itself would truncate it.
  await Promise.all(
    ["scaffold", "detail", "supporting", "feed"].map(async (name) => {
      const module = await import(join(workspace, "browser", `${name}.js`));
      if (typeof module.default !== "function") {
        throw new Error(
          `Generated ${name} export is missing: ${Object.keys(module).join(", ")}`,
        );
      }
      artifacts[name] = module.default;
    }),
  );
}, 120_000);

afterEach(async () => {
  for (const mounted of mounts.splice(0)) {
    // React act scopes must finish before starting the next root's teardown.
    // eslint-disable-next-line no-await-in-loop
    if (!mounted.unmounted) await React.act(() => mounted.root.unmount());
    mounted.host.remove();
  }
});

afterAll(async () => {
  environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

async function mount(element: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const mounted = { root: createRoot(host), host, unmounted: false };
  mounts.push(mounted);
  await React.act(() => mounted.root.render(element));
  return mounted;
}

function required<T extends Element = HTMLElement>(
  host: Element,
  selector: string,
): T {
  const element = host.querySelector<T>(selector);
  if (!element) throw new Error(`Missing generated element: ${selector}`);
  return element;
}

async function click(element: Element) {
  // Happy DOM's ripple animation cancellation rejects outside the click promise.
  // Disable only that visual effect; the real button, dialog and event bindings remain active.
  const buttonHost =
    element.getRootNode() instanceof ShadowRoot
      ? (element.getRootNode() as ShadowRoot).host
      : element;
  const ripple = buttonHost.shadowRoot?.querySelector<
    HTMLElement & { disabled: boolean }
  >("md-ripple");
  if (ripple) ripple.disabled = true;
  await React.act(() => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true }),
    );
  });
}

function controlledStream(cleanupFails = false) {
  let pending:
    | {
        resolve: (result: IteratorResult<string>) => void;
        reject: (reason: unknown) => void;
      }
    | undefined;
  let returns = 0;
  let starts = 0;
  const stream: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      starts++;
      return {
        next() {
          return new Promise<IteratorResult<string>>((resolve, reject) => {
            pending = { resolve, reject };
          });
        },
        return() {
          returns++;
          return cleanupFails
            ? Promise.reject(new Error("Producer cleanup failed"))
            : Promise.resolve({ value: undefined, done: true as const });
        },
      };
    },
  };
  const takePending = () => {
    if (!pending) throw new Error("Consumer has no pending next()");
    const request = pending;
    pending = undefined;
    return request;
  };
  return {
    stream,
    get starts() {
      return starts;
    },
    get returns() {
      return returns;
    },
    push(value: string) {
      takePending().resolve({ value, done: false });
    },
    finish() {
      takePending().resolve({ value: undefined, done: true });
    },
    fail(reason: unknown) {
      takePending().reject(reason);
    },
  };
}

describe("generated browser artifacts with real M3 React wrappers", () => {
  test("requires a consumer stream and shows no fabricated response", async () => {
    const mounted = await mount(React.createElement(artifacts.scaffold));
    const output = required(mounted.host, "[data-stream-output]");
    expect(output.textContent).toBe("");
    expect(output.getAttribute("aria-busy")).toBe("false");
    expect(mounted.host.querySelector("md-dialog")).not.toBeNull();
    expect(mounted.host.querySelector("md-scaffold")).not.toBeNull();
    expect(mounted.host.querySelector("[data-thinking-indicator]")).toBeNull();
    await React.act(() =>
      mounted.root.render(
        React.createElement(artifacts.scaffold, { thinking: true }),
      ),
    );
    expect(
      required(mounted.host, "[data-thinking-indicator]").textContent,
    ).toBe("Reflecting...");
  });

  test("appends consumer chunks and finishes without a caret in feed layouts", async () => {
    const producer = controlledStream();
    const mounted = await mount(
      React.createElement(artifacts.feed, { stream: producer.stream }),
    );
    const output = required(mounted.host, "[data-stream-output]");
    expect(producer.starts).toBe(1);
    expect(output.getAttribute("aria-busy")).toBe("true");
    await React.act(async () => producer.push("First "));
    expect(output.textContent).toBe("First |");
    await React.act(async () => producer.push("second"));
    expect(output.textContent).toBe("First second|");
    await React.act(async () => producer.finish());
    expect(output.textContent).toBe("First second");
    expect(output.getAttribute("aria-busy")).toBe("false");
    expect(producer.returns).toBe(0);
  });

  test("displays a producer rejection and releases the failed iterator", async () => {
    const producer = controlledStream(true);
    const mounted = await mount(
      React.createElement(artifacts.scaffold, { stream: producer.stream }),
    );
    await React.act(async () => producer.push("Partial result"));
    await React.act(async () =>
      producer.fail(new Error("Connection interrupted")),
    );
    const output = required(mounted.host, "[data-stream-output]");
    expect(output.textContent).toContain("Partial result");
    expect(required(output, '[role="alert"]').textContent).toBe(
      "Connection interrupted",
    );
    expect(output.getAttribute("aria-busy")).toBe("false");
    expect(producer.returns).toBe(1);
  });

  test("reports failure to acquire an iterator", async () => {
    const stream: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        throw new Error("Stream unavailable");
      },
    };
    const mounted = await mount(
      React.createElement(artifacts.detail, { stream }),
    );
    expect(required(mounted.host, '[role="alert"]').textContent).toBe(
      "Stream unavailable",
    );
    expect(
      required(mounted.host, "[data-stream-output]").getAttribute("aria-busy"),
    ).toBe("false");
  });

  test("replaces and removes a stream without accepting late chunks", async () => {
    const previous = controlledStream();
    const replacement = controlledStream();
    const mounted = await mount(
      React.createElement(artifacts.detail, { stream: previous.stream }),
    );
    await React.act(async () => previous.push("Old result"));
    await React.act(() =>
      mounted.root.render(
        React.createElement(artifacts.detail, { stream: replacement.stream }),
      ),
    );
    const output = required(mounted.host, "[data-stream-output]");
    expect(previous.returns).toBe(1);
    expect(output.textContent).toBe("|");
    await React.act(async () => previous.push(" late"));
    expect(output.textContent).toBe("|");
    await React.act(async () => replacement.push("New result"));
    expect(output.textContent).toBe("New result|");
    await React.act(() =>
      mounted.root.render(React.createElement(artifacts.detail)),
    );
    expect(replacement.returns).toBe(1);
    await React.act(async () => replacement.fail(new Error("Late rejection")));
    expect(output.textContent).toBe("");
    expect(output.getAttribute("aria-busy")).toBe("false");
    expect(output.querySelector('[role="alert"]')).toBeNull();
  });

  test("unmount releases a pending iterator once and ignores late completion", async () => {
    const producer = controlledStream(true);
    const mounted = await mount(
      React.createElement(artifacts.scaffold, { stream: producer.stream }),
    );
    await React.act(() => mounted.root.unmount());
    mounted.unmounted = true;
    expect(producer.returns).toBe(1);
    await React.act(async () => producer.push("Cannot render after unmount"));
    expect(mounted.host.textContent).toBe("");
    expect(producer.returns).toBe(1);
  });

  test("selecting list items updates details and emits typed action data", async () => {
    const actions: Action[] = [];
    const mounted = await mount(
      React.createElement(artifacts.detail, {
        onAction: (action) => actions.push(action),
      }),
    );
    const first = required(mounted.host, '[data-id="detail-1"]');
    const second = required(mounted.host, '[data-id="detail-2"]');
    expect(required(second, '[slot="headline"]').textContent).toBe(
      "Secondary Detail Item",
    );
    expect(required(second, '[slot="supporting-text"]').textContent).toBe(
      "Detailed metrics and parameters",
    );
    await click(second);
    expect(required(mounted.host, "[data-item-details]").textContent).toBe(
      "Secondary item: detailed metrics and parameters.",
    );
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(first.getAttribute("aria-selected")).toBe("false");
    await click(first);
    expect(required(mounted.host, "[data-item-details]").textContent).toBe(
      "Primary item: overview and configuration.",
    );
    expect(actions).toEqual([
      { type: "select-item", id: "detail-2" },
      { type: "select-item", id: "detail-1" },
    ]);
  });

  test("inspecting a task updates its supporting pane", async () => {
    const actions: Action[] = [];
    const mounted = await mount(
      React.createElement(artifacts.supporting, {
        onAction: (action) => actions.push(action),
      }),
    );
    await click(required(mounted.host, '[data-id="task-1"]'));
    expect(required(mounted.host, "[data-task-details]").textContent).toBe(
      "Primary Task Element: in progress, needs review.",
    );
    expect(actions).toEqual([{ type: "inspect-task", id: "task-1" }]);
  });

  test("like/unlike updates each post and routes clicks from a Lit shadow button", async () => {
    const actions: Action[] = [];
    const mounted = await mount(
      React.createElement(artifacts.feed, {
        onAction: (action) => actions.push(action),
      }),
    );
    const first = required<HTMLElement & { updateComplete: Promise<boolean> }>(
      mounted.host,
      '[data-action="like-post"][data-id="1"]',
    );
    await first.updateComplete;
    const shadowButton = first.shadowRoot?.querySelector("button");
    if (!shadowButton)
      throw new Error("Real Lit button did not render its shadow button");
    await click(shadowButton);
    expect(first.textContent).toBe("Unlike");
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(
      required(mounted.host, '[data-action="like-post"][data-id="2"]')
        .textContent,
    ).toBe("Like");
    await click(shadowButton);
    expect(first.textContent).toBe("Like");
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(actions).toEqual([
      { type: "like-post", id: "1", liked: true },
      { type: "like-post", id: "1", liked: false },
    ]);
    const tooltip = required<HTMLElement & { text: string }>(
      mounted.host,
      "md-tooltip",
    );
    expect(tooltip.text).toBe("Hovering over primary CTA");
    const third = required(tooltip, '[data-id="3"]');
    expect(third.getAttribute("slot")).toBe("trigger");
    await click(third);
    expect(third.textContent).toBe("Unlike");
  });

  test("navigation uses distinct values, a selected destination and visible default-slot icons", async () => {
    const mounted = await mount(React.createElement(artifacts.scaffold));
    type Rail = HTMLElement & {
      value: string;
      updateComplete: Promise<boolean>;
    };
    type Destination = Rail & { selected: boolean };
    const rail = required<Rail>(mounted.host, "md-navigation-rail");
    await rail.updateComplete;
    const items = Array.from(
      rail.querySelectorAll<Destination>("md-navigation-rail-item"),
    );
    expect(items.map((item) => item.value)).toEqual([
      "dashboard",
      "components",
      "analytics",
    ]);
    expect(items[0].selected).toBe(true);
    const icon = required(items[1], "md-icon");
    expect(icon.textContent).toBe("widgets");
    expect(icon.hasAttribute("slot")).toBe(false);
    await items[1].updateComplete;
    const button = items[1].shadowRoot?.querySelector("button");
    if (!button) throw new Error("Rail destination has no visible button");
    await click(button);
    await rail.updateComplete;
    expect(rail.value).toBe("components");
    expect(items[0].selected).toBe(false);
    expect(items[1].selected).toBe(true);
  });

  test("spec dialogs display selected content and stay local to each instance", async () => {
    const actions: Action[] = [];
    const first = await mount(
      React.createElement(artifacts.scaffold, {
        onAction: (action) => actions.push(action),
      }),
    );
    const second = await mount(React.createElement(artifacts.scaffold));
    const firstDialog = required<DialogElement>(first.host, "md-dialog");
    const secondDialog = required<DialogElement>(second.host, "md-dialog");
    await click(required(second.host, '[data-action="toggle-dialog"]'));
    expect(secondDialog.open).toBe(true);
    expect(firstDialog.open).toBe(false);
    await click(required(first.host, '[data-id="motion-spec"]'));
    expect(firstDialog.open).toBe(true);
    expect(required(firstDialog, '[slot="headline"]').textContent).toBe(
      "Spring Motion Physics",
    );
    expect(firstDialog.textContent).toContain(
      "Damping 0.9 spatial, Damping 1.0 effects",
    );
    await click(required(firstDialog, '[data-action="toggle-dialog"]'));
    expect(firstDialog.open).toBe(false);
    expect(secondDialog.open).toBe(true);
    expect(actions).toEqual([
      { type: "view-spec", id: "motion-spec" },
      { type: "toggle-dialog", open: false },
    ]);
    await React.act(() => secondDialog.dispatchEvent(new Event("close")));
    expect(secondDialog.open).toBe(false);
    await click(required(second.host, '[data-action="toggle-dialog"]'));
    expect(secondDialog.open).toBe(true);
  });

  test("ignores unregistered actions and invalid IDs", async () => {
    const actions: Action[] = [];
    const mounted = await mount(
      React.createElement(artifacts.feed, {
        onAction: (action) => actions.push(action),
      }),
    );
    const element = required(mounted.host, '[data-action="like-post"]');
    element.setAttribute("data-id", "unknown");
    await click(element);
    element.setAttribute("data-action", "toString");
    await click(element);
    expect(element.textContent).toBe("Like");
    expect(actions).toEqual([]);
  });
});
