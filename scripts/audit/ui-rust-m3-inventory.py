#!/usr/bin/env python3
"""Generate the exhaustive source inventory for the M3 Rust migration."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / "docs/ui-rust-migration.md"
START = "<!-- BEGIN GENERATED M3 INVENTORY -->"
END = "<!-- END GENERATED M3 INVENTORY -->"
EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".html", ".css"}


def role(path: Path) -> str:
    parts = path.parts
    name = path.name.lower()
    if "templates" in parts:
        return "template / scaffold"
    if "apps" in parts:
        return "application surface"
    if any(word in name for word in ("test", "spec", "fixture")) or "__tests__" in parts:
        return "test / fixture"
    if path.suffix == ".css":
        return "styles / tokens"
    if path.suffix == ".html":
        return "document / template"
    return "framework source / tooling"


def target(path: Path) -> str:
    name = path.name.lower()
    if "tokens" in str(path):
        return "crates/ui/m3-tokens + crates/ui/m3/src/theme.rs"
    if "theme" in name or "color" in name:
        return "crates/ui/m3/src/theme.rs"
    if "form" in name or "input" in name:
        return "crates/ui/m3/src/components.rs (forms)"
    if "motion" in name or "animation" in name:
        return "crates/ui/m3/src/components.rs (motion contract)"
    if "icon" in name:
        return "crates/ui/m3/src/components.rs (facade::icons)"
    if "layout" in name or "grid" in name:
        return "crates/ui/m3/src/layout.rs"
    return "crates/ui/m3/src/components.rs; host adapter TBD"


def main() -> None:
    files = sorted(
        path.relative_to(ROOT)
        for surface in (ROOT / "m3/packages", ROOT / "m3/apps", ROOT / "m3/templates")
        if surface.exists()
        for path in surface.rglob("*")
        if path.is_file() and path.suffix.lower() in EXTENSIONS
    )
    rows = [START, "", f"Fichiers inventoriés : **{len(files)}**. Chaque ligne représente un fichier source; l’état `à migrer` signifie qu’aucune parité Rust n’est revendiquée.", "", "| Fichier | Surface | Rôle | Cible Rust | État |", "|---|---|---|---|---|"]
    for path in files:
        rel = path.as_posix()
        surface = rel.split("/", 2)[1]
        rows.append(f"| `{rel}` | `{surface}` | {role(path)} | `{target(path)}` | à migrer |")
    rows.extend(["", END])
    generated = "\n".join(rows)

    content = DOC.read_text() if DOC.exists() else "<!-- SPDX-License-Identifier: Apache-2.0 -->\n# Migration de l’UI vers Rust\n\nInventaire exhaustif généré par `python3 scripts/audit/ui-rust-m3-inventory.py`. Les autres lots maintiennent leurs sections hors du bloc généré M3.\n\n"
    if START in content and END in content:
        before, rest = content.split(START, 1)
        _, after = rest.split(END, 1)
        content = before.rstrip() + "\n\n" + generated + after
    else:
        content = content.rstrip() + "\n\n" + generated + "\n"
    DOC.write_text(content)
    print(f"Inventaire M3 écrit : {len(files)} fichiers dans {DOC.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
