<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Web sur les VPS

État vérifié le 2026-10-07 : `vps` et `dbfr` exécutent le moteur natif
Obscura de la CLI multicall Aphrody. Les unités
[`aphrody-web-browser-vps.service`](../../../tools/config/host/systemd/aphrody/aphrody-web-browser-vps.service)
et [`aphrody-web-browser-dbfr.service`](../../../tools/config/host/systemd/aphrody/aphrody-web-browser-dbfr.service)
ont été composées, vérifiées et activées par le propriétaire Infra :

```sh
bun packages/engine/core/src/host/cli.ts host-plan aphrody-web-browser-vps --target vps --observe
bun packages/engine/core/src/host/cli.ts host-apply aphrody-web-browser-vps --target vps --apply
bun packages/engine/core/src/host/cli.ts host-plan aphrody-web-browser-dbfr --target dbfr --observe
bun packages/engine/core/src/host/cli.ts host-apply aphrody-web-browser-dbfr --target dbfr --apply
```

Les deux services sont `enabled`, `active/running`, sans redémarrage observé.
CDP écoute sur `127.0.0.1:9222`; `/json/version` répond et le WebSocket
`ws://127.0.0.1:9222/devtools/browser` accepte les commandes. Aucun accès
`file://` n'est activé. Le HOME du service est le store Web privé, isolé des
identifiants personnels. Les cookies et autres authentifications existants
conservent leurs stores.

Le binaire qualifié porte le SHA-256
`4e51190ca80efab50df4b3f351c2be60b41815c2566a6a9e456d4077a761c296`.
VPS utilise `/home/ubuntu/.local/bin/aphrody`; DBFR utilise la copie immuable
`/home/ubuntu/.local/lib/aphrody/shenron-4e51190ca80efab5/aphrody`.
L'entrée CLI `/home/ubuntu/.local/bin/aphrody` de DBFR est également installée
et porte ce même SHA-256.
Les candidats `.sync-*` d'une autre session sont préservés. Aucune nouvelle
compilation du moteur n'a été nécessaire.

## Crawl et indexation natifs

La nouvelle commande et les liaisons FFI/WASM sont en qualification. Le hash
installé décrit ci-dessus est celui de la vérification initiale; il ne prouve
pas que ces nouvelles interfaces sont activées. Leur activation reste suspendue
pendant la pause de l'objectif. Les services et stores existants sont conservés.

Le propriétaire produit est la CLI Rust `aphrody web crawl-index`. Le worker
Codex, depuis son checkout ou tout autre dossier du VPS, l'appelle directement :

```sh
/home/ubuntu/.local/bin/aphrody web crawl-index https://aphrody.com --label omar-example --profile aphrody --max-requests 25 --max-depth 2
```

Depuis le poste, utiliser `aphrody infra ssh exec --host vps` ou `--host dbfr`
pour transmettre cette commande. Aucun script Bun privé n'est nécessaire.
Le budget borne les requêtes tentées, la profondeur et le délai global
(`--timeout`, 1 800 secondes par défaut). Les domaines viennent des URL de
départ; `robots.txt`, une requête simultanée par hôte, le délai d'une seconde
et deux retries restent ceux du propriétaire natif Web.

Chaque label conserve son frontier SQLite, ses Markdown et son rapport sous
`<home du profil>/private/web/jobs/<label>/`. Les répertoires sont `0700`, les
fichiers `0600`. Le SHA-256 de l'URL détermine le nom du document. Le verrou
`job.lock` est un verrou du système : une sortie ou un crash le libère.
Relancer la même commande reprend le frontier et reconstruit les documents
persistés avant l'indexation. `--job-dir` permet de reprendre un ancien dossier
privé sans déplacer ou supprimer ses données.

Le rapport JSON expose les compteurs du frontier, le résultat d'indexation et
`complete`. Un budget atteint, une page en attente, verrouillée ou en erreur
produit `complete=false`. Un délai dépassé indexe les pages déjà persistées,
écrit le rapport privé puis retourne une erreur qui demande une reprise.
Les compteurs interrompus et inconnus sont `null`.

L'index utilise la base du profil choisi et la source `web:<label>`.
Le profil Aphrody résout sa base dans
`/home/ubuntu/.aphrody/workspace-aphrody/db/aphrody.sqlite`. Les profils
Shenron, DBFR et IE restent séparés. Exemple de recherche :

```sh
aphrody home query Aphrody --profile aphrody --kind chunk --limit 5
```

## Campagnes Dragon Ball

`aphrody web dragon-ball` expose le module natif de
`aphrody-web-crawl`, qui regroupe le plan historique Dragon Ball, les sources
BXC et les exports consommés par Shenron. Le profil par défaut est `shenron`.
La collecte n'accorde aucune validation éditoriale aux sources acquises.

```sh
aphrody web dragon-ball sources --json
aphrody web dragon-ball plan --source kanzentai --profile shenron --json
aphrody web dragon-ball crawl --source kanzentai --output /protected/campaign/corpus --profile shenron --max-requests 500 --max-depth 2 --json --index
aphrody web dragon-ball status --output /protected/campaign/corpus --profile shenron --json
aphrody web dragon-ball index --output /protected/campaign/corpus --profile shenron --json
aphrody web dragon-ball assets --output /protected/campaign/corpus --profile shenron --max-files 25 --json
```

