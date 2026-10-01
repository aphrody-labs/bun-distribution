---
name: nie-re-workflow
description: "Atlas-driven reverse-engineering loop for nie.exe (IEVR): search the RE surfaces with nie atlas, read the ranked gaps, pick the next forge target, run the measure loop. Use for: atlas, where are we, what next, coverage, forge, road to 100 %."
---

# nie — la boucle de reverse-engineering

> **S'applique quand :** le dépôt IECODE (sa racine contient un dossier `iecode:crates/nie`) est le répertoire de travail et la CLI `nie` (crate `aphrody-nie-cli`) est construite ; les chemins préfixés `iecode:` sont relatifs à cette racine.
> **Sinon :** ne pas citer de chiffre ni d'adresse du binaire ; indiquer que l'atlas, la base `var/nie.sqlite` ou `nie.exe` sont absents (ils sont locaux et privés) et donner la commande qui mesurerait.

Le dépôt reconstruit `nie.exe` (Inazuma Eleven: Victory Road, PE x86-64) et prouve sa
compréhension en le **reproduisant octet pour octet** (`iecode:docs/nie/FORGE.md`). Le
reverse-engineering est le moyen ; la mesure est le juge. Les documents `iecode:docs/nie/` sont des
références migrées : leurs chemins et chiffres décrivent leur checkout d'origine.

## Règle n° 1 — interroger l'atlas AVANT de fouiller l'arbre

Tout ce que le dépôt sait vit dans **une** base locale, `var/nie-atlas.sqlite` (variable
`NIE_ATLAS`, miroir Redis optionnel ; schéma dans `iecode:docs/nie/ATLAS.md`) :

```bash
nie atlas build            # (re)construit l'index (et le miroir redis)
nie atlas search <terme>   # docs + symboles + outils + fichiers + crates, en une requête
nie atlas status           # une ligne mesurée
nie atlas gaps             # la route vers les 100 %, classée
nie atlas next             # le prochain chantier, en JSON
nie atlas docs --orphans   # les documents qui n'ancrent rien sur la machine
nie atlas dupes            # les fichiers strictement identiques à plusieurs chemins
```

Un `rg` à la racine d'un gros arbre est lent ; l'atlas couvre aussi des surfaces qu'un `grep` ne
voit pas (digest de la base de connaissance, unités de forge, outils). Ne fouiller l'arbre à la
main que si l'atlas n'a rien — et, dans ce cas, `nie find` (fichiers) / `nie grep` (contenu,
moteur ripgrep) plutôt que les binaires système. Si `var/nie-atlas.sqlite` manque, `nie atlas build`
doit d'abord le construire ; sans données locales, le dire.

## Règle n° 2 — le prochain chantier se lit, il ne s'invente pas

