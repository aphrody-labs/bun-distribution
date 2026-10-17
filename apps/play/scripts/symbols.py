# SPDX-License-Identifier: Apache-2.0
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.60.1", "brotli==1.1.0"]
# ///
"""Subset the Material Symbols Rounded variable font of @aphrody/m3-fonts to the icons play uses.

Usage: uv run --script apps/play/scripts/symbols.py <font.woff2> <out.woff2> <out.json> name...

Icons are resolved by their ligature name in the font's GSUB table, then kept by their Private
Use Area codepoint (no ligatures in the subset, so the DOM never carries icon names as text).
All variation axes (FILL, wght, GRAD, opsz) are kept: filled selected states and optical sizes.
"""

import json
import sys

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

source, out_font, out_json, *names = sys.argv[1:]
font = TTFont(source)
reverse_cmap = {}
for code, glyph in font.getBestCmap().items():
    reverse_cmap.setdefault(glyph, code)
char_glyph = {chr(code): glyph for code, glyph in font.getBestCmap().items() if code < 0x10000}

ligatures = {}
for lookup in font["GSUB"].table.LookupList.Lookup:
    for sub in lookup.SubTable:
        table = getattr(sub, "ExtSubTable", sub)
        for first, entries in (getattr(table, "ligatures", None) or {}).items():
            for lig in entries:
                ligatures[(first, *lig.Component)] = lig.LigGlyph

def glyph_for(name: str) -> str | None:
    key = tuple(char_glyph.get(ch) for ch in name)
    return ligatures.get(key)

codepoints = {}
missing = []
for name in names:
    glyph = glyph_for(name)
    code = reverse_cmap.get(glyph) if glyph else None
    if code is None:
        missing.append(name)
    else:
        codepoints[name] = code
if missing:
    sys.exit(f"Material Symbols names not found: {', '.join(missing)}")

options = Options()
options.flavor = "woff2"
options.layout_features = []
options.notdef_outline = True
options.name_IDs = ["*"]
subsetter = Subsetter(options)
subsetter.populate(unicodes=list(codepoints.values()))
subsetter.subset(font)
font.flavor = "woff2"
font.save(out_font)
with open(out_json, "w", encoding="utf-8") as handle:
    json.dump({name: f"{code:x}" for name, code in sorted(codepoints.items())}, handle, indent=2)
    handle.write("\n")
axes = [axis.axisTag for axis in font["fvar"].axes] if "fvar" in font else []
print(json.dumps({"icons": len(codepoints), "axes": axes}))
