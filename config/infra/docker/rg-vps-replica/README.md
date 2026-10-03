# Réplique Docker du VPS

Source de vérité : services et données du VPS, inventoriés le 23 septembre 2026. Les projets Supabase Cloud historiques ne sont plus utilisés par cette infrastructure.

Le clone contient **une instance PostgreSQL 18**, **une instance Redis 8.0.5** et **un seul volume de fichiers `/var/www`**. La base applicative unifiée est `rg` : Achilléa utilise son schéma `achillea`, ses comptes `auth` et son index `storage`. Tous les services applicatifs du clone se connectent à `rg`. Les cinq bases présentes sur le VPS (`achillea`, `aphrody`, `postgres`, `rg`, `stack`) sont importées pour conserver l'état du serveur ; la base `achillea` est historique et n'est utilisée par aucun service du clone.

Le RDB Redis est copié intégralement. Il contient 1 047 995 clés au dernier contrôle `redis-check-rdb` ; les bases logiques 0, 1, 2, 3, 4 et 9 ne sont donc pas réduites à la seule DB 1 utilisée par le bot. Redis est arrêté sur le VPS au moment de cet inventaire ; le clone démarre sur le dernier état durable de `/var/lib/redis/dump.rdb`.

## Transfert initial

Depuis la racine du dépôt, avec Docker Desktop et l'alias SSH `ovh-vps` :

```powershell
& .\infra\docker\vps-replica\replicate.ps1
```

Le script transmet directement les extensions, le RDB, `/var/www` avec le lien Achilléa résolu, la release Aphrody et `pg_dumpall` dans leurs volumes Docker finaux. Il ne crée ni archive intermédiaire, ni deuxième base miroir. Il refuse les volumes non vides pour éviter un écrasement accidentel. Les empreintes SHA-256 du RDB et de tous les fichiers accessibles par `/var/www` sont comparées avec le VPS avant l'import PostgreSQL. Le secret JWT nécessaire aux API est lu dans la configuration VPS et passé en mémoire au lancement ; aucune valeur n'est affichée ni écrite dans le dépôt.

Après le premier transfert, `start.ps1` redémarre les conteneurs existants sans accès au VPS et sans fichier de secret. `verify.ps1` compare les empreintes des lignes de toutes les tables, les rôles, Redis, le binaire du site et les routes HTTP.

## Accès local

| Surface | Adresse locale |
| --- | --- |
| Aphrody + façade Supabase | `http://127.0.0.1:8088` |
| PostgreSQL (les cinq bases) | `127.0.0.1:5432` |
| Redis (toutes les DB logiques) | `127.0.0.1:16380` |
| PostgREST direct | `http://127.0.0.1:8809` |
| Storage RG direct | `http://127.0.0.1:8810` |
| Passerelle Supabase RG | `http://127.0.0.1:8811` |
| Realtime direct | `http://127.0.0.1:8812` |
| Storage Achilléa direct | `http://127.0.0.1:8821` |
| Realtime Achilléa (alias du service commun) | `http://127.0.0.1:8822` |
| Passerelle Supabase Achilléa | `http://127.0.0.1:8823` |

Le port `6379` de Windows appartient déjà à un relais WSL ; `16380` garde le clone Docker distinct de ce service existant. Dans les conteneurs, Redis reste `redis:6379`.

Les passerelles desservent REST, Storage, Realtime et GraphQL depuis la base locale. L'API GoTrue d'Achilléa est retirée sur le VPS et répond `410` dans le clone ; les données `auth.users` sont conservées dans PostgreSQL. La release Aphrody active et son proxy HTTP/MCP sont reproduits. TLS, certificats, DNS public et services système de l'hôte ne sont pas exposés par le clone local.