`nie atlas gaps` classe chaque écart par `(cible − courant) × poids` ; les poids sont définis dans
`iecode:crates/nie/aphrody-nie-index/src/atlas.rs` (ne pas les recopier d'un document).

La boucle autonome enchaîne tout cela :

```bash
bash scripts/tools/atlas-loop.sh              # un tick : mesurer → indexer → classer → agir → re-mesurer
bash scripts/tools/atlas-loop.sh --no-act     # mesurer et indexer seulement
bash scripts/tools/atlas-loop.sh --ticks 5
ATLAS_PROOFS=1 bash scripts/tools/atlas-loop.sh   # rejoue aussi les preuves uemu (lent)
ATLAS_RE_REAL=1 bash scripts/tools/atlas-loop.sh  # rejoue le test RE réel sur le serveur MCP
```

Elle agit **une fois par tick**, de façon bornée et réversible, à l'intérieur du dépôt : jamais
de `push`, de suppression, de service, de `/etc`, ni de `pkill` ; garde-disque et `timeout` sur
les étapes qui écrivent (voir l'en-tête du script).

## Règle n° 3 — aucune mesure sans sa commande

Un chiffre n'entre dans l'index qu'accompagné de la commande qui l'a produit :

```bash
nie atlas metric <nom> <valeur> [--total N] --source '<commande qui a produit le chiffre>' --refresh
```

Et un écart n'existe que si sa métrique a réellement été mesurée : `refresh_gaps` ne crée
**aucune** ligne pour une mesure absente, plutôt qu'un zéro qui se lirait « rien n'est fait ».
Corollaire : ne jamais recopier un chiffre d'un document — le régénérer.

## Les trois oracles, par ordre de force

1. **L'identité de la forge** — `aphrody-nie-forge build` (défaut `--out`/cible `dist/nie.exe`)
   échoue si le sha256 produit diffère de la référence. Ne jamais « réparer » ce test.
2. **uemu** — `bash scripts/audit/proofs.sh` rejoue les preuves `iecode:scripts/audit/uemu/validate_*.py`
   (émulation de la fonction RÉELLE du binaire, comparaison bit à bit du portage). C'est ce que
   Rust ne sait pas produire seul.
3. **Les golden `aphrody-nie-data`** — une famille n'est portée que si elle recalcule le dump du
   jeu bit pour bit sur son corpus entier.

Tout ce qui n'est pas validable est marqué incomplet, jamais « fait ». L'atlas et la forge
citent des recettes `just` (`re-rebuild`, `preuves`, `forge`) ; l'arbre IECODE actuel n'a pas de
`justfile` : utiliser les commandes ci-dessus et `nie rebuild`.

## Vérifier que le serveur MCP dit vrai

`cargo test -p aphrody-nie-mcp --test re_real` interroge le **vrai** serveur sur stdio puis
corrobore ses réponses contre la table `.pdata` du binaire de référence. Le test est
*data-gated* : sans `var/nie.sqlite` ni `nie.exe` (variables `NIE_REPO`, `NIE_SQLITE`), il dit ce
qu'il saute et passe — un passage « vide » ne prouve rien.

Leçon durable : la base de connaissance peut décrire un **autre build** que la cible ; avant de
citer une adresse, vérifier son ancrage sur une racine `.pdata` du binaire de référence (écart
`re.anchoring` dans `nie atlas gaps`) et citer le binaire avec son sha256, jamais un chiffre
recopié d'un document.

Le format des réponses d'`re_query` est à vérifier sur une vraie réponse (les colonnes d'adresse
sont rendues en chaînes hexadécimales, cf. `ievr-terminologie`).

## La chaîne, et qui possède quoi

```
Ghidra → aphrody-nie-re / aphrody-nie-index → aphrody-nie-trace → aphrody-nie-computer-use
                 ↓
            var/nie.sqlite  →  digest dans l'atlas
```

Packages sous `iecode:crates/nie/` (préfixe `aphrody-nie-` omis ci-dessous) :

- `re` : PE, `.pdata`, RTTI, vtables, désassemblage, base de connaissance.
- `index` : le schéma de la base **et** l'atlas (`atlas.rs` / `atlas.sql`).
- `pe` / `asm` / `forge` : découpage byte-exact, encodeur x86-64, production.
- `trace` : lectures bornées du processus vivant (binaires `nie-mem`, `nie-edit`).
  `computer-use` : frontière typée.

## Pièges — les répéter coûte des heures

- L'index Ghidra peut être **désaligné** : `.pdata` est la vérité terrain. Passer par
  `nie rebuild` (« refonde la carte sur `.pdata`, ré-ancre Ghidra, disasm + propage ») plutôt que
  par les CLI brutes : `disasm` avant `rtti` donne un résultat incomplet **sans erreur**.
- Les racines `.pdata` de la base et du binaire de référence ne sont pas le même nombre si les
  builds diffèrent : citer le binaire avec son empreinte, toujours.
- `forge_unit` (table de la KB) et `var/forge/cover.json` ne sont pas la même chose : le
  découpage de référence est le `cover.json` ; vérifier lequel est peuplé avant de compter.
- Les défauts de `aphrody-nie-forge` (`var/forge`, `forge/registry.json`, `forge/asm`,
  `var/nie.sqlite`, voir `iecode:crates/nie/aphrody-nie-forge/src/main.rs`) peuvent différer du registre
  réellement utilisé : vérifier avec `--help` et le contenu du répertoire.
- Un binaire de forge plus ancien que le format de `cover.json` échoue au chargement
  (variante inconnue) : prendre le binaire le plus récent de `target/release` / `target/debug`.
- La porte de qualité est un `cargo clippy -p <crate> --all-targets` ciblé, **jamais**
  `cargo build --workspace --all-targets` sur une machine contrainte en disque.
- `pixel-perfect` n'est pas acquis, et `byte-exact` qualifie les **données**, jamais les pixels.

## Références

`iecode:docs/nie/ATLAS.md` (l'index et la boucle) · `iecode:docs/nie/RE.md` (la base de
connaissance) · `iecode:docs/nie/FORGE.md` (les paliers G0→G6) · `iecode:PLAN.md` (le plan).
