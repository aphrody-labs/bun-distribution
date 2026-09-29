# SPDX-License-Identifier: Apache-2.0
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools==4.60.1", "brotli==1.1.0"]
# ///
"""Subset the @aphrody/m3-fonts sources into WOFF2 web fonts.

Run through `bun run subset` (which calls `uv run scripts/subset.py`). Reads the plan as JSON on
stdin, writes the WOFF2 files and prints the resulting faces (file + unicode-range) as JSON.

Plan entries:
  {"id", "source", "out", "ranges": [[lo, hi], ...]}                     -> one Latin face
  {"id", "source", "out", "ranges", "japanese": true, "chunk": N}         -> JP chunks: codepoints
      present in the font, restricted to kana/punctuation/full-width forms plus the ideographs of
      Windows-31J (JIS X 0208 levels 1-2 + NEC/IBM extensions), split into chunks of N codepoints.
"""

import json
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont


def options(hinting: bool) -> subset.Options:
    o = subset.Options()
    o.flavor = "woff2"
    o.hinting = hinting
    o.name_IDs = ["*"]  # keep copyright and OFL license strings
    o.name_languages = ["*"]
    o.notdef_outline = True
    o.layout_features = ["*"]  # variable-font feature variations, kerning, tabular figures, ccmp
    o.drop_tables += ["DSIG"]
    o.recalc_timestamp = False  # deterministic output
    return o


def cmap_of(path: Path) -> set[int]:
    font = TTFont(path, lazy=True)
    return set(font.getBestCmap().keys())


def in_ranges(cp: int, ranges: list[list[int]]) -> bool:
    return any(lo <= cp <= hi for lo, hi in ranges)


def is_windows31j_ideograph(cp: int) -> bool:
    ch = chr(cp)
    if not (0x3400 <= cp <= 0x9FFF or 0xF900 <= cp <= 0xFAFF):
        return False
    try:
        ch.encode("cp932")
        return True
    except UnicodeEncodeError:
        return False


def to_unicode_range(cps: list[int]) -> str:
    out: list[str] = []
    cps = sorted(cps)
    start = prev = cps[0]
    for cp in cps[1:] + [None]:  # type: ignore[list-item]
        if cp is not None and cp == prev + 1:
            prev = cp
            continue
        out.append(f"U+{start:04X}" if start == prev else f"U+{start:04X}-{prev:04X}")
        if cp is not None:
            start = prev = cp
    return ", ".join(out)


def write(source: Path, out: Path, cps: list[int], hinting: bool) -> int:
    opts = options(hinting)
    font = subset.load_font(str(source), opts)
    s = subset.Subsetter(opts)
    s.populate(unicodes=cps)
    s.subset(font)
    out.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(out), opts)
    return out.stat().st_size


def main() -> None:
    root = Path(sys.argv[1])
    plan = json.load(sys.stdin)
    result = []
    for entry in plan:
        source = root / entry["source"]
        cmap = cmap_of(source)
        ranges = entry["ranges"]
        if not entry.get("japanese"):
            cps = sorted(cp for cp in cmap if in_ranges(cp, ranges))
            out = root / entry["out"].format(n="")
            size = write(source, out, cps, hinting=True)
            result.append({"id": entry["id"], "file": entry["out"].format(n=""), "unicodeRange": to_unicode_range(cps), "bytes": size})
            continue
        base = sorted(cp for cp in cmap if in_ranges(cp, ranges))
        ideographs = sorted(cp for cp in cmap if is_windows31j_ideograph(cp))
        chunks = [base] + [ideographs[i : i + entry["chunk"]] for i in range(0, len(ideographs), entry["chunk"])]
        for n, cps in enumerate(chunks):
            rel = entry["out"].format(n=f"-{n:02d}")
            size = write(source, root / rel, cps, hinting=False)
            result.append({"id": entry["id"], "file": rel, "unicodeRange": to_unicode_range(cps), "bytes": size})
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
