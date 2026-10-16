#!/usr/bin/env python3
"""Famille d'icônes Material Symbols du pet Aphrody : grille 960, 24 dp, axe wght 100-700.

Chaque pose est détourée depuis son cadre de la spritesheet (silhouette et traits sombres).
Le trait est le décalage ±s/2 du contour : le nombre de points ne dépend pas du poids, ce qui
permet d'interpoler les masters wght sans artefacts.
"""

import hashlib
import json
import math
import pathlib
import shutil
import tempfile
from array import array

import numpy as np
from fontTools import varLib
from fontTools.designspaceLib import AxisDescriptor, DesignSpaceDocument, SourceDescriptor
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib.tables import ttProgram
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphCoordinates
from PIL import Image, ImageDraw, ImageFilter
from skimage import measure

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "symbols"
SHEET = ROOT.parents[2] / "crates" / "ui" / "identity" / "assets" / "aphrody" / "sprites" / "spritesheet.webp"
UPM = 960
FAMILY = "Aphrody Pet Symbols"
MAC_EPOCH_OFFSET = 2082844800
TIMESTAMP = 1767225600 + MAC_EPOCH_OFFSET
WEIGHT_STOPS = [(100, 36.0), (400, 72.0), (700, 104.0)]
SVG_WEIGHTS = [100, 300, 400, 500, 700]
ICO_SIZES = [16, 24, 32, 48, 256]
ICO_COLOR = (103, 80, 164)
STYLES = {
    "outlined": {"smooth": 0, "mitre": 4.0, "label": "Outlined"},
    "rounded": {"smooth": 3, "mitre": 4.0, "label": "Rounded"},
    "sharp": {"smooth": 0, "mitre": 2.0, "label": "Sharp"},
}

CELL_W, CELL_H = 192, 208
CELL_CENTER_X = 96
CELL_BASE_Y = 202
UNITS_PER_PX = 4.0
CENTER_X = 480
BASE_Y = 880
TRACE_SCALE = 4
TRACE_TOLERANCE = 1.2
TRACE_BLUR = 1.5
DARK_LUMA = 110
DETAIL_MIN_AREA = 2500
MIN_CONTOUR_POINTS = 6
POSES = {"idle": (0, 0), "wave": (2, 3), "run": (3, 7), "jump": (2, 4)}
STATE_ORDER = ["idle", "wave", "run", "jump"]
CODEPOINTS = {state: 0xE900 + index for index, state in enumerate(STATE_ORDER)}


def stroke_width(wght):
    (w0, v0), (w1, v1), (w2, v2) = WEIGHT_STOPS
    if wght <= w1:
        return v0 + (v1 - v0) * (wght - w0) / (w1 - w0)
    return v1 + (v2 - v1) * (wght - w1) / (w2 - w1)


def to_units(points):
    return [
        (
            CENTER_X + (x / TRACE_SCALE - CELL_CENTER_X) * UNITS_PER_PX,
            BASE_Y - (CELL_BASE_Y - y / TRACE_SCALE) * UNITS_PER_PX,
        )
        for y, x in points
    ]


def closed_contours(field, level):
    contours = []
    for contour in measure.find_contours(field, level):
        simplified = measure.approximate_polygon(contour, tolerance=TRACE_TOLERANCE)
        if len(simplified) >= MIN_CONTOUR_POINTS:
            contours.append(to_units(simplified[:-1]))
    return contours


def polygon_area(points):
    total = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        total += x0 * y1 - x1 * y0
    return abs(total) / 2


def trace_pose(col, row):
    cell = Image.open(SHEET).convert("RGBA").crop((col * CELL_W, row * CELL_H, (col + 1) * CELL_W, (row + 1) * CELL_H))
    alpha = cell.getchannel("A")
    size = (CELL_W * TRACE_SCALE, CELL_H * TRACE_SCALE)
    blur = ImageFilter.GaussianBlur(TRACE_SCALE * TRACE_BLUR)
    silhouette_field = alpha.resize(size, Image.BICUBIC).filter(blur)
    silhouette = closed_contours(np.asarray(silhouette_field, dtype=np.float32) / 255.0, 0.5)

    inside = alpha.point(lambda v: 255 if v >= 128 else 0).filter(ImageFilter.MinFilter(3))
    dark = cell.convert("L").point(lambda v: 255 if v < DARK_LUMA else 0)
    dark = Image.fromarray(np.minimum(np.asarray(dark), np.asarray(inside)).astype(np.uint8))
    dark_field = dark.resize(size, Image.BICUBIC).filter(blur)
    details = [c for c in closed_contours(np.asarray(dark_field, dtype=np.float32) / 255.0, 0.5) if polygon_area(c) >= DETAIL_MIN_AREA]
    return silhouette + details


