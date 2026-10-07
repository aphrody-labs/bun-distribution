<!-- SPDX-License-Identifier: Apache-2.0 -->

# Fusion Forge et Yolo — 2026-10-07

Forge appartient maintenant à `packages/engine/yolo/src/cli/forge/`.
Le routeur `yolo forge` utilise un import littéral différé, qui permet à Bun de
l'embarquer dans le runtime. La compilation et les opérations autonomes ne
nécessitent plus de retrouver les sources de Forge dans un checkout.

Les quatre anciens modules du paquet `@aphrody/bun-forge` réexportent les modules
Yolo ; son entrée CLI conserve l'invocation standalone et les unités systemd.
La configuration JSON est emballée une seule fois dans le propriétaire Yolo.
L'identité npm reste compatible ; son ancienne implémentation est retirée.
Les modules conservent SPDX Apache-2.0 dans le paquet Yolo déclaré MIT.

## Qualification

- Avant migration : 28 tests, 96 assertions sur le propriétaire Forge.
- Après migration : ces mêmes tests avec le contrôle de copies des configurations,
  33 tests réussis. TypeScript Yolo et façade Forge passent.
- Binaire Yolo compilé sous `/tmp`, lancé depuis un dossier vide avec un chemin
  de checkout inexistant : Forge help, version et génération de l'unité systemd
  réussissent. L'unité désigne le binaire suivi de `forge watch`.
- Suite Yolo complète : 277 tests, 2789 assertions, aucun échec avec la
  bibliothèque native explicitement qualifiée (ABI tooling 1/n2b 2/oxc 1).
  Son SHA-256 est `3212bfd18223e188e4cb2bc4bcd6ab4027a9359d522d5ba59d34c3e297789d3d`.
- Aucun build du moteur Bun ni installation PATH n'est revendiqué par ce lot.
  L'activation du fork, le SDK FFI et les autres cibles restent dans le plan global.

Les commandes de construction demeurent `yolo forge build|watch`, leurs arguments,
profils, outils, scratch, tests first-party et reçus restent conservés.
Le runtime externe déjà publié et la façade npm déjà publiée ne sont pas modifiés
par le seul déplacement des sources.

## Qualification bytecode et SDK embarqué

Le chargeur standalone de Forge utilise maintenant une continuation Promise ;
le chargement différé reste inchangé, mais la compilation CommonJS avec
`--bytecode` n'est plus bloquée par un await de premier niveau. La façade
historique conserve ses codes de sortie. La sonde de moteur des tests demande
explicitement `BUN_BE_BUN=1` pour fonctionner aussi depuis un hôte compilé.

Le CLI actuel a été compilé avec les flags de release sur le dernier moteur
local disponible et qualifié, fork `a4d88d124`, avec le SDK FFI embarqué
`3212bfd18223e188e4cb2bc4bcd6ab4027a9359d522d5ba59d34c3e297789d3d`.
La première qualification, limitée au fournisseur d'outillage, faisait 324 835 408 octets, SHA-256
`041be40c27f3218b09684fdead5e9451cc24cad3b258ed94bb7623601504a701`.
Le moteur exige au plus glibc 2.38 et le SDK glibc 2.39.

Sondes dans un dossier vide avec HOME isolé et sans YOLO_TOOLING_LIB :
alias Bun 1.4.3, CLI Yolo, délégation vu, parsing natif, Forge version et
erreurs statut 2 ; 1 024 opérations FFI sur 32 instances avec fermeture
idempotente et rejet après fermeture ; API health puis SIGTERM avec port fermé.
Ce sont des sondes du binaire embarqué, distinctes des tests exécutés en source.
Le moteur plus récent `085dd0ad5e` cité dans l'historique n'est plus disponible
dans les stores de fabrique examinés ; il n'est donc pas déclaré embarqué ici.
Aucun lien PATH n'a été activé ni paquet publié par cette qualification.

## Fournisseur FFI partagé par le runtime et l'outillage

La résolution des assets natifs embarqués appartient maintenant au SDK dans
`packages/engine/runtime/src/ffi.ts`. Le runtime et l'outillage choisissent le
même fournisseur ; une sélection explicite reste prioritaire, et deux assets
concurrents sont refusés avant tout appel natif. `yolo runtime info` peut ainsi
interroger le fournisseur embarqué sans installation externe.

Le nouveau standalone fait 324 835 408 octets, SHA-256
`2a3a11cbb13d1f299ced07fada2c28bb919fd48d76056a25d1605f6fbcb3945c`.
Son moteur reste le fork local `a4d88d124` ; le fournisseur FFI garde le SHA-256
`3212bfd18223e188e4cb2bc4bcd6ab4027a9359d522d5ba59d34c3e297789d3d`.
L'ABI runtime réellement négociée est 1.5, compatible avec le minimum SDK 1.4 ;
les ABI tooling/n2b/oxc sont respectivement 1/2/1.

Onze sondes hermétiques passent depuis un dossier vide, HOME isolé, sans
YOLO_RUNTIME_LIB, YOLO_RUNTIME_HOME ni YOLO_TOOLING_LIB. Le runtime et
l'outillage utilisent `/$bunfs/root/libaphrody_ffi.so`. La seule bibliothèque
native extraite et mappée a été relue et son SHA-256 vérifié contre l'asset.
Les sondes couvrent les alias et le parseur, les informations runtime et les
statistiques système, l'annulation d'une opération, l'arrêt et le drainage d'un
enfant sur AbortSignal, cinq destructions avec arrêt des groupes de processus,
et le maintien de l'outillage après fermeture de son autre propriétaire runtime.
La sonde API démarre réellement, répond à health puis ferme son port sur SIGTERM.

