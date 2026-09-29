#!/usr/bin/env python3
"""
Service de seconde lecture OCR pour la relecture des databooks.

Le corpus est transcrit par dots.ocr, un modèle de vision autorégressif. Ce
service en fournit une **seconde lecture par un moteur d'une autre famille** —
détection + CRNN, sans génération — pour que le relecteur ait deux avis devant
les yeux au lieu d'un seul.

L'intérêt n'est pas que ce moteur soit « meilleur » : il l'est sur certains
passages et moins bon sur d'autres, et il ne restitue aucune mise en page. Il
est utile parce que ses erreurs ne sont pas les mêmes. Son vocabulaire est
**fermé** — 86 hiragana, 94 katakana, 15 565 kanji, zéro caractère arabe — donc
il lui est structurellement impossible de produire les intrusions d'alphabet
qui polluent 763 planches du corpus, ni les boucles dégénérées, puisque rien
n'est généré jeton par jeton.

Résident par conception : charger les modèles prend autant de temps que lire
une planche, et un relecteur enchaîne les planches.

    GET  /sante                     -> {"ok": true, "modele": "..."}
    POST /lire  {"image": "<chemin absolu>"}
        -> {"regions": [{"texte": "...", "score": 0.97, "boite": [[x,y],...]}],
            "texte": "...", "secondes": 7.4, "cache": false}

Le résultat est mis en cache sur disque, indexé par le SHA-256 du fichier
image : une planche relue une fois ne coûte plus rien, et l'empreinte garantit
qu'un scan remplacé est relu au lieu de resservir l'ancienne lecture.

Écoute sur 127.0.0.1 uniquement — il n'est appelé que par le site, sur la même
machine.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock

PORT = int(os.environ.get("RELECTURE_OCR_PORT", "8791"))
CACHE = Path(os.environ.get("RELECTURE_OCR_CACHE", Path.home() / ".cache" / "relecture-ocr"))
# Les scans vivent sous public/ ; tout chemin demandé doit y être contenu, sinon
# l'endpoint deviendrait une lecture de fichier arbitraire pour qui l'atteint.
RACINE = Path(
    os.environ.get("RELECTURE_OCR_RACINE", Path.home() / "shenron" / "apps" / "site" / "public")
).resolve()

CACHE.mkdir(parents=True, exist_ok=True)

_moteur = None
# DEUX verrous, et non un seul : `lire()` détient celui de l'inférence pendant
# qu'il appelle `moteur()`, et un `Lock` n'est pas réentrant. Les partager
# produisait un interblocage franc — la première requête ne rendait jamais la
# main et `/sante` continuait d'annoncer un moteur non chargé.
_verrou_chargement = Lock()
_verrou_inference = Lock()


def moteur():
    """Charge les modèles une seule fois, à la première demande."""
    global _moteur
    if _moteur is None:
        with _verrou_chargement:
            if _moteur is None:
                from rapidocr import RapidOCR

                _moteur = RapidOCR()
    return _moteur


def empreinte(chemin: Path) -> str:
    h = hashlib.sha256()
    with chemin.open("rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def lire(chemin: Path) -> dict:
    """Relit une planche, en servant le cache si le scan n'a pas changé."""
    cle = empreinte(chemin)
    fichier = CACHE / f"{cle}.json"
    if fichier.exists():
        try:
            garde = json.loads(fichier.read_text(encoding="utf-8"))
            garde["cache"] = True
            return garde
        except (ValueError, OSError):
            # Un cache illisible est un cache absent : on relit plutôt que de
            # remonter une erreur pour un fichier qu'on peut regénérer.
            pass

    # Chargé AVANT de prendre le verrou d'inférence : c'est ce mélange qui
    # produisait l'interblocage.
    ocr = moteur()

    t0 = time.time()
    # Un seul passage à la fois : les modèles ONNX ne sont pas conçus pour être
    # appelés en parallèle depuis plusieurs fils, et six cœurs sont déjà
    # occupés par un seul décodage.
    with _verrou_inference:
        res = ocr(str(chemin))
    secondes = round(time.time() - t0, 2)

    regions = []
    if res is not None and res.txts:
        boites = res.boxes if res.boxes is not None else [None] * len(res.txts)
        for texte, score, boite in zip(res.txts, res.scores, boites):
            regions.append(
                {
                    "texte": texte,
                    "score": round(float(score), 3),
                    "boite": [[int(x), int(y)] for x, y in boite] if boite is not None else None,
                }
            )

    out = {
        "regions": regions,
        # Les régions sont rendues dans l'ordre du détecteur, qui n'est PAS
        # l'ordre de lecture japonais. On les joint quand même pour offrir un
        # texte cherchable, mais le relecteur doit afficher les régions.
        "texte": "\n".join(r["texte"] for r in regions),
        "secondes": secondes,
        "cache": False,
    }
    try:
        fichier.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return out


class Poignee(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _repondre(self, code: int, charge: dict) -> None:
        corps = json.dumps(charge, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/sante":
            return self._repondre(404, {"erreur": "route inconnue"})
        charge = len(list(CACHE.glob("*.json")))
        self._repondre(200, {"ok": True, "cache": charge, "charge": _moteur is not None})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/lire":
            return self._repondre(404, {"erreur": "route inconnue"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            demande = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, OSError):
            return self._repondre(400, {"erreur": "corps illisible"})

        brut = demande.get("image")
        if not isinstance(brut, str) or not brut:
            return self._repondre(400, {"erreur": "champ image manquant"})

        try:
            chemin = Path(brut).resolve()
        except OSError:
            return self._repondre(400, {"erreur": "chemin invalide"})

        # Confinement : resolve() a déjà réduit les `..`, il reste à vérifier
        # que le résultat est bien sous la racine autorisée.
        if not chemin.is_relative_to(RACINE):
            return self._repondre(403, {"erreur": "chemin hors du dossier des scans"})
        if not chemin.is_file():
            return self._repondre(404, {"erreur": "scan introuvable"})

        try:
            self._repondre(200, lire(chemin))
        except Exception as e:  # noqa: BLE001
            self._repondre(500, {"erreur": f"{type(e).__name__}: {e}"})

    def log_message(self, *_args) -> None:
        """Silence : journald reçoit déjà le cycle de vie du service."""


if __name__ == "__main__":
    print(f"relecture-ocr sur 127.0.0.1:{PORT}, scans sous {RACINE}, cache {CACHE}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Poignee).serve_forever()
