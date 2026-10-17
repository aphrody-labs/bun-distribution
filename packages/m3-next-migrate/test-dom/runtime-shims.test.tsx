// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Form } from "../src/shims/form";
import { dynamic } from "../src/shims/dynamic";
import { cookies } from "../src/shims/headers";
import { usePathname, useSearchParams } from "../src/shims/navigation";
import { NextMigrateProvider } from "../src/shims/provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM;
happyDOM.setURL("http://localhost/initial");
let root: ReturnType<typeof createRoot> | undefined;
const originalCookie = Object.getOwnPropertyDescriptor(document, "cookie");

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  if (originalCookie) Object.defineProperty(document, "cookie", originalCookie);
  else delete (document as { cookie?: string }).cookie;
  happyDOM.setURL("http://localhost/initial");
});

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  return container;
}

function NavigationProbe() {
  return (
    <span>
      {usePathname()}|{useSearchParams().get("q")}
    </span>
  );
}

describe("migrated browser runtime contracts", () => {
  test("cookies preserve equals, tolerate malformed encoding, and ignore prototype names", async () => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      value: "token=abc==; broken=%E0%A4; __proto__=owned; light=",
    });
    const store = await cookies();
    expect(store.get("token")).toEqual({ name: "token", value: "abc==" });
    expect(store.get("broken")).toEqual({ name: "broken", value: "%E0%A4" });
    expect(store.get("__proto__")).toEqual({
      name: "__proto__",
      value: "owned",
    });
    expect(store.has("toString")).toBe(false);
    expect(store.get("toString")).toBeUndefined();
    expect(store.getAll("light")).toEqual([{ name: "light", value: "" }]);
  });

  test("a zero max-age remains a deletion request", async () => {
    let written = "";
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: (value: string) => {
        written = value;
      },
    });
    (await cookies()).set?.("temporary", "value", { maxAge: 0 });
    expect(written).toContain("max-age=0");
  });

  test("GET forms preserve action, replace its query, keep the fragment and include the submit button", async () => {
    const navigations: string[] = [];
    const container = await mount(
      <NextMigrateProvider mode="browser" onNavigate={url => navigations.push(url)}>
        <Form action="/search?old=ignored#results">
          <input name="q" defaultValue="hello world" />
          <button name="intent" value="search" type="submit">
            Search
          </button>
        </Form>
      </NextMigrateProvider>,
    );
    const form = container.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/search?old=ignored#results");
    const event = new window.SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: container.querySelector("button")!,
    });
    await act(async () => {
      form.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(navigations).toEqual(["/search?q=hello+world&intent=search#results"]);
  });

  test("POST and cross-origin forms preserve native submission", async () => {
    const navigations: string[] = [];
    const container = await mount(
      <NextMigrateProvider mode="browser" onNavigate={url => navigations.push(url)}>
        <Form action="/upload" method="post">
          <button>Upload</button>
        </Form>
        <Form action="https://example.com/search">
          <button>Search</button>
        </Form>
      </NextMigrateProvider>,
    );
    await act(async () => {
      for (const form of container.querySelectorAll("form")) {
        const event = new window.SubmitEvent("submit", {
          bubbles: true,
          cancelable: true,
        });
        form.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
    });
    expect(navigations).toEqual([]);
  });

  test("function actions delegate to React's action contract", () => {
    const markup = renderToStaticMarkup(
      <Form action={async () => {}}>
        <input name="value" />
      </Form>,
    );
    expect(markup).toContain("action=");
    expect(markup).toContain('name="value"');
  });

  test("ssr:false does not run the loader on the server and loads after the first browser mount", async () => {
    let loads = 0;
    const Widget = dynamic(
      async () => {
        loads++;
        return { default: () => <b>Loaded</b> };
      },
      { ssr: false, loading: () => <i>Loading</i> },
    );
    expect(renderToStaticMarkup(<Widget />)).toBe("<i>Loading</i>");
    expect(loads).toBe(0);
    const container = await mount(<Widget />);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(loads).toBe(1);
    expect(container.textContent).toBe("Loaded");
  });

  test("initialPath renders consistently on the server and hash fragments stay out of search params", async () => {
    expect(
      renderToStaticMarkup(
        <NextMigrateProvider mode="browser" initialPath="/server?q=s">
          <NavigationProbe />
        </NextMigrateProvider>,
      ),
    ).toContain("/server|s");
    happyDOM.setURL("http://localhost/#/hash?q=one#anchor");
    const container = await mount(
      <NextMigrateProvider mode="tauri" initialPath="/server?q=s">
        <NavigationProbe />
      </NextMigrateProvider>,
    );
    expect(container.textContent).toBe("/hash|one");
  });
});
