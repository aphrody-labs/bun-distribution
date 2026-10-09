# /// script
# requires-python = ">=3.12"
# dependencies = ["fonttools[woff]>=4.50", "brotli>=1.1", "pillow>=11"]
# ///
"""Generate the Aphrody Codex symbol set as a Material Symbols companion family."""

import hashlib
import io
import json
import re
import shutil
import struct
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image, ImageChops, ImageDraw

PKG = Path(__file__).resolve().parents[1]
UPSTREAM = PKG / "fonts/upstream/material-symbols"
OUT = PKG / "codex"
SOURCE_BRAND = OUT / "source/brand-codex.svg"
INDEX = PKG / "src/material-symbols-index.json"

STYLES = {"outlined": "Outlined", "rounded": "Rounded", "sharp": "Sharp"}
UPSTREAM_FILES = {
    "outlined": "material-symbols-outlined.woff2",
    "rounded": "material-symbols-rounded.woff2",
    "sharp": "material-symbols-sharp.woff2",
}
NAMES = [
    "add", "bolt", "call_split", "check", "close", "compress", "content_copy",
    "delete_sweep", "description", "edit", "edit_document", "gavel", "history",
    "keyboard", "language", "lightbulb", "model_training", "palette", "public",
    "refresh", "save", "search", "search_insights", "settings", "smart_toy",
    "track_changes",
]
WEIGHTS = [100, 300, 400, 500, 700]
FILLS = [0, 1]
GRADES = [-25, 0, 200]
OPSZ = [20, 24, 40, 48]
ICO_SIZES = [16, 24, 32, 48, 256]
ICO_OPSZ = {16: 20, 24: 24, 32: 24, 48: 48, 256: 48}
ICO_COLOR = (0x67, 0x50, 0xA4)
SUPERSAMPLE = 4
FLAT_STEPS = 10


class Flattener(BasePen):
    def __init__(self, glyph_set):
        super().__init__(glyph_set)
        self.contours = []
        self._cur = None

    def _moveTo(self, pt):
        self._cur = [pt]

    def _lineTo(self, pt):
        self._cur.append(pt)

    def _curveToOne(self, p1, p2, p3):
        p0 = self._cur[-1]
        for i in range(1, FLAT_STEPS + 1):
            t = i / FLAT_STEPS
            u = 1 - t
            self._cur.append((
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
            ))

    def _qCurveToOne(self, p1, p2):
        p0 = self._cur[-1]
        for i in range(1, FLAT_STEPS + 1):
            t = i / FLAT_STEPS
            u = 1 - t
            self._cur.append((
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
            ))

    def _closePath(self):
        if self._cur and len(self._cur) > 2:
            self.contours.append(self._cur)
        self._cur = None

    _endPath = _closePath


def glyph_outline(font, glyph_name):
    glyph_set = font.getGlyphSet()
    pen = Flattener(glyph_set)
    glyph_set[glyph_name].draw(pen)
    return pen.contours, glyph_set[glyph_name].width


def metrics(font):
    return font["head"].unitsPerEm, font["hhea"].ascent, font["hhea"].descent


def num(value):
    return f"{round(value, 2):g}"


def glyph_svg(font, glyph_name):
    _, asc, desc = metrics(font)
    glyph_set = font.getGlyphSet()
    pen = SVGPathPen(glyph_set, ntos=num)
    glyph_set[glyph_name].draw(TransformPen(pen, (1, 0, 0, -1, 0, 0)))
    width = glyph_set[glyph_name].width
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {-asc} {width} {asc - desc}" '
        f'width="24" height="24"><path fill="currentColor" d="{pen.getCommands()}"/></svg>\n'
    )


def rasterize(contours, width, asc, desc, size, rgb):
    box_h = asc - desc
    scale = size / max(width, box_h)
    ox = (size - width * scale) / 2
    oy = (size - box_h * scale) / 2
    px = size * SUPERSAMPLE
    acc = Image.new("1", (px, px), 0)
    for contour in contours:
        pts = [
            ((x * scale + ox) * SUPERSAMPLE, ((asc - y) * scale + oy) * SUPERSAMPLE)
            for x, y in contour
        ]
        mask = Image.new("1", (px, px), 0)
        ImageDraw.Draw(mask).polygon(pts, fill=1)
        acc = ImageChops.logical_xor(acc, mask)
    alpha = acc.convert("L").resize((size, size), Image.Resampling.BOX)
    out = Image.new("RGBA", (size, size), rgb + (0,))
    out.putalpha(alpha)
    return out


