#!/usr/bin/env python3
"""Génère l'inventaire UI du lot uirust-app à partir des fichiers présents."""

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".html", ".css"}
SURFACES = (
    ("apps/web", "App web"),
    ("crates/ui/app", "App desktop"),
    ("crates/tauri", "Tauri"),
    ("packages/web", "Packages web"),
)


def role(path: Path) -> str:
    relative = path.relative_to(ROOT).as_posix()
    parts = relative.split("/")
    if parts[0] == "apps":
        if path.name in {"server.ts", "build.ts", "webos.ts"}:
            return {"server.ts": "serveur HTTP", "build.ts": "build frontend", "webos.ts": "serveur WebOS"}[path.name]
        if "/test/" in f"/{relative}/" or path.name.endswith(".test.ts"):
            return "test ou fixture"
        return "/".join(parts[3:-1] + [path.stem]) or "entrée frontend"
    if parts[:3] == ["crates", "ui", "app"]:
        return "assets UI desktop" if "ui-dist" in parts else "fixture UI desktop"
    if parts[:2] == ["crates", "tauri"]:
        if "test" in parts or path.name.endswith(".test.ts"):
            return "test ou fixture Tauri"
        if "scripts" in parts:
            return "script injecté dans la webview"
        return "API ou outillage générique Tauri"
    if "test" in parts or path.name.endswith(".test.ts"):
        return "test ou fixture de package"
    if "examples" in parts:
        return "exemple de package"
    return "/".join(parts[2:-1] + [path.stem]) or "entrée de package"


def destination(path: Path) -> tuple[str, str]:
    relative = path.relative_to(ROOT).as_posix()
    if relative == "apps/web/server.ts":
        return "crates/web/site + crates/ai/app-server", "logique HTTP Rust et tests présents; lanceur Bun encore actif"
    if relative == "apps/web/build.ts":
        return "m3/packages/app-ui/build.ts puis constructeur Rust/WASM", "relai Bun; build Rust/WASM absent"
    if relative == "apps/web/webos.ts":
        return "fork Bun, packages/bun-webos", "transfert signalé par le code; reçu de destination absent"
    if relative.startswith("apps/web/test/") or relative.endswith(".test.ts"):
        return "tests Rust du propriétaire de la fonctionnalité", "tests Bun seulement; parité Rust à ajouter"
    if relative.startswith("apps/web/src/"):
        return "crates/ui/m3 en WASM + crates web Rust", "socle M3 manquant; migration à démarrer"
    if relative.startswith("crates/tauri/"):
        return "fork Bun (intégration Tauri générique)", "transfert/qualification requis; hors propriétaire Aphrody"
    if relative.startswith("crates/ui/app/"):
        return "crates/ui/m3 + WASM ou hôte CEF", "bundle app-ui React actif; remplacement Rust non qualifié"
    if relative.startswith("packages/web/"):
        if relative.startswith("packages/web/x/"):
            return "crates/web/x (aphrody-x)", "façade Rust déjà déclarée; tests/parité à qualifier"
        if relative.startswith("packages/web/agent-browser/"):
            return "crates/web/aphrody-web + aphrody-app", "moteur natif consommé; client TypeScript à migrer"
        return "crate du domaine consommant M3 Rust, ou test Rust", "migration à planifier par fonction"
    return "crates/ui/m3 en WASM + crates web Rust", "socle M3 manquant; migration à démarrer"


def main() -> None:
    rows = []
    for directory, surface in SURFACES:
        # Tracked files only: ignored build output (dist/, node_modules) is not source to migrate.
        tracked = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files", "-z", "--", directory],
            check=True, capture_output=True,
        ).stdout.decode("utf-8").split("\0")
        for path in sorted(ROOT / name for name in tracked if name):
            if path.is_file() and path.suffix.lower() in EXTENSIONS:
                dest, state = destination(path)
                rows.append((path.relative_to(ROOT).as_posix(), surface, role(path), dest, state))

    output = [
        "<!-- SPDX-License-Identifier: Apache-2.0 -->",
        "<!-- Généré par `python3 scripts/migration/ui-rust-inventory.py`; ne pas éditer ce tableau à la main. -->",
        "# Inventaire de migration UI vers Rust",
        "",
        "Inventaire exhaustif par extension (`.ts`, `.tsx`, `.js`, `.jsx`, `.html`, `.css`) pour les surfaces du lot `uirust-app`, généré depuis l’arbre de travail. Les rôles sont déduits des chemins et restent à confirmer lors de la qualification fonctionnelle.",
        "",
        f"Fichiers recensés : **{len(rows)}**. `crates/ui/m3` est absent de ce checkout; les consommateurs qui en dépendent restent bloqués jusqu’à réception du socle commun.",
        "",
        "| Surface | Fichiers |",
        "| --- | ---: |",
    ]
    for _, surface in SURFACES:
        output.append(f"| {surface} | {sum(1 for row in rows if row[1] == surface)} |")
    output.extend(
        [
            "",
        "| Fichier | Surface | Rôle déduit du chemin | Cible Rust | État |",
        "| --- | --- | --- | --- | --- |",
        ]
    )
    output.extend(f"| `{file}` | {surface} | {purpose} | {target} | {state} |" for file, surface, purpose, target, state in rows)
    output.extend(
        [
            "",
            "L’état « migration à planifier » ne signifie pas que le comportement est qualifié. Aucun fichier source n’est supprimé tant que sa parité de routes, interactions, sécurité et accessibilité n’est pas prouvée dans sa cible Rust.",
            "",
        ]
    )
    # The document holds other sections (M3 inventory, uirust-site, generated uirust): replace only this one.
    target = ROOT / "docs/ui-rust-migration.md"
    current = target.read_text(encoding="utf-8") if target.exists() else ""
    start = current.find(output[1])
    stop = current.find("<!-- BEGIN uirust-site inventory -->")
    if start >= 0 and stop > start:
        document = current[:start] + "\n".join(output[1:]) + "\n" + current[stop:]
    else:
        document = "\n".join(output)
    target.write_text(document, encoding="utf-8", newline="\n")
    print(f"Inventaire généré : {len(rows)} fichiers dans docs/ui-rust-migration.md")


if __name__ == "__main__":
    main()