Le même alias Bun charge CPython 3.12.15 depuis l'artefact Vu existant en global,
sans promotion ctypes. Une extension Rust safetensors existante sérialise puis
désérialise un tenseur ; une seule libpython est mappée et Py_FinalizeEx retourne 0. L'extension Python Aphrody n'est pas installée dans cet environnement :
cette sonde ne qualifie donc pas son module.

Les 40 tests SDK/FFI passent avec le preload du paquet et le fournisseur natif
explicite ; les 28 tests Forge passent en source et depuis le nouveau moteur
compilé. Les cinq tests des profils passent après correction de la profondeur
du Justfile. Une invocation diagnostique des deux suites complètes à la racine
avait donné 405 réussites, 20 skips et 23 échecs : preload absent, assertion ABI
trop stricte, fixtures déplacées, installation et capacités GPU absentes. Les
erreurs de preload, d'ABI et de profils ont été corrigées ou réexécutées avec
la configuration réelle du paquet ; les gates d'installation et les sondes GPU
restent distincts. Aucun succès global de cette invocation n'est revendiqué.

## Archive et installation isolée

La qualification finale inclut le fournisseur installé dans la résolution
commune du SDK : l'outillage et le runtime consomment aussi la même bibliothèque
depuis l'alias Bun qui exécute une application, sans variables de bibliothèque
explicites. Le nouveau test ouvre les deux propriétaires sur l'artefact installé,
ferme le runtime puis vérifie que l'outillage reste utilisable.

Le standalone final fait 324 884 560 octets, SHA-256
`c886d124e1389167b0f1424b91bfc2902cc750c481d61fef6e97cd605493bf0b`.
Il incorpore aussi les dernières corrections de la fabrique, qualifiées
séparément par son propriétaire. Les onze sondes hermétiques passent à nouveau.
Le moteur reste `a4d88d124` et le fournisseur natif garde le SHA-256 `3212bfd18223e188e4cb2bc4bcd6ab4027a9359d522d5ba59d34c3e297789d3d`.

Le script de release utilise les propriétaires réels : SDK
`packages/engine/runtime`, templates M3 et chemins de crates domainés du
catalogue `vendor.lock`. Les licences existantes et ce catalogue restent dans les
archives et l'installation. Les anciens chemins racine inexistants ne sont plus
requis. Le package du runtime partagé est produit par
`scripts/release/runtime_artifact.ts`, sans nouvelle compilation Cargo.

L'archive Linux GNU `yolo-0.1.0-x86_64-unknown-linux-gnu.tar.gz` fait
241 273 929 octets, SHA-256
`34dbc6e44cf29f693fdcdde15ff2a82c3233c9906a9d68d3d656eba2eaa6d26b`.
L'archive de sources Rust conserve leur arborescence ; elle fait 11 155 130
octets, SHA-256 `48b0e1ab2b3a04eb8076567e96fc2e9a7d1ee6f224f5936e1644c9f26208703b`.

L'installateur shell a acquis cette archive localement, vérifié ses sommes,
chargé son artefact natif et installé le binaire dont le SHA-256 a été comparé
au standalone compilé. Une mise à niveau réelle conserve l'artefact précédent.
Deux rollbacks vérifient le fournisseur externe ABI 1.5 → 1.4 → 1.5.
`runtime info --installed` force cette sonde externe : un fournisseur embarqué
valide ne masque plus une bibliothèque externe invalide. Le fournisseur embarqué
reste ABI 1.5 pendant ces changements de l'artefact externe.

L'application web produite par ce binaire contient 21 fichiers et consomme le SDK
depuis son chemin installé. Son alias Bun installe les dépendances et exécute
six tests, onze assertions : health, statistiques natives/SQLite, benchmark,
annulation sur déconnexion, SSE et HTML. Aucun build du runtime n'est demandé
au consommateur. Une autre sonde ouvre runtime et outillage depuis l'alias Bun,
vérifie une seule bibliothèque FFI mappée et relit son SHA-256.

Gates finaux : 41 tests SDK/FFI, 120 assertions ; 17 tests standalone/OXC/vector,
101 assertions ; 14 tests d'installateurs, 80 assertions. Ces derniers couvrent
shell et PowerShell sur Linux, avec un vrai fournisseur embarqué dans le cas
d'une bibliothèque externe invalide malgré ses checksums valides. TypeScript
runtime/Yolo/core, format et whitespace passent ; oxlint ne rapporte aucune
erreur, avec les avertissements existants des boucles asynchrones et helpers.
Les fixtures d'installation utilisent un TMPDIR isolé en mémoire et le retirent
à la fin, pour éviter la contention d'écriture WSL observée lors du premier essai.

Les reçus machine-local se trouvent sous
`~/.local/share/aphrody/yolo/qualification-20261007-embedded/` : `compile.json`,
`smoke.json`, `installed-qualification.json`, `artifact/manifest.json` et
`release/0.1.0/`. Cette qualification ne change aucun PATH actif et ne publie
aucune archive. Elle ne qualifie pas l'acquisition distante, Windows natif, le
dernier moteur upstream, un build moteur supplémentaire ou le rendu desktop.
Aucun gain de taille ou de temps n'est revendiqué.