`plan` valide et résout la sélection sans requête ni écriture; `status` lit les
preuves existantes. `index` matérialise les exports JSONL déjà acquis puis les
indexe sans recrawl. La clé de source inclut le hash du dossier de campagne,
afin que deux campagnes d'un profil ne remplacent pas leurs documents.
`export-bxc DATABASE... --output FILE --json` lit les anciennes bases sans les
modifier et conserve leur provenance dans la projection Shenron.
`consolidate-bxc DATABASE... --output NEW_DATABASE --json` crée un nouveau
store protégé, conserve les profils, contenus bruts et métadonnées historiques,
et refuse d'écraser une destination existante.

`--source` accepte plusieurs identifiants ou une liste séparée par virgules;
sans sélection, le plan choisit les sources activées. Les URL Fandom et les
URL contenant des identifiants sont refusées. `--with-gallery` collecte la
galerie déclarée; `--render` emploie le navigateur natif Obscura pour le HTML
rendu, tandis que les règles robots restent en HTTP. Le rapport persiste
`report.json`, les documents sous `documents/` et les projections du corpus.
`completed=false` distingue une campagne partielle d'une collecte achevée.

`assets` reprend le catalogue DragonBallCN existant, acquiert les couvertures
et les convertit nativement en WebP, avec les originaux conservés. `--plates`
active les planches déclarées dans l'inventaire; `--quality`, `--lossless` et
`--force` contrôlent la conversion ou le rafraîchissement. Le journal et les
checksums permettent la reprise. Le budget, les délais, les limites par
fenêtre et par jour, les refus HTTP et l'espace disque bornent l'acquisition.

`asset-plan` calcule les URL et chemins sans transfert ni écriture; `asset-probe`
qualifie au plus trois réponses avec le quota persistant, sans écrire les médias.
Les options `--collection`, `--did`, `--local-reserve`, `--grayscale`,
`--max-width` et `--requests` contrôlent la sélection et la conversion.
`manga-volume --volume 1 --output /protected/volume --profile shenron --json`
réutilise la découverte et l'acquisition natives, avec un reçu des originaux
et des images converties. Il ne lance ni OCR ni écriture éditoriale.

`discover --source official --output /protected/campaign --profile shenron
--max-operations 25 --json` compose les propriétaires Google et de détection
Web existants. Le budget compte les opérations des propriétaires; leurs
fallbacks internes peuvent effectuer plusieurs requêtes. Les surfaces books,
suggestions, news, videos, scholar, images et DNS conservent les contrats
historiques. Le rapport nomme les erreurs et marque une découverte partielle.
`crawl --discovery-plan /protected/campaign/discovery-plan.json` importe les
URL découvertes uniquement pour les hôtes exactement déclarés et les règles
d'acceptation des cibles sélectionnées.

La FFI et la CLI appellent la même bibliothèque propriétaire, sans processus
enfant pour ces workflows. Le parsing portable passe par
`aphrody pure html dragon-ball - --kind toei --base-url URL`; l'adaptateur WASM
existant exécute la même commande sur le HTML fourni. Le réseau, le navigateur,
les frontiers SQLite et les fichiers privés restent exécutés par le propriétaire
natif, avec leurs profils et leur authentification.

## Preuves et limites

Sur chacun des deux hôtes, le crawl de `https://aphrody.com` a obtenu HTTP 200,
une page et zéro erreur : frontier `pending=0`, `locked=0`, `done=1`, `failed=0`.
L'indexation a créé un document et un chunk; la recherche a retrouvé la source
`web:native-smoke`. Une nouvelle exécution sur VPS a tenté zéro requête, en
conservant le document déjà recherchable.

Le test CDP a créé un onglet, exécuté du JavaScript manipulant le DOM
(`sum=3`, titre `Aphrody Native Render`) puis capturé un PNG de 1280 × 720,
11 348 octets. Le décodage du PNG a trouvé 17 849 pixels verts correspondant au
rectangle de test, sur les deux hôtes. L'onglet a ensuite été fermé. Les
preuves restent dans le store privé `web/smoke/` de chaque cible.

Le probe stdio de `/home/ubuntu/.local/bin/aphrody-mcp` a annoncé 127 outils sur
chacun des hôtes, dont crawl, navigation, évaluation, capture et extraction Web.
Ce binaire installé n'annonce pas `aphrody_home_query`; la CLI native `home
query` fonctionne. Les bases qualifiées ont zéro vecteur : la preuve porte
sur la recherche lexicale, pas sur une indexation vectorielle. Les URL de
collecte métier viennent des tâches autorisées; ce smoke ne prouve pas une
couverture exhaustive du Web ni l'authentification à des sites privés.

`systemd-analyze verify` a accepté les deux unités composées. Le contrôle global
du catalogue signalait quatre unités Shenron concurrentes non listées; aucune
correction n'a été apportée aux chemins de cet autre chantier.
