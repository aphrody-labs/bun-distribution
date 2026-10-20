// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { allAppCapabilities } from "@aphrody/bun-workspace/capabilities";
import { catalog } from "../os";
import { appStore } from "./appstore";
import { openWebApp } from "./webapps";
import type { RegistryEntry } from "../pkg";

/** Aphrody Creative: installable Rust-backed studio apps alongside Drive in the Web OS desktop. */
export async function creativeApp(
  root: HTMLElement,
  onChange: () => void,
  launch: (entry: RegistryEntry) => void,
  openDrive: () => void,
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
  const hostedCatalog = await catalog().catch(() => undefined);
  if (!hostedCatalog) return;
  const hostedCards = allAppCapabilities()
    .filter((entry) => !entry.webosPackageId)
    .flatMap((entry) => {
      const host = hostedCatalog.hosts[entry.libraryId];
      if (!host) return [];
      return [
        h(
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
              h("div", { class: "muted" }, "Hosted Aphrody studio"),
            ),
          ),
          h("div", { class: "sdesc" }, entry.description),
          h(
            "div",
            { class: "sact" },
            h(
              "button",
              {
                class: "btn",
                onclick: () =>
                  openWebApp({
                    id: entry.id,
                    name: entry.title,
                    url: `https://${host.host}.aphrody.app`,
                  }),
              },
              "Open studio",
            ),
          ),
        ),
      ];
    });
  if (hostedCards.length)
    apps.append(
      h("h3", { class: "creative-hosted-title" }, "Hosted studios"),
      h("div", { class: "store-list" }, ...hostedCards),
    );
}
