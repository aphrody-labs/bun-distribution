# Migration des objets Supabase Storage d’Achillea

Ce runbook copie les **octets** des deux buckets Supabase Cloud d’Achillea vers
la pile locale isolée, après la restauration PostgreSQL. Il ne touche jamais à
la pile RG/Azalée, ne supprime rien côté source et ne réalise aucune opération
réseau par défaut.

L’outil associé est
[`migrate-storage-objects.ts`](../../../scripts/rg/achillea/migrate-storage-objects.ts).
Il utilise uniquement les API Storage : les secrets ne sont acceptés que par
variables d’environnement, jamais dans les arguments, le manifeste ou les
logs.

## Invariants bloquants

| Élément         | Source Cloud                                     | Cible locale Achillea                                |
| --------------- | ------------------------------------------------ | ---------------------------------------------------- |
| Origine         | projet `yftdclwvehxxffwqvhmc.supabase.co`, HTTPS | passerelle loopback `127.0.0.1:8823`                 |
| Credential      | `ACHILLEA_STORAGE_SOURCE_KEY`                    | `ACHILLEA_STORAGE_TARGET_KEY`                        |
| Bucket public   | `images`                                         | `images`                                             |
| Bucket privé    | `ranked-proofs`                                  | `ranked-proofs`                                      |
| Racine d’octets | gérée par Supabase Cloud                         | `/var/www/achillea-storage`                          |
| État opérateur  | aucun                                            | `~/achillea-storage-migration` par défaut |

Les deux credentials doivent être rotatés, distincts et chargés depuis un
fichier privé externe au dépôt. La source refuse localhost, les adresses IP,
les réseaux privés et les noms RG/Azalée. La cible refuse toute adresse autre
que la passerelle Achillea. L’état refuse le dépôt, les racines partagées RG et
Azalée, ainsi que la racine Storage cible.

Les formats acceptés sont PNG, JPEG, WebP et GIF dans `images`; les preuves
privées acceptent PNG, JPEG et WebP. Le format est détecté par magic bytes, pas
par extension ni par en-tête HTTP.

## Préconditions

1. Révoquer les clés précédemment divulguées et générer deux credentials
   serveur dédiés. Ne jamais les coller dans un terminal partagé, un ticket ou
   ce dépôt.
2. Restaurer et valider la base PostgreSQL Cloud dans la base locale nommée
   exactement `achillea`, conformément à
   [`docs/architecture/rg/achillea-services.md`](../../architecture/rg/achillea-services.md). Cette restauration crée
   les lignes `storage.buckets` et `storage.objects`; elle ne transporte pas les
   octets.
3. Appliquer le contrat Storage d’Achillea et confirmer `images.public=true`
   ainsi que `ranked-proofs.public=false`.
4. Démarrer uniquement la pile Achillea isolée sur loopback. Ne modifier ni ne
   redémarrer `rg-storage`, `rg-postgrest` ou `rg-realtime`.
5. Garder le Cloud comme source d’autorité et geler ses écritures pendant
   l’inventaire final et la bascule.
6. Vérifier l’espace libre : le dossier d’état contient une copie privée de
   chaque objet afin de permettre une reprise déterministe.

Le fichier privé chargé par l’opérateur doit définir ces noms, sans réutiliser
de variable générique :

```text
ACHILLEA_STORAGE_SOURCE_URL
ACHILLEA_STORAGE_SOURCE_KEY
ACHILLEA_STORAGE_TARGET_URL
ACHILLEA_STORAGE_TARGET_KEY
ACHILLEA_STORAGE_TARGET_ROOT
ACHILLEA_STORAGE_MIGRATION_DIR
ACHILLEA_STORAGE_MIGRATION_CONCURRENCY
```

`ACHILLEA_STORAGE_TARGET_URL`, `ACHILLEA_STORAGE_TARGET_ROOT`, le dossier
d’état et la concurrence ont des valeurs sûres par défaut. La concurrence vaut
4 et reste obligatoirement comprise entre 1 et 8.

## Gate 1 — dry-run sans réseau

Charger le fichier secret en mode `0600`, puis valider séparément les trois
phases. Ces commandes ne créent aucun fichier et ne font aucun appel réseau :

```bash
set -a
. ~/.bash_secrets
set +a

bun scripts/rg/achillea/migrate-storage-objects.ts --inventory
bun scripts/rg/achillea/migrate-storage-objects.ts --migrate
bun scripts/rg/achillea/migrate-storage-objects.ts --verify
```

La sortie est volontairement expurgée : elle indique le project ref, le port
loopback, les buckets et le chemin d’état, mais aucune URL ni aucune clé.

## Gate 2 — inventaire et staging privés

Dans une fenêtre opérateur approuvée et sous gel des écritures Cloud :