STATES = {state: trace_pose(*POSES[state]) for state in STATE_ORDER}


def normal(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = max(math.hypot(dx, dy), 1e-9)
    return (-dy / length, dx / length)


def smooth(points, passes):
    for _ in range(passes):
        count = len(points)
        points = [
            (
                (points[i - 1][0] + 2 * points[i][0] + points[(i + 1) % count][0]) / 4,
                (points[i - 1][1] + 2 * points[i][1] + points[(i + 1) % count][1]) / 4,
            )
            for i in range(count)
        ]
    return points


def offset_closed(points, distance, mitre):
    count = len(points)
    result = []
    for i in range(count):
        prev, cur, nxt = points[i - 1], points[i], points[(i + 1) % count]
        n1 = normal(prev, cur)
        n2 = normal(cur, nxt)
        denom = 1 + n1[0] * n2[0] + n1[1] * n2[1]
        m = ((n1[0] + n2[0]) / denom, (n1[1] + n2[1]) / denom) if denom > 1e-6 else n1
        length = math.hypot(*m)
        if length > mitre:
            m = (m[0] * mitre / length, m[1] * mitre / length)
        result.append((cur[0] + m[0] * distance, cur[1] + m[1] * distance))
    return result


def band(points, half, spec):
    base = smooth(points, spec["smooth"])
    outer = offset_closed(base, half, spec["mitre"])
    inner = offset_closed(base, -half, spec["mitre"])
    inner.reverse()
    return [outer, inner]


def contours(state, style, wght):
    spec = STYLES[style]
    half = stroke_width(wght) / 2
    result = []
    for points in STATES[state]:
        result.extend(band(points, half, spec))
    return result


def simple_glyph(all_contours):
    coordinates, ends = [], []
    for contour in all_contours:
        coordinates.extend((round(x), round(UPM - y)) for x, y in contour)
        ends.append(len(coordinates) - 1)
    glyph = Glyph()
    glyph.numberOfContours = len(ends)
    glyph.endPtsOfContours = ends
    glyph.coordinates = GlyphCoordinates(coordinates)
    glyph.flags = array("B", [1] * len(coordinates))
    glyph.program = ttProgram.Program()
    glyph.program.fromBytecode(b"")
    glyph.recalcBounds(None)
    return glyph


def build_master(style, wght, path):
    label = STYLES[style]["label"]
    glyph_order = [".notdef"] + [f"pet_{state}" for state in STATE_ORDER]
    builder = FontBuilder(UPM, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap({CODEPOINTS[state]: f"pet_{state}" for state in STATE_ORDER})
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    for state in STATE_ORDER:
        glyphs[f"pet_{state}"] = simple_glyph(contours(state, style, wght))
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (UPM, 0) for name in glyph_order})
    builder.setupHorizontalHeader(ascent=UPM, descent=0)
    builder.setupNameTable({"familyName": f"{FAMILY} {label}", "styleName": f"Wght{wght}"})
    builder.setupOS2(sTypoAscender=UPM, sTypoDescender=0, usWinAscent=UPM, usWinDescent=0)
    builder.setupPost()
    builder.font["head"].created = TIMESTAMP
    builder.font["head"].modified = TIMESTAMP
    builder.font.recalcTimestamp = False
    builder.save(path)


def build_variable(style, out_dir):
    label = STYLES[style]["label"]
    work = pathlib.Path(tempfile.mkdtemp(prefix="pet-symbols-"))
    doc = DesignSpaceDocument()
    doc.addAxis(AxisDescriptor(tag="wght", name="Weight", minimum=100, default=400, maximum=700))
    for wght in (100, 400, 700):
        master = work / f"master-{style}-{wght}.ttf"
        build_master(style, wght, master)
        doc.addSource(SourceDescriptor(filename=str(master), path=str(master), location={"Weight": wght}))
    font = varLib.build(doc)[0]
    shutil.rmtree(work)
    font["head"].created = TIMESTAMP
    font["head"].modified = TIMESTAMP
    font.recalcTimestamp = False
    font.save(out_dir / f"AphrodyPetSymbols-{label}.ttf")
    font.flavor = "woff2"
    font.save(out_dir / f"AphrodyPetSymbols-{label}.woff2")


def fmt(value):
    text = f"{round(value, 1):.1f}".rstrip("0").rstrip(".")
    return text if text not in ("-0", "") else "0"


