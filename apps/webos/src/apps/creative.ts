// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { allAppCapabilities } from "@aphrody/bun-workspace/capabilities";
import { catalog } from "../os";
import { appStore } from "./appstore";
import type { RegistryEntry } from "../pkg";

/** Aphrody Creative: installable Rust-backed studio apps alongside Drive in the Web OS desktop. */
export async function creativeApp(
  root: HTMLElement,
  onChange: () => void,
  launch: (entry: RegistryEntry) => void,
  openDrive: () => void,
  open: (id: string) => void,
) {
  const apps = h("div", { class: "creative-apps" });
  root.append(
    h(
      "section",
      { class: "creative-head" },
      h(
        "div",
        { class: "creative-copy" },
        h(
          "span",
          { class: "creative-kicker" },
          "APHRODY / BUN · CREATIVE STUDIO",
        ),
        h("h2", {}, "Your creative workspace"),
        h(
          "p",
          {},
          "Install and open the Rust-powered studios together with your Drive projects.",
        ),
      ),
      h(
        "button",
        { class: "btn tonal", onclick: openDrive },
        "Open Aphrody Drive",
      ),
    ),
    apps,
  );
  await appStore(apps, onChange, launch, "create");
  // Studios with no browser package of their own open their member window: native builds, docs, source.
  const hostedCatalog = await catalog().catch(() => undefined);
  const hostedCards = allAppCapabilities()
    .filter((entry) => !entry.webosPackageId)
    .map((entry) => {
      const member = hostedCatalog?.apps.find(
        (app) => app.id === entry.libraryId,
      );
      return h(
        "article",
        { class: "scard" },
        h(
          "div",
          { class: "pkg-head" },
          h("span", { class: "licon" }, entry.title.charAt(0)),
          h(
            "div",
            {},
            h("div", { class: "sname" }, entry.title),
            h(
              "div",
              { class: "muted" },
              member ? `apps/${member.id}` : entry.libraryId,
            ),
          ),
        ),
        h("div", { class: "sdesc" }, entry.description),
        h(
          "div",
          { class: "sact" },
          h("span", { class: "muted" }, "Native studio: no browser build"),
          h(
            "button",
            {
              class: "btn tonal",
              onclick: () => open(`src:${entry.libraryId}`),
            },
            "Details",
          ),
        ),
      );
    });
  if (hostedCards.length)
    apps.append(
      h("h3", { class: "creative-hosted-title" }, "Native studios"),
      h("div", { class: "store-list" }, ...hostedCards),
    );
}
