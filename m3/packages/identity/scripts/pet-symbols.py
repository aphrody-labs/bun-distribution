#!/usr/bin/env python3
"""Famille d'icônes Material Symbols du pet Aphrody : grille 960, 24 dp, axe wght 100-700.

Chaque trait est converti en contour à topologie fixe : le nombre de points ne dépend
pas du poids, ce qui permet d'interpoler les masters wght sans artefacts.
"""

import hashlib
import json
import math
import pathlib
import shutil
import tempfile

import numpy as np
from fontTools import varLib
from fontTools.designspaceLib import AxisDescriptor, DesignSpaceDocument, SourceDescriptor
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "symbols"
UPM = 960
FAMILY = "Aphrody Pet Symbols"
MAC_EPOCH_OFFSET = 2082844800
TIMESTAMP = 1767225600 + MAC_EPOCH_OFFSET
WEIGHT_STOPS = [(100, 36.0), (400, 72.0), (700, 104.0)]
SVG_WEIGHTS = [100, 300, 400, 500, 700]
ICO_SIZES = [16, 24, 32, 48, 256]
ICO_COLOR = (103, 80, 164)
ARC_STEPS = 6
RING_STEPS = 72
STYLES = {
    "outlined": {"cap": "flat", "join": "mitre", "mitre": 4.0, "label": "Outlined"},
    "rounded": {"cap": "round", "join": "round", "mitre": 4.0, "label": "Rounded"},
    "sharp": {"cap": "square", "join": "mitre", "mitre": 2.0, "label": "Sharp"},
}


def ring(cx, cy, r):
    return ("ring", (cx, cy, r))


def line(*points):
    return ("line", list(points))


def translate(items, dx, dy):
    moved = []
    for kind, data in items:
        if kind == "ring":
            cx, cy, r = data
            moved.append(("ring", (cx + dx, cy + dy, r)))
        else:
            moved.append(("line", [(x + dx, y + dy) for x, y in data]))
    return moved


HEAD = [
    ring(480, 200, 112),
    line((372, 176), (398, 118), (480, 96), (562, 118), (588, 176)),
    line((372, 190), (360, 300), (396, 392)),
    line((588, 190), (600, 300), (564, 392)),
]

TORSO = [
    line((398, 345), (480, 372), (562, 345)),
    line((430, 350), (540, 500)),
    line((372, 520), (588, 520)),
    line((372, 520), (360, 640), (600, 640), (588, 520)),
]

LEFT_ARM_DOWN = [line((398, 345), (340, 430), (330, 560))]
RIGHT_ARM_DOWN = [line((562, 345), (620, 430), (630, 560))]
RIGHT_ARM_UP = [line((562, 345), (620, 260), (640, 170)), line((612, 136), (640, 100), (666, 134))]

LEGS = [
    line((430, 640), (428, 790)),
    line((530, 640), (532, 790)),
    line((405, 820), (455, 820)),
    line((505, 820), (555, 820)),
]

STATES = {
    "idle": HEAD + TORSO + LEFT_ARM_DOWN + RIGHT_ARM_DOWN + LEGS,
    "wave": HEAD + TORSO + LEFT_ARM_DOWN + RIGHT_ARM_UP + LEGS,
    "run": translate(HEAD, 40, 0)
    + translate(TORSO, 30, 0)
    + [
        line((430, 360), (360, 420), (300, 380)),
        line((560, 360), (630, 400), (690, 340)),
        line((470, 640), (340, 700), (250, 690)),
        line((540, 640), (620, 740), (700, 790)),
    ],
    "jump": translate(HEAD, 0, -12)
    + TORSO
    + [
        line((398, 345), (340, 260), (330, 180)),
        line((562, 345), (620, 260), (630, 180)),
        line((440, 640), (400, 720), (430, 790)),
        line((520, 640), (560, 720), (530, 790)),
        line((400, 812), (440, 812)),
        line((520, 812), (560, 812)),
    ],
}

STATE_ORDER = ["idle", "wave", "run", "jump"]
CODEPOINTS = {state: 0xE900 + index for index, state in enumerate(STATE_ORDER)}


def stroke_width(wght):
    (w0, v0), (w1, v1), (w2, v2) = WEIGHT_STOPS
    if wght <= w1:
        return v0 + (v1 - v0) * (wght - w0) / (w1 - w0)
    return v1 + (v2 - v1) * (wght - w1) / (w2 - w1)


def add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def scale(v, k):
    return (v[0] * k, v[1] * k)


def unit(v):
    length = math.hypot(v[0], v[1])
    return (v[0] / length, v[1] / length)


def signed_area(points):
    total = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        total += x0 * y1 - x1 * y0
    return total / 2