def svg_path(all_contours):
    parts = []
    for contour in all_contours:
        head, *tail = contour
        parts.append(f"M{fmt(head[0])} {fmt(head[1])}" + "".join(f"L{fmt(x)} {fmt(y)}" for x, y in tail) + "Z")
    return "".join(parts)


def write_svg(style, wght, state, path):
    d = svg_path(contours(state, style, wght))
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 960 960">'
        f'<path fill="currentColor" d="{d}"/></svg>\n'
    )
    path.write_text(svg, encoding="utf-8", newline="\n")


def signed_area(points):
    total = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        total += x0 * y1 - x1 * y0
    return total / 2


def raster(style, state, size):
    scale_factor = 4
    canvas = size * scale_factor
    winding = np.zeros((canvas, canvas), dtype=np.int32)
    for contour in contours(state, style, 400):
        mask = Image.new("L", (canvas, canvas), 0)
        ImageDraw.Draw(mask).polygon([(x * canvas / UPM, y * canvas / UPM) for x, y in contour], fill=255)
        sign = 1 if signed_area(contour) > 0 else -1
        winding += sign * (np.asarray(mask) > 127).astype(np.int32)
    coverage = Image.fromarray((np.clip(np.abs(winding), 0, 1) * 255).astype(np.uint8), "L")
    coverage = coverage.resize((size, size), Image.LANCZOS)
    image = Image.new("RGBA", (size, size), ICO_COLOR + (0,))
    image.putalpha(coverage)
    return image


def write_ico(style, state, path):
    raster(style, state, 256).save(path, format="ICO", sizes=[(s, s) for s in ICO_SIZES])


def write_css(path):
    lines = ["/* Généré par scripts/pet-symbols.py : ne pas éditer à la main. */"]
    for spec in STYLES.values():
        lines.append(
            f'@font-face {{ font-family: "{FAMILY} {spec["label"]}"; '
            f'src: url("../fonts/AphrodyPetSymbols-{spec["label"]}.woff2") format("woff2"); '
            "font-weight: 100 700; font-style: normal; font-display: block; }"
        )
    lines += [
        ".aphrody-pet-symbol {",
        "  display: inline-block; font-size: 24px; line-height: 1; width: 1em; height: 1em;",
        "  font-style: normal; font-weight: 400; white-space: nowrap; direction: ltr;",
        '  -webkit-font-smoothing: antialiased; font-feature-settings: "liga";',
        f'  font-family: "{FAMILY} Outlined";',
        '  font-variation-settings: "wght" var(--aphrody-pet-wght, 400);',
        "}",
        f'.aphrody-pet-symbol--rounded {{ font-family: "{FAMILY} Rounded"; }}',
        f'.aphrody-pet-symbol--sharp {{ font-family: "{FAMILY} Sharp"; }}',
    ]
    for state in STATE_ORDER:
        lines.append(f'.aphrody-pet-{state}::before {{ content: "\\{CODEPOINTS[state]:x}"; }}')
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    fonts = OUT / "fonts"
    svg_dir = OUT / "svg"
    ico_dir = OUT / "ico"
    css_dir = OUT / "css"
    for directory in (fonts, svg_dir, ico_dir, css_dir):
        directory.mkdir(parents=True)

    for style in STYLES:
        build_variable(style, fonts)

    for style in STYLES:
        for wght in SVG_WEIGHTS:
            folder = svg_dir / style / f"wght{wght}"
            folder.mkdir(parents=True)
            for state in STATE_ORDER:
                write_svg(style, wght, state, folder / f"pet_{state}.svg")

    for style in STYLES:
        folder = ico_dir / style
        folder.mkdir(parents=True)
        for state in STATE_ORDER:
            write_ico(style, state, folder / f"pet_{state}.ico")

    write_css(css_dir / "aphrody-pet-symbols.css")

    index = {
        "family": FAMILY,
        "unitsPerEm": UPM,
        "grid": {"viewBox": 960, "dp": 24},
        "axes": {"wght": {"min": 100, "default": 400, "max": 700}},
        "styles": {style: spec["label"] for style, spec in STYLES.items()},
        "svgWeights": SVG_WEIGHTS,
        "icoSizes": ICO_SIZES,
        "icons": [{"name": f"pet_{state}", "codepoint": f"U+{CODEPOINTS[state]:04X}"} for state in STATE_ORDER],
    }
    (OUT / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    files = sorted(path for path in OUT.rglob("*") if path.is_file() and path.name != "manifest.json")
    manifest = {str(path.relative_to(OUT)).replace("\\", "/"): sha256(path) for path in files}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
