# Home SFX — `public/sfx/`

Pack chargé par `lib/sfx.ts` (Howler).

## Ingest autonome

```bash
cd apps/shenron/site
bun scripts/ingest-official-assets.ts          # SFX + images
bun scripts/ingest-official-assets.ts --sfx-only
bun run ingest:assets
```

Catalogue : `scripts/asset-catalog.ts` · inventaire : `public/assets-inventory.json`

## Sources actuelles

Sons DBZ récupérés via [MyInstants](https://www.myinstants.com/en/search/?name=dragon-ball)
(CDN `/media/sounds/*.mp3`) + images [dragonball-api.com](https://dragonball-api.com).
L'équipe DBFR déclare les droits d'usage FR (Toei/Shueisha).

| Fichier                                                                     | Usage home                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `kamehameha.mp3`                                                            | Double-clic deck — **clip long authentique** (~11 s, charge + onde) |
| `kamehameha-wave.mp3`                                                       | Onde seule (~7.6 s) — variante                                      |
| `kamehameha-short.mp3`                                                      | Ancien clip court (~4 s) — archive                                  |
| `ki-charge.mp3`                                                             | Charge de ki (pré-kame + sagas)                                     |
| `hit.mp3` / `punch.mp3`                                                     | Clic simple                                                         |
| `select.mp3`                                                                | Choix UI                                                            |
| `whoosh.mp3`                                                                | Changement de panneau                                               |
| `teleport.mp3`                                                              | Instant transmission                                                |
| `power-up.mp3`                                                              | Power-up / Kaio-ken                                                 |
| `final-flash.mp3`, `galick.mp3`, `over9000.mp3`, `nimbus.mp3`, `scream.mp3` | Extras                                                              |

Copie « archive » aussi sous `official/`.

## Remplacer par ton pack officiel

Dépose les MP3 sous les **mêmes noms** (via filebrowser `files.dragonballfr.com` ou SCP), puis hard-refresh.

```bash
# depuis le repo
cp /chemin/vers/ton-pack/*.mp3 apps/shenron/site/public/sfx/
```

Aucun rebuild Next requis pour les MP3 (servis en statique) — seulement si tu changes le code `sfx.ts`.
