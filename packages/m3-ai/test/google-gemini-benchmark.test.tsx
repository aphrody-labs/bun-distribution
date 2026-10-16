// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GoogleSpotlightBar,
  GeminiAccountMenu,
  ComposerMoreUploadsMenu,
  GeminiPersonalContextEdit,
} from "../src/index.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

async function renderDom(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await sleep(20);
  });
  return document.body.innerHTML;
}

beforeAll(() => {
  document.body.innerHTML = "";
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  document.body.innerHTML = "";
});

describe("Google & Gemini Desktop / Web benchmark components", () => {
  test("GoogleSpotlightBar renders capsule with Alt+Space and multimodal actions", () => {
    const html = renderToStaticMarkup(
      <GoogleSpotlightBar
        placeholder="Posez une question"
        onAttach={() => {}}
        onScreenCapture={() => {}}
        onGoogleLens={() => {}}
      />,
    );
    expect(html).toContain('<search aria-label="Google Spotlight Assistant"');
    expect(html).toContain("Alt + Space");
    expect(html).toContain("google-spotlight-capsule");
    expect(html).toContain("Posez une question");
    expect(html).toContain("screenshot");
    expect(html).toContain("center_focus_strong");
  });

  test("GeminiAccountMenu renders user profile and menu items", async () => {
    const html = await renderDom(
      <GeminiAccountMenu
        name="Aphrody Operator"
        email="contact@aphrody.com"
        open={true}
        onOpenChange={() => {}}
        items={[
          { id: "settings", label: "Settings", icon: "settings" },
          { id: "logout", label: "Sign out", icon: "logout", destructive: true },
        ]}
      >
        <button type="button">Trigger</button>
      </GeminiAccountMenu>,
    );
    expect(html).toContain("Aphrody Operator");
    expect(html).toContain("contact@aphrody.com");
    expect(html).toContain("Settings");
    expect(html).toContain("Sign out");
  });

  test("ComposerMoreUploadsMenu renders upload actions and submenu", async () => {
    const html = await renderDom(
      <ComposerMoreUploadsMenu
        open={true}
        onOpenChange={() => {}}
        items={[{ id: "upload", label: "Upload files", icon: "upload" }]}
        submenuItems={[{ id: "drive", label: "Google Drive", icon: "cloud" }]}
      >
        <button type="button">+</button>
      </ComposerMoreUploadsMenu>,
    );
    expect(html).toContain("Upload files");
    expect(html).toContain("Google Drive");
    expect(html).toContain("Cloud &amp; Storage");
  });

  test("GeminiPersonalContextEdit renders dialog with multiline editor", async () => {
    const html = await renderDom(
      <GeminiPersonalContextEdit
        open={true}
        onOpenChange={() => {}}
        initialContext="Use TypeScript and Bun."
        onSave={() => {}}
      />,
    );
    expect(html).toContain("Your personal context");
    expect(html).toContain("Use TypeScript and Bun.");
    expect(html).toContain("Save");
  });
});