def brand_geometry():
    text = SOURCE_BRAND.read_text(encoding="utf-8")
    view = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', text)
    width, height = float(view.group(1)), float(view.group(2))
    d = re.search(r' d="([^"]+)"', text).group(1)
    tokens = re.findall(r"[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?", d)
    contours, cur, cmd, x, y, i = [], None, None, 0.0, 0.0, 0
    while i < len(tokens):
        t = tokens[i]
        if t == "Z":
            if cur and len(cur) > 2:
                contours.append(cur)
            cur = None
            i += 1
        elif t in ("M", "L", "C"):
            cmd = t
            i += 1
        elif cmd == "M":
            x, y = float(tokens[i]), float(tokens[i + 1])
            i += 2
            cur = [(x, y)]
            cmd = "L"
        elif cmd == "L":
            x, y = float(tokens[i]), float(tokens[i + 1])
            i += 2
            cur.append((x, y))
        else:
            x1, y1, x2, y2, x3, y3 = (float(v) for v in tokens[i:i + 6])
            i += 6
            p0 = cur[-1]
            for step in range(1, FLAT_STEPS + 1):
                t_ = step / FLAT_STEPS
                u = 1 - t_
                cur.append((
                    u**3 * p0[0] + 3 * u * u * t_ * x1 + 3 * u * t_ * t_ * x2 + t_**3 * x3,
                    u**3 * p0[1] + 3 * u * u * t_ * y1 + 3 * u * t_ * t_ * y2 + t_**3 * y3,
                ))
            x, y = x3, y3
    flipped = [[(px, -py) for px, py in contour] for contour in contours]
    return d, width, height, flipped


def ico_bytes(entries):
    header = struct.pack("<HHH", 0, 1, len(entries))
    directory = b""
    data = b""
    offset = 6 + 16 * len(entries)
    for size, png in entries:
        dim = 0 if size >= 256 else size
        directory += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
        data += png
    return header + directory + data


def png_bytes(image):
    buf = io.BytesIO()
    image.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8", newline="\n")


def build_font(style, codepoints, glyph_names_out):
    family = f"Aphrody Codex Symbols {STYLES[style]}"
    stem = f"AphrodyCodexSymbols-{STYLES[style]}"
    postscript = family.replace(" ", "") + "-Regular"
    (OUT / "fonts").mkdir(parents=True, exist_ok=True)
    for flavor in ("ttf", "woff2"):
        font = TTFont(UPSTREAM / UPSTREAM_FILES[style], recalcTimestamp=False)
        options = Options()
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.notdef_outline = True
        options.hinting = False
        subsetter = Subsetter(options)
        subsetter.populate(unicodes=codepoints)
        subsetter.subset(font)
        name = font["name"]
        for name_id in (1, 2, 3, 4, 6, 16, 17):
            name.removeNames(nameID=name_id)
        for name_id, value in (
            (1, family),
            (2, "Regular"),
            (3, f"{postscript};1.0"),
            (4, f"{family} Regular"),
            (6, postscript),
        ):
            name.setName(value, name_id, 3, 1, 0x409)
            name.setName(value, name_id, 1, 0, 0)
        if flavor == "woff2":
            font.flavor = "woff2"
        font.save(OUT / "fonts" / f"{stem}.{flavor}")
    font = TTFont(OUT / "fonts" / f"{stem}.ttf", recalcTimestamp=False)
    cmap = font.getBestCmap()
    glyph_names_out.update({cp: cmap[cp] for cp in codepoints})


def instance(font_path, wght, fill, grade, opsz):
    return instancer.instantiateVariableFont(
        TTFont(font_path, recalcTimestamp=False),
        {"wght": wght, "FILL": fill, "GRAD": grade, "opsz": opsz},
    )


