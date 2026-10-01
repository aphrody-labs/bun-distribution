#!/usr/bin/env python3
"""
Mesure une forme dans une image de référence : boîte, ratio, palette, tons,
profil de silhouette. C'est l'étape qui remplace « à peu près comme ça » par
des nombres qu'on peut citer et rejouer.

Dépendances : Pillow + numpy uniquement (`sudo apt-get install -y python3-pil
python3-numpy` — beaucoup de VPS n'ont ni pip ni ensurepip). Pas de
scikit-learn : le k-means tient en vingt lignes et évite une installation.

Usage :
  python3 mesurer.py IMAGE --teinte 40 70 --sat 0.35 --val 0.45
  python3 mesurer.py IMAGE --boite 405 638 1229 1079      # ROI connue
  python3 mesurer.py IMAGE --sombre                        # trait d'encre
Options utiles :
  --k N          nombre de couleurs de la palette (défaut 5)
  --sortie DIR   où écrire masque.png, decoupe.png, mesures.json (défaut /tmp/mesures)
  --json         n'imprime que le JSON (pour un pipe)

Le masque par défaut sélectionne les pixels colorés et clairs ; `--sombre`
sélectionne au contraire les pixels d'encre, ce qui sert à mesurer l'épaisseur
du trait. Les deux passent par la même chaîne : plus grande composante connexe,
puis rebouchage des trous par remplissage depuis le bord (sinon un personnage
assis dans la forme creuse un trou et fausse l'aire).
"""
import argparse
import colorsys
import json
import os
import sys

import numpy as np
from PIL import Image


def charger(chemin):
    im = Image.open(chemin).convert("RGB")
    return im, np.asarray(im).astype(np.float64) / 255.0


