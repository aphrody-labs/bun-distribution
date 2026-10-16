<!-- SPDX-License-Identifier: Apache-2.0 -->
# Inventaire local OpenAI / ChatGPT

`scripts/tools/os/scripts/live-openai-inventory.ts` exécute un inventaire réel et en lecture seule
avec `aphrody-yolo` et le kernel WinClean. La cible d’installation est résolue depuis
le package MSIX `OpenAI.Codex`; les racines utilisateur présentes sont ajoutées
automatiquement (`AppData`, `LocalCache`, `LocalState`, `.codex`, `.chatgpt`).
La cible GUI observée est `OpenAI.Codex_26.915.4065.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe`.

```powershell
bun scripts/tools/os/scripts/live-openai-inventory.ts
```

Résultats : `var/winclean-live/openai/latest` (not in repo).

- `file-map.json` : tous les fichiers vus, chemin, racine, taille, extension,
  date et classification.
- `binary-analysis.json` : hashes et parsing PE des binaires accessibles.
- `asar-map.json` : inventaire structurel de `app.asar`, sans extraction de contenu.
- `system-profile.json`, `os-info.json`, `yolo-status.json` : preuves kernel/YOLO.

Les chemins à risque (`token`, `secret`, `cookie`, `credential`, `auth`, clés privées,
`.env`) sont marqués `sensitive-metadata-only`. Aucun contenu utilisateur, secret,
cookie ou token n’est copié, sérialisé ou affiché.

Dernière preuve observée : `status=verified-live-read-only`, `files=163261`,
`binaries=517`, `asarFiles=15324`, `sensitiveMetadataOnly=4241`.
Le statut YOLO associé confirme `kernel_reachable=true` et `admin_tools=166`.
Les hashes binaires n’ont produit aucune erreur et le parsing PE a réussi pour tous
les fichiers applicables ; 153 fichiers binaires n’étaient pas des PE applicables.
