// SPDX-License-Identifier: Apache-2.0
// Manga studio: the complete Koharu editor (@aphrody/koharu-ui) embedded in the Aphrody app.
// Its commands and state are koharu-app's, hosted by crates/ui/app (no second engine).
import KoharuProviders from "@aphrody/koharu-ui/providers";
import { KoharuApp } from "@aphrody/koharu-ui/components/app/KoharuApp";
import { isTauri } from "../../tauri-bridge";

export function MangaStudio() {
  if (!isTauri()) {
    return (
      <p className="text-[18px] text-on-surface-variant">
        L’éditeur manga nécessite l’application Aphrody.
      </p>
    );
  }
  return (
    <div className="h-[calc(100vh-12rem)] min-h-[560px] overflow-hidden rounded-xl border border-outline-variant">
      <KoharuProviders>
        <KoharuApp embedded />
      </KoharuProviders>
    </div>
  );
}
