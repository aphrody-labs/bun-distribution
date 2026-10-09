#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Generate this lot's site/server section without replacing other owners' sections."""

from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "docs/ui-rust-migration.md"
START = "<!-- BEGIN uirust-site inventory -->"
END = "<!-- END uirust-site inventory -->"
SERVER_FILES = (
    "apps/web/server.ts",
    "apps/web/webos.ts",
    "apps/web/src/os/ffi-routes.ts",
    "apps/web/src/os/os-router.ts",
    "apps/web/src/os/server-extensions.ts",
    "apps/web/src/os/wasm/server-routes.ts",
)
FILES = ("crates/web/site/assets/site.css", *SERVER_FILES)


def escaped(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")


def role(path: Path) -> str:
    roles = {
        "crates/web/site/assets/site.css": "Styles du site Rust",
        "apps/web/server.ts": "Lanceur HTTP de l'app web",
        "apps/web/webos.ts": "Relais du serveur WebOS du fork Bun",
        "apps/web/src/os/ffi-routes.ts": "Routes API FFI",
        "apps/web/src/os/os-router.ts": "Routes OS de démonstration",
        "apps/web/src/os/server-extensions.ts": "Composition des routes WebOS/FFI",
        "apps/web/src/os/wasm/server-routes.ts": "Routes bridge fetch/TCP WebOS",
    }
    return roles[path.relative_to(ROOT).as_posix()]


def destination(path: Path) -> str:
    relative = path.relative_to(ROOT).as_posix()
    if relative == "crates/web/site/assets/site.css":
        return "crates/ui/m3 (tokens/styles); servi par crates/web/site"
    if relative == "apps/web/server.ts":
        return "crates/ai/app-server + crates/web/site (Axum)"
    if relative == "apps/web/webos.ts":
        return "Fork Bun: packages/bun-webos (propriétaire déclaré dans la source)"
    if relative in {"apps/web/src/os/os-router.ts", "apps/web/src/os/wasm/server-routes.ts"}:
        return "Contrat Axum à définir après retrait/qualification des simulations WebOS"
    return "Contrat Axum à définir; préserver le propriétaire runtime/FFI du fork Bun"


def state(path: Path) -> str:
    relative = path.relative_to(ROOT).as_posix()
    if relative == "crates/web/site/assets/site.css":
        return "Le serveur Axum existe; rendu/actifs et parité UI restent à qualifier"
    if relative == "apps/web/server.ts":
        return "Déjà un lanceur du serveur Rust; scripts web:dev/start invoquent encore Bun"
    if relative == "apps/web/webos.ts":
        return "Délègue à @aphrody/bun-webos; SHA mentionné dans la source, reçu de transfert absent"
    if relative == "apps/web/src/os/os-router.ts":
        return "Handlers simulés seulement; ne pas les publier comme capacités OS réelles"
    return "Handler TS encore présent; parité Axum et retrait non qualifiés"


def render() -> str:
    lines = [START, "## Lot uirust-site : site et serveurs", "",
             "L'inventaire global est au-dessus; ce bloc détaille les surfaces de ce lot.",
             "Les états décrivent le code constaté et ne valent pas preuve de parité.", "",
             "| Fichier | Rôle | Cible Rust | État |", "| --- | --- | --- | --- |"]
    for relative in FILES:
        path = ROOT / relative
        if not path.is_file():
            continue
        lines.append("| `{}` | {} | {} | {} |".format(
            escaped(relative), escaped(role(path)), escaped(destination(path)), escaped(state(path))))
    lines.extend(["", END])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="échoue si l'inventaire suivi est périmé")
    args = parser.parse_args()
    section = render()
    original = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
    start, end = original.find(START), original.find(END)
    if start >= 0 and end < start:
        raise SystemExit("Marqueurs uirust-site mal ordonnés dans l'inventaire")
    content = (original[:start] + section + original[end + len(END):]) if start >= 0 else (original.rstrip() + "\n\n" + section + "\n")
    if args.check:
        if not OUTPUT.exists() or original != content:
            print(f"Inventaire périmé : exécuter python3 {Path(__file__).relative_to(ROOT)}")
            return 1
        print(f"Inventaire à jour : {OUTPUT.relative_to(ROOT)}")
        return 0
    OUTPUT.write_text(content, encoding="utf-8")
    print(f"Inventaire généré : {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