def masque_teinte(rgb, teinte, sat_min, val_min):
    """Masque HSV vectorisé : garde les pixels dans la plage de teinte donnée."""
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    diff = mx - mn
    sat = np.where(mx > 0, diff / np.maximum(mx, 1e-9), 0.0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.zeros_like(mx)
    d = np.maximum(diff, 1e-9)
    h = np.where(mx == r, ((g - b) / d) % 6, h)
    h = np.where(mx == g, (b - r) / d + 2, h)
    h = np.where(mx == b, (r - g) / d + 4, h)
    h = h * 60.0
    h0, h1 = teinte
    dans = (h >= h0) & (h <= h1) if h0 <= h1 else ((h >= h0) | (h <= h1))
    return dans & (sat >= sat_min) & (mx >= val_min)


def masque_sombre(rgb, seuil):
    """Pixels d'encre : luminance sous le seuil."""
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    return lum <= seuil


def plus_grande_composante(m):
    """BFS itératif sur le masque booléen ; renvoie la plus grosse région."""
    h, w = m.shape
    vu = np.zeros_like(m, dtype=bool)
    meilleure = None
    taille_max = 0
    pile = []
    for y0 in range(h):
        for x0 in range(w):
            if not m[y0, x0] or vu[y0, x0]:
                continue
            pile.append((y0, x0))
            vu[y0, x0] = True
            region = []
            while pile:
                y, x = pile.pop()
                region.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not vu[ny, nx]:
                        vu[ny, nx] = True
                        pile.append((ny, nx))
            if len(region) > taille_max:
                taille_max = len(region)
                meilleure = region
    out = np.zeros_like(m)
    if meilleure:
        ys, xs = zip(*meilleure)
        out[np.array(ys), np.array(xs)] = True
    return out


def boucher_trous(m):
    """Remplit depuis le bord : tout ce que l'extérieur n'atteint pas est intérieur."""
    h, w = m.shape
    dehors = np.zeros_like(m)
    pile = []
    for x in range(w):
        for y in (0, h - 1):
            if not m[y, x] and not dehors[y, x]:
                dehors[y, x] = True
                pile.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not m[y, x] and not dehors[y, x]:
                dehors[y, x] = True
                pile.append((y, x))
    while pile:
        y, x = pile.pop()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not m[ny, nx] and not dehors[ny, nx]:
                dehors[ny, nx] = True
                pile.append((ny, nx))
    return ~dehors


def kmeans(pixels, k, iters=40, graine=7):
    """k-means écrit à la main — scikit-learn n'est pas installé et ne le sera pas."""
    rng = np.random.default_rng(graine)
    echantillon = pixels[rng.choice(len(pixels), min(len(pixels), 30000), replace=False)]
    centres = echantillon[rng.choice(len(echantillon), k, replace=False)].copy()
    for _ in range(iters):
        d = ((echantillon[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
        aff = d.argmin(axis=1)
        for i in range(k):
            pris = echantillon[aff == i]
            if len(pris):
                centres[i] = pris.mean(axis=0)
    d = ((echantillon[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
    aff = d.argmin(axis=1)
    parts = [(aff == i).sum() / len(aff) for i in range(k)]
    ordre = np.argsort(parts)[::-1]
    return [(centres[i], parts[i]) for i in ordre]


def hexa(c):
    return "#%02X%02X%02X" % tuple(int(round(v * 255)) for v in c)


def hsl(c):
    h, l, s = colorsys.rgb_to_hls(*c)
    return {"h": round(h * 360, 1), "s": round(s * 100, 1), "l": round(l * 100, 1)}


def oklch(c):
    """sRGB → linéaire → OKLab → OKLCH. La clarté OKLab est perceptuelle,
    c'est elle qui dit si deux aplats se distinguent vraiment à l'œil."""
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    r, g, b = lin
    l_ = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m_ = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s_ = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    import math

    return {
        "L": round(L, 3),
        "C": round(math.hypot(a, bb), 3),
        "h": round(math.degrees(math.atan2(bb, a)) % 360, 1),
    }


def couleur(c):
    return {"hex": hexa(c), "rgb": [int(round(v * 255)) for v in c], "hsl": hsl(c), "oklch": oklch(np.array(c))}


def creux_du_bas(m, boite, n=400):
    """Profil du bord inférieur, échantillonné, puis maxima locaux du profil :
    ce sont les creux entre lobes. Leur espacement donne le rythme de la forme."""
    x0, y0, x1, y1 = boite
    largeur = x1 - x0
    profil = []
    for i in range(n):
        x = x0 + int(i * (largeur - 1) / (n - 1))
        col = np.nonzero(m[y0:y1, x])[0]
        profil.append(int(col.max()) if len(col) else -1)
    creux = []
    for i in range(2, n - 2):
        f = profil[i]
        if f < 0:
            continue
        if f <= profil[i - 2] and f <= profil[i + 2] and (f < profil[i - 2] or f < profil[i + 2]):
            creux.append(i)
    # Fusionne les creux voisins (< 2 % de la largeur).
    fusionnes = []
    for i in creux:
        if fusionnes and i - fusionnes[-1][-1] < n * 0.02:
            fusionnes[-1].append(i)
        else:
            fusionnes.append([i])
    return [round(100 * (sum(g) / len(g)) / (n - 1), 1) for g in fusionnes]


def main():
    p = argparse.ArgumentParser(description="Mesure une forme dans une image de référence.")
    p.add_argument("image")
    p.add_argument("--teinte", nargs=2, type=float, default=[0, 360], metavar=("MIN", "MAX"))
    p.add_argument("--sat", type=float, default=0.30)
    p.add_argument("--val", type=float, default=0.40)
    p.add_argument("--sombre", action="store_true", help="mesurer l'encre au lieu de l'aplat")
    p.add_argument("--seuil-sombre", type=float, default=0.30)
    p.add_argument("--boite", nargs=4, type=int, default=None, metavar=("X0", "Y0", "X1", "Y1"))
    p.add_argument("--k", type=int, default=5)
    p.add_argument("--sortie", default="/tmp/mesures")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()

    im, rgb = charger(a.image)
    H, W = rgb.shape[:2]
    if a.boite:
        x0, y0, x1, y1 = a.boite
        roi = np.zeros((H, W), dtype=bool)
        roi[y0:y1, x0:x1] = True
    else:
        roi = np.ones((H, W), dtype=bool)

    brut = masque_sombre(rgb, a.seuil_sombre) if a.sombre else masque_teinte(rgb, a.teinte, a.sat, a.val)
    brut &= roi
    if not brut.any():
        print("Aucun pixel retenu : élargir --teinte / baisser --sat et --val.", file=sys.stderr)
        sys.exit(1)
    m = plus_grande_composante(brut)
    m = boucher_trous(m)

    ys, xs = np.nonzero(m)
    bx0, bx1, by0, by1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    bw, bh = bx1 - bx0, by1 - by0
    pixels = rgb[m]

    lum = 0.2126 * pixels[:, 0] + 0.7152 * pixels[:, 1] + 0.0722 * pixels[:, 2]
    ordre = np.argsort(lum)
    deciles = {
        nom: couleur(pixels[ordre[int(len(ordre) * q) : int(len(ordre) * q) + max(1, len(ordre) // 50)]].mean(axis=0))
        for nom, q in (("ombre", 0.02), ("demi_ton", 0.25), ("base", 0.50), ("clair", 0.75), ("lumiere", 0.97))
    }

    mesures = {
        "image": os.path.abspath(a.image),
        "dimensions": {"largeur": W, "hauteur": H},
        "boite": {"x0": bx0, "y0": by0, "x1": bx1, "y1": by1, "largeur": bw, "hauteur": bh},
        "ratio": round(bw / bh, 3),
        "pixels_pleins": int(m.sum()),
        "remplissage_boite_pct": round(100 * m.sum() / (bw * bh), 1),
        "part_image_pct": round(100 * m.sum() / (W * H), 2),
        "palette": [{"part_pct": round(part * 100, 1), **couleur(c)} for c, part in kmeans(pixels, a.k)],
        "tons": deciles,
        "creux_du_bas_pct_largeur": creux_du_bas(m, (bx0, by0, bx1, by1)),
    }
    if a.sombre:
        # Épaisseur du trait : moyenne des longueurs de segments pleins par ligne.
        ep = []
        for y in range(by0, by1, max(1, bh // 60)):
            ligne = m[y, bx0:bx1]
            n = 0
            for v in ligne:
                if v:
                    n += 1
                elif n:
                    ep.append(n)
                    n = 0
            if n:
                ep.append(n)
        if ep:
            mesures["trait"] = {
                "epaisseur_px_mediane": float(np.median(ep)),
                "epaisseur_pct_largeur_forme": round(100 * float(np.median(ep)) / bw, 2),
            }

    os.makedirs(a.sortie, exist_ok=True)
    Image.fromarray((m * 255).astype(np.uint8)).save(os.path.join(a.sortie, "masque.png"))
    im.crop((bx0, by0, bx1, by1)).save(os.path.join(a.sortie, "decoupe.png"))
    chemin_json = os.path.join(a.sortie, "mesures.json")
    with open(chemin_json, "w") as f:
        json.dump(mesures, f, indent=2, ensure_ascii=False)

    if a.json:
        print(json.dumps(mesures, ensure_ascii=False))
        return
    print(json.dumps(mesures, indent=2, ensure_ascii=False))
    print(f"\n→ {a.sortie}/masque.png · decoupe.png · mesures.json", file=sys.stderr)


if __name__ == "__main__":
    main()
