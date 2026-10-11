# SPDX-License-Identifier: Apache-2.0
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.60.1", "brotli==1.1.0", "pillow==11.3.0"]
# ///
"""Material Symbols -> Windows-ready assets.

Usage: uv run scripts/material-icons-raster.py <ttf-out-dir> <png-out-dir>

Writes the index src/material-symbols-index.json (name -> PUA codepoint per style, from the
woff2 cmap), converts each woff2 style to TrueType in <ttf-out-dir> (GDI/DirectWrite do not read
WOFF2), and renders every outlined glyph to <png-out-dir>/<size>/<name>.png for the ICO packer
(scripts/windows-material.ts). Icons are rendered in one neutral colour for shell use.
"""

import json
import re
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

PKG = Path(__file__).resolve().parent.parent
FONTS = PKG / "fonts" / "upstream" / "material-symbols"
STYLES = ["outlined", "rounded", "sharp"]
SIZES = [16, 24, 32, 48, 256]
RENDER_RGBA = (0x67, 0x50, 0xA4, 255)
RUST_SYMBOLS = PKG.parent.parent.parent / "crates" / "ui" / "bun" / "src" / "symbols.rs"


def norm(glyph: str) -> str:
    return re.sub(r"^_(?=\d)", "", glyph)


def build_index() -> dict:
    per: dict[str, dict[str, int]] = {}
    for style in STYLES:
        cmap = TTFont(FONTS / f"material-symbols-{style}.woff2").getBestCmap()
        table: dict[str, int] = {}
        for cp, glyph in sorted(cmap.items()):
            if 0xE000 <= cp <= 0xF8FF and not glyph.endswith(".fill"):
                table.setdefault(norm(glyph), cp)
        per[style] = table
    icons = {
        name: {style: format(per[style][name], "X") for style in STYLES if name in per[style]}
        for name in sorted(set().union(*per.values()))
    }
    catalog = re.findall(r'^\s+"([^"]+)",', RUST_SYMBOLS.read_text(encoding="utf-8"), re.M)
    return {
        "source": "material-symbols woff2 cmap (outlined, rounded, sharp); PUA codepoints; digit-prefixed glyphs normalized",
        "catalogOnly": sorted(set(catalog) - set(icons)),
        "icons": icons,
    }


def main() -> None:
    ttf_dir = Path(sys.argv[1])
    png_dir = Path(sys.argv[2])
    ttf_dir.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        (png_dir / str(size)).mkdir(parents=True, exist_ok=True)

    index = build_index()
    (PKG / "src" / "material-symbols-index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    for style in STYLES:
        font = TTFont(FONTS / f"material-symbols-{style}.woff2")
        font.flavor = None
        font.save(ttf_dir / f"MaterialSymbols{style.capitalize()}.ttf")

    face = ImageFont.truetype(str(ttf_dir / "MaterialSymbolsOutlined.ttf"), 256)
    rendered = 0
    for name, entry in index["icons"].items():
        if "outlined" not in entry:
            continue
        canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        ImageDraw.Draw(canvas).text(
            (128, 128), chr(int(entry["outlined"], 16)), font=face, fill=RENDER_RGBA, anchor="mm"
        )
        if canvas.getbbox() is None:
            continue
        for size in SIZES:
            frame = canvas if size == 256 else canvas.resize((size, size), Image.LANCZOS)
            frame.save(png_dir / str(size) / f"{name}.png", optimize=True)
        rendered += 1
    print(json.dumps({"icons": len(index["icons"]), "catalogOnly": len(index["catalogOnly"]), "rendered": rendered}))


if __name__ == "__main__":
    main()
