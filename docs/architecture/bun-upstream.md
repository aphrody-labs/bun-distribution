# Architecture de consolidation fondée sur Bun upstream

Référence vérifiée le 7 octobre 2026 dans le checkout local de `vendor/bun` :
`085dd0ad5e2356f805ecb1b5d51f7cc28da802af`. Le runtime du produit reste épinglé
à `a4d88d12417844912a9b6a5a9bedc0755b011092` dans `tools/config/vendor.json`.
Le checkout, la révision distribuée et le runtime installé sont trois états
distincts ; cette orientation architecturale ne constitue pas une activation.

## Organisation observée

| Responsabilité | Source Bun observée | Application à Aphrody/Yolo |
| --- | --- | --- |
| Entrée native du runtime | `src/runtime/bin_entry/mod.rs` | Un runtime Yolo compilé, avec ses alias existants |
| Routage des commandes | `src/cli/mod.rs` et ses modules de commande | Regrouper les commandes Yolo dans leur propriétaire CLI |
| Capacités du moteur | Membres `src/*` du workspace Cargo | Conserver les bibliothèques nécessaires aux dépendances et aux cibles |
| Dépendances natives | `vendor/`, crates `*_sys` et intégration JSC | Préserver les frontières de compilation, licences et correctifs |
| Outillage de construction | `scripts/`, `tools/`, configuration Cargo | Maintenir un propriétaire de construction et des portes explicites |

Le workspace Bun contient plusieurs crates alors que le produit expose un
runtime. Réduire les points d'entrée distribués n'impose donc pas de réunir toutes
les bibliothèques dans une seule crate. La structure observée des commandes est
`src/cli`, et non une transposition d'un ancien instantané de documentation.

## Décisions pour les prochains lots

Les commandes Forge et de génération de plugins ont maintenant pour propriétaire
`packages/engine/yolo`, avec leurs modules internes sous `src/cli/forge/` et
`src/cli/plugin/`. Les commandes `yolo forge` et `yolo plugin` sont chargées
à la demande et embarquées dans le binaire compilé ; elles fonctionnent sans
checkout pour leurs opérations autonomes. Les configurations, licences et tests
ont migré avec leur implémentation.

Les identités npm `@aphrody/bun-forge` et `@aphrody/plugins` restent des façades
de compatibilité dépréciées le 2026-10-07 : elles réexportent les API du
propriétaire Yolo sans conserver une seconde implémentation. Leur dépendance
pointe vers `@aphrody/yolo-cli`, qui ne dépend plus de ces façades. La publication
de versions mises à jour reste distincte de cette qualification source.
Les preuves et limites Forge sont dans le
[reçu de consolidation](../operations/forge-yolo-consolidation.md).

Le moteur natif reste dans `vendor/bun`. Les comportements du produit restent
dans Aphrody : une consolidation de dossiers ne copie pas les domaines métier
dans le fork upstream. Les interfaces Rust, FFI, WASM et MCP s'appuient sur leurs
propriétaires partagés ; chaque frontière conserve son contrat de chargement et
ses contraintes de cible.

Chaque absorption livre ensemble le déplacement des sources, la migration des
consommateurs et des exports, les validations pertinentes puis la suppression
du propriétaire devenu inutile. Les données privées et les profils
d'authentification restent dans leurs magasins protégés.

La mise à jour du fork suit le workflow de [qualification Bun](../BUN_FORK.md) :
merge upstream, construction en factory, tests, qualification du packaging puis
changement explicite de la révision épinglée. Les preuves de compilation seules
ne suffisent pas à déclarer le runtime installé opérationnel.