def main():
    for sub in ("fonts", "svg", "ico", "css"):
        shutil.rmtree(OUT / sub, ignore_errors=True)

    icons = json.loads(INDEX.read_text(encoding="utf-8"))["icons"]
    missing = [n for n in NAMES if n not in icons or any(s not in icons[n] for s in STYLES)]
    if missing:
        raise SystemExit(f"icons missing from Material index: {missing}")

    brand_d, brand_w, brand_h, brand_contours = brand_geometry()
    write(
        OUT / "svg/brand/aphrody-codex.svg",
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {brand_w:g} {brand_h:g}" '
        f'width="24" height="24"><path fill="currentColor" fill-rule="evenodd" d="{brand_d}"/></svg>\n',
    )
    brand_size_entries = [
        (size, png_bytes(rasterize(brand_contours, brand_w, 0, -brand_h, size, ICO_COLOR)))
        for size in ICO_SIZES
    ]
    write(OUT / "ico/brand/aphrody-codex.ico", ico_bytes(brand_size_entries))

    for style in STYLES:
        codepoints = sorted({int(icons[n][style], 16) for n in NAMES})
        glyph_map = {}
        build_font(style, codepoints, glyph_map)
        font_path = OUT / "fonts" / f"AphrodyCodexSymbols-{STYLES[style]}.ttf"
        glyph_names = {n: glyph_map[int(icons[n][style], 16)] for n in NAMES}

        for wght in WEIGHTS:
            for fill in FILLS:
                for grade in GRADES:
                    for opsz in OPSZ:
                        font = instance(font_path, wght, fill, grade, opsz)
                        for name in NAMES:
                            write(
                                OUT / "svg" / style / f"{name}--w{wght}-f{fill}-g{grade}-o{opsz}.svg",
                                glyph_svg(font, glyph_names[name]),
                            )

        instances = {opsz: instance(font_path, 400, 0, 0, opsz) for opsz in set(ICO_OPSZ.values())}
        for name in NAMES:
            entries = []
            for size in ICO_SIZES:
                font = instances[ICO_OPSZ[size]]
                contours, width = glyph_outline(font, glyph_names[name])
                _, asc, desc = metrics(font)
                entries.append((size, png_bytes(rasterize(contours, width, asc, desc, size, ICO_COLOR))))
            write(OUT / "ico" / style / f"{name}.ico", ico_bytes(entries))

    css = [
        "/* SPDX-License-Identifier: Apache-2.0 */",
        "/* Generated by packages/m3-fonts/scripts/codex-symbols.py; do not edit. */",
    ]
    for style, label in STYLES.items():
        css.append(
            f'@font-face {{\n  font-family: "Aphrody Codex Symbols {label}";\n'
            f'  src: url("../fonts/AphrodyCodexSymbols-{label}.woff2") format("woff2");\n'
            "  font-weight: 100 700;\n  font-style: normal;\n  font-display: block;\n}\n"
        )
    css.append(
        ".aphrody-codex-symbol {\n"
        "  display: inline-block;\n  font-style: normal;\n  font-weight: 400;\n"
        "  line-height: 1;\n  letter-spacing: normal;\n  text-transform: none;\n"
        "  white-space: nowrap;\n  direction: ltr;\n  -webkit-font-smoothing: antialiased;\n"
        "  font-size: var(--aphrody-codex-size, 24px);\n"
        '  font-variation-settings: "FILL" var(--aphrody-codex-fill, 0), '
        '"wght" var(--aphrody-codex-wght, 400), "GRAD" var(--aphrody-codex-grad, 0), '
        '"opsz" var(--aphrody-codex-opsz, 24);\n}\n'
    )
    for style, label in STYLES.items():
        css.append(
            f'.aphrody-codex-symbol--{style} {{ font-family: "Aphrody Codex Symbols {label}"; }}'
        )
    for style in STYLES:
        for name in NAMES:
            cp = icons[name][style]
            css.append(
                f'.aphrody-codex-symbol--{style}.aphrody-codex-symbol--{name}::before {{ content: "\\{cp.lower()}"; }}'
            )
    css.append(
        ".aphrody-codex-brand {\n  display: inline-block;\n"
        "  width: var(--aphrody-codex-size, 24px);\n  height: var(--aphrody-codex-size, 24px);\n"
        "  background-color: currentColor;\n"
        '  -webkit-mask: url("../svg/brand/aphrody-codex.svg") center / contain no-repeat;\n'
        '  mask: url("../svg/brand/aphrody-codex.svg") center / contain no-repeat;\n}\n'
    )
    write(OUT / "css/aphrody-codex-symbols.css", "\n".join(css))

    index = {
        "family": "Aphrody Codex Symbols",
        "base": "Material Symbols variable fonts (Apache-2.0), axes preserved",
        "styles": list(STYLES),
        "axes": {"wght": [100, 700], "FILL": [0, 1], "GRAD": [-50, 200], "opsz": [20, 48]},
        "variants": {"wght": WEIGHTS, "fill": FILLS, "grade": GRADES, "opsz": OPSZ},
        "icons": {n: {s: icons[n][s] for s in STYLES} for n in NAMES},
        "ico": {"sizes": ICO_SIZES, "opsz": {str(k): v for k, v in ICO_OPSZ.items()}},
        "brand": {"svg": "svg/brand/aphrody-codex.svg", "ico": "ico/brand/aphrody-codex.ico", "static": True},
    }
    write(OUT / "index.json", json.dumps(index, indent=2, sort_keys=True) + "\n")

    digests = {}
    for path in sorted(OUT.rglob("*")):
        if path.is_file() and path.name != "manifest.json":
            digests[path.relative_to(OUT).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    write(OUT / "manifest.json", json.dumps(digests, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