def join_points(p, na, nb, half, outer, spec):
    dot = na[0] * nb[0] + na[1] * nb[1]
    if outer and spec["join"] == "round":
        a0 = math.atan2(na[1], na[0])
        a1 = math.atan2(nb[1], nb[0])
        delta = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        return [
            (p[0] + half * math.cos(a0 + delta * k / ARC_STEPS), p[1] + half * math.sin(a0 + delta * k / ARC_STEPS))
            for k in range(ARC_STEPS + 1)
        ]
    ratio = math.sqrt(2 / (1 + dot)) if dot > -1 else float("inf")
    if ratio > spec["mitre"]:
        return [add(p, scale(na, half)), add(p, scale(nb, half))]
    miter = scale(add(na, nb), 1 / (1 + dot))
    return [add(p, scale(miter, half))]


def side_path(points, dirs, norms, half, sign, spec):
    n = len(points)
    path = []
    for i, p in enumerate(points):
        if i == 0:
            path.append(add(p, scale(norms[0], sign * half)))
        elif i == n - 1:
            path.append(add(p, scale(norms[-1], sign * half)))
        else:
            d0, d1 = dirs[i - 1], dirs[i]
            cross = d0[0] * d1[1] - d0[1] * d1[0]
            outer = cross * sign < 0
            na = scale(norms[i - 1], sign)
            nb = scale(norms[i], sign)
            path.extend(join_points(p, na, nb, half, outer, spec))
    return path


def end_cap(p, n, d, half, spec):
    if spec["cap"] == "square":
        return [add(add(p, scale(n, half)), scale(d, half)), add(add(p, scale(n, -half)), scale(d, half))]
    if spec["cap"] == "round":
        return [
            add(p, (half * (math.cos(math.pi * k / ARC_STEPS) * n[0] + math.sin(math.pi * k / ARC_STEPS) * d[0]),
                    half * (math.cos(math.pi * k / ARC_STEPS) * n[1] + math.sin(math.pi * k / ARC_STEPS) * d[1])))
            for k in range(1, ARC_STEPS)
        ]
    return []


def start_cap(p, n, d, half, spec):
    if spec["cap"] == "square":
        return [add(add(p, scale(n, -half)), scale(d, -half)), add(add(p, scale(n, half)), scale(d, -half))]
    if spec["cap"] == "round":
        points = []
        for k in range(ARC_STEPS - 1, 0, -1):
            a = math.pi * k / ARC_STEPS
            points.append(
                (p[0] + half * (math.cos(a) * n[0] - math.sin(a) * d[0]),
                 p[1] + half * (math.cos(a) * n[1] - math.sin(a) * d[1]))
            )
        return points
    return []


def stroke_contour(points, half, spec):
    dirs = [unit((points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1])) for i in range(len(points) - 1)]
    norms = [(-d[1], d[0]) for d in dirs]
    left = side_path(points, dirs, norms, half, +1, spec)
    right = side_path(points, dirs, norms, half, -1, spec)
    contour = left + end_cap(points[-1], norms[-1], dirs[-1], half, spec)
    contour += list(reversed(right)) + start_cap(points[0], norms[0], dirs[0], half, spec)
    if signed_area(contour) < 0:
        contour.reverse()
    return contour


def ring_contours(cx, cy, r, half):
    outer = [(cx + (r + half) * math.cos(2 * math.pi * i / RING_STEPS), cy + (r + half) * math.sin(2 * math.pi * i / RING_STEPS)) for i in range(RING_STEPS)]
    inner = [(cx + (r - half) * math.cos(2 * math.pi * i / RING_STEPS), cy + (r - half) * math.sin(2 * math.pi * i / RING_STEPS)) for i in range(RING_STEPS)]
    if signed_area(outer) < 0:
        outer.reverse()
    if signed_area(inner) > 0:
        inner.reverse()
    return [outer, inner]


def contours(state, style, wght):
    spec = STYLES[style]
    half = stroke_width(wght) / 2
    result = []
    for kind, data in STATES[state]:
        if kind == "ring":
            result.extend(ring_contours(*data, half))
        else:
            result.append(stroke_contour(data, half, spec))
    return result


def build_master(style, wght, path):
    label = STYLES[style]["label"]
    glyph_order = [".notdef"] + [f"pet_{state}" for state in STATE_ORDER]
    builder = FontBuilder(UPM, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap({CODEPOINTS[state]: f"pet_{state}" for state in STATE_ORDER})
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    for state in STATE_ORDER:
        pen = TTGlyphPen(None)
        for contour in contours(state, style, wght):
            points = [(round(x), round(UPM - y)) for x, y in contour]
            pen.moveTo(points[0])
            for point in points[1:]:
                pen.lineTo(point)
            pen.closePath()
        glyphs[f"pet_{state}"] = pen.glyph()
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