```bash
bun scripts/rg/achillea/migrate-storage-objects.ts \
  --inventory --execute --confirm ACHILLEA_STORAGE_MIGRATION
```

L’outil vérifie d’abord la visibilité des deux buckets source. Il parcourt
récursivement tous les préfixes avec pagination, refuse les noms ambigus ou les
traversées de chemin, puis télécharge chaque objet dans un fichier au nom
opaque. Pour chaque objet, il enregistre :

- bucket et nom canonique ;
- taille exacte en octets ;
- SHA-256 calculé sur les octets reçus ;
- type déterminé par magic bytes ;
- chemin de staging relatif et non contrôlé par le nom source.

Le dossier d’état et ses sous-dossiers sont forcés en `0700`; blobs, manifeste,
journaux de progression et rapports sont forcés en `0600`. Le manifeste final
est écrit atomiquement. `inventory-progress.ndjson` permet de reprendre : un
blob déjà présent n’est accepté que si son mode, sa taille, son SHA-256 et son
magic sont encore conformes.

Conserver la synthèse `objectCount` et `totalBytes` dans le journal de la
fenêtre, sans publier le manifeste : les noms d’objets peuvent constituer des
métadonnées sensibles.

## Gate 3 — copie idempotente

Après validation du manifeste et de l’inventaire PostgreSQL :

```bash
bun scripts/rg/achillea/migrate-storage-objects.ts \
  --migrate --execute --confirm ACHILLEA_STORAGE_MIGRATION
```

Avant le premier upload, l’outil :

1. revérifie le contrat public/privé des buckets cibles ;
2. refuse tout objet cible absent du manifeste source ;
3. revalide chaque blob stagé par mode, taille, SHA-256 et magic bytes.

Pour chaque objet, il lit d’abord la cible. Un objet déjà identique est sauté.
Sinon, il effectue un upload authentifié avec `x-upsert: true`, puis
retélécharge immédiatement la cible et exige la même taille et le même SHA-256.
Une entrée n’est ajoutée à `migration-progress.ndjson` qu’après cette preuve.
Relancer exactement la même commande est donc sûr : les objets validés sont
sautés, les objets absents ou divergents sont recopiés.

L’outil n’efface jamais un objet source ou cible. Toute erreur HTTP est
rapportée uniquement par opération et code de statut, sans corps de réponse,
en-tête d’authentification ou URL.

## Gate 4 — vérification exhaustive

Toujours sous gel des écritures :

```bash
bun scripts/rg/achillea/migrate-storage-objects.ts \
  --verify --execute --confirm ACHILLEA_STORAGE_MIGRATION
```

La vérification exige l’égalité de l’inventaire des noms et contrôle chaque
objet cible par taille, SHA-256 et magic bytes. Le rapport privé
`verification.json` contient le nombre d’objets, le total d’octets et zéro
échec attendu. Les identifiants d’échec éventuels sont des SHA-256 opaques, pas
des noms de fichiers.

La bascule est interdite tant que les quatre conditions suivantes ne sont pas
simultanément vraies :

- inventaire PostgreSQL source/cible identique ;
- `objectCount` et `totalBytes` Storage attendus ;
- `failureCount` égal à zéro ;
- tests de lecture publique pour `images` et par URL signée pour
  `ranked-proofs` réussis via la passerelle Achillea.

## Reprise, incident et retour arrière

- Une interruption d’inventaire se reprend en relançant Gate 2.
- Une interruption de copie se reprend en relançant Gate 3.
- Ne jamais éditer manuellement les fichiers NDJSON ou le manifeste. Si leur
  intégrité est douteuse, déplacer tout le dossier d’état vers une archive
  privée horodatée et recommencer l’inventaire.
- En cas de divergence cible inattendue, arrêter : elle peut signaler une
  mauvaise cible ou des écritures concurrentes. Ne rien supprimer
  automatiquement.
- Avant la bascule, le retour arrière consiste simplement à garder les clients
  sur le Cloud. Après la bascule, repointer les clients vers le Cloud pendant
  qu’il reste gelé; ne supprimer la pile locale isolée qu’après décision
  opérateur et sauvegarde.
- La purge du staging et la révocation des credentials sont des opérations
  séparées, destructives, non implémentées par cet outil.

## Validation du code

Les tests n’effectuent aucun appel réseau réel et utilisent deux stockages
mémoire séparés :

```bash
bun test scripts/rg/achillea/migrate-storage-objects.test.ts
bunx oxlint scripts/rg/achillea/migrate-storage-objects.ts \
  scripts/rg/achillea/migrate-storage-objects.test.ts
```

Ils couvrent les refus de cible, les dossiers interdits, le double opt-in, la
pagination récursive, les magic bytes, la concurrence bornée, les modes privés,
le non-logging des secrets, la reprise idempotente, le refus d’objets cibles
hors manifeste et la vérification finale.
