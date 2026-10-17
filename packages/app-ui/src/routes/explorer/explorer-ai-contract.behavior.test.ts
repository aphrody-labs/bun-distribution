// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import type { File } from "@aphrody/drive-client";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useAskAphrody } from "./hooks/useAskAphrody";

const file = (path: string, kind: File["kind"] = "File"): File => ({
  id: path,
  name: path.split(/[\\/]/).pop()!,
  extension: null,
  size: 0,
  sd_path: { Physical: { device_slug: "fixture", path } },
  kind,
  content_identity: null,
  alternate_paths: [],
  tags: [],
  sidecars: [],
  image_media_data: null,
  video_media_data: null,
  audio_media_data: null,
  created_at: "2026-10-04T00:00:00Z",
  modified_at: "2026-10-04T00:00:00Z",
  accessed_at: null,
  content_kind: "unknown",
  is_local: true,
  duration_seconds: null,
});
function ContextAction({ targets }: { targets: File[] }) {
  const ask = useAskAphrody();
  const location = useLocation();
  return createElement(
    "div",
    null,
    createElement("button", { onClick: () => ask(targets) }, "Demander à Aphrody"),
    createElement("output", null, JSON.stringify({ path: location.pathname, state: location.state })),
  );
}
let root: Root | undefined;
let container: HTMLDivElement | undefined;
const hasDom = typeof document !== "undefined";
if (hasDom) (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});
async function mount(targets: File[]) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(MemoryRouter, { initialEntries: ["/explorer"] }, createElement(ContextAction, { targets })),
    ),
  );
}
const current = () =>
  JSON.parse(container!.querySelector("output")!.textContent!) as {
    path: string;
    state: {
      initialPrompt: string;
      cwd: string;
      contextFiles: string[];
    } | null;
  };
describe.skipIf(!hasDom)("Explorer context reaches the real chat route", () => {
  test("a file keeps its original path and draft without sending inference", async () => {
    await mount([file("C:\\docs\\facture.pdf")]);
    expect(current()).toEqual({ path: "/explorer", state: null });
    await act(async () => container!.querySelector("button")!.click());
    expect(current()).toEqual({
      path: "/chat",
      state: {
        initialPrompt: 'À propos du fichier "facture.pdf" (C:\\docs\\facture.pdf) :\n',
        cwd: "C:\\docs",
        contextFiles: ["C:\\docs\\facture.pdf"],
      },
    });
  });
  test("multi-selection reaches the composer with every exact context path", async () => {
    await mount([file("/workspace/screen.png"), file("/workspace/notes.md")]);
    await act(async () => container!.querySelector("button")!.click());
    expect(current().path).toBe("/chat");
    expect(current().state?.contextFiles).toEqual(["/workspace/screen.png", "/workspace/notes.md"]);
    expect(current().state?.initialPrompt).toContain("- /workspace/screen.png\n- /workspace/notes.md");
    expect(current().state?.cwd).toBe("/workspace");
  });
  test("directory context and empty selections never invent file jobs", async () => {
    await mount([file("/workspace/project", "Directory")]);
    await act(async () => container!.querySelector("button")!.click());
    expect(current().state?.cwd).toBe("/workspace/project");
    expect(current().state?.initialPrompt).toContain('À propos du dossier "project"');
    await act(async () => root!.unmount());
    root = undefined;
    container!.remove();
    await mount([]);
    await act(async () => container!.querySelector("button")!.click());
    expect(current()).toEqual({ path: "/explorer", state: null });
  });
});
