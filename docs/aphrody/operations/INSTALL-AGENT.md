<!-- SPDX-License-Identifier: Apache-2.0 -->
# Installation complète Aphrody par agent CLI

Exécute cette tâche dans le clone privé Aphrody courant. Installe et configure
le poste jusqu'aux vérifications finales, sans confirmation intermédiaire.
L'accès au dépôt privé, au fournisseur IA et aux hôtes/registre utilisés doit
déjà être authentifié. Les règles du dépôt et les capacités réellement
disponibles déterminent les opérations permises.

## 1. Préparer le poste

- Lis `AGENTS.md`, `GOAL.md`, `PLAN.md`, `MEMORY.md` et les instructions locales
  applicables. Préserve les changements existants et les profils de domaine.
- Identifie OS, architecture, libc, espace disque et outils installés. Consulte
  les aides des CLI avant utilisation. Utilise les outils Aphrody exposés puis
  leur CLI propriétaire si la capacité n'est pas callable.
- Installe les dépendances déclarées pour ce poste depuis les catalogues Infra,
  avec les versions des manifests et locks. Les scripts
  `scripts/dev/bootstrap.sh` et `scripts/dev/bootstrap.ps1` sont les propriétaires
  de l'environnement source ; inspecte leur comportement avant exécution.
  Choisis l'hôte de compilation selon le contexte, la cible et ses ressources :
  natif, Docker ou fabrique SSH qualifiée avec ses verrous. Privilégie les binaires précompilés.
- Initialise le sous-module `plugins` si nécessaire. Charge uniquement les
  compétences Aphrody/Yolo de ce checkout. Installe le skill Docker fourni
  dans `plugins/yolo/skills/docker` avec le gestionnaire existant.

## 2. Installer les produits depuis une release unique

- Récupère `https://downloads.aphrody.com/latest.json` une seule fois. Valide
  l'identifiant et garde cette release immuable pour tous les téléchargements.
  Consulte son manifeste pour les composants réellement publiés sur la cible.
- Télécharge l'installateur depuis `releases/<id>/install.sh` ou `install.ps1`,
  vérifie son SHA-256 dans `manifest.assetChecksums`, puis exécute la copie
  vérifiée avec `APHRODY_RELEASE=<id>`. Sélectionne explicitement `aphrody`,
  `yolo`, `plugin-aphrody` et `plugin-yolo` selon leur disponibilité.
  L'option `mcp` de l'installateur shell enregistre Claude Code : utilise-la
  seulement si Claude est présent ; pour Codex ou un autre fournisseur,
  enregistre le binaire installé par le gestionnaire de plugins ci-dessous.
  Vérifie les archives avec le manifeste et `SHA256SUMS` de cette même release.
- Installe les produits dans le préfixe utilisateur. Préserve les mécanismes
  d'activation atomique et de retour à la version précédente. N'écrase pas un
  binaire en cours d'utilisation ou un store protégé.
- Configure le fournisseur CLI courant via
  `yolo workspace plugins --help`, puis ses commandes `install` et `validate`
  avec le store physique `plugins`, le fournisseur détecté et le scope adéquat.
  Déclare un seul serveur MCP : `aphrody-mcp`. Vérifie le binaire et son aide
  avant d'enregistrer son chemin ; aucun alias MCP kernel/Yolo déprécié.
- Installe `vu` et le SDK FFI depuis les artefacts qualifiés lorsqu'ils sont
  disponibles. Pour un composant absent, prépare et exécute sa recette de
  build propriétaire sur la cible/usine appropriée, avec provenance, gates
  et contrôle ABI avant activation. Un artefact absent reste un écart explicite.

## 3. Configurer Docker et le navigateur

- Suis [le runbook conteneur](container/CONTAINER.md) pour Docker Engine,
  Buildx et Compose, les images runtime, Alpine, builder et desktop.
  Consulte les catalogues/runbooks Infra avant tout changement d'hôte.
  Utilise les images déjà qualifiées et leurs digests, avec l'authentification
  GHCR privée existante. Construis les cibles manquantes par l'usine.
- Configure l'API et le MCP avec les fichiers Compose du dépôt : utilisateur
  sans privilèges, volumes persistants déclarés, ports locaux, racine en
  lecture seule et secrets montés. Vérifie les healthchecks et l'arrêt propre.
- Suis [le runbook secrets](container/SECRETS.md). Garde les clés, tokens,
  cookies, bases, modèles et données dans leurs stores protégés. Aucun secret
  dans une image, un argument de build, la documentation, Git ou les logs.
  La sauvegarde chiffrée reste distincte de sa clé locale.
- Installe le paquet `aphrody-cli-wasm` depuis le manifeste de la même release,
  vérifie son archive et sa provenance. Intègre son ESM et son unique fichier
  WASM selon [son README](../../../packages/cli-wasm/README.md). Vérifie le
  chargement bytes/streaming et une opération réelle dans le navigateur cible.
  Le navigateur utilise WASM ; `bun:ffi` exige le runtime natif et un ABI validé.
- Prépare l'interface desktop via son propriétaire CEF et sa recette dédiée.
  Distingue une image avec environnement graphique de l'application Aphrody
  réellement installée et exécutée.

## 4. Vérifier et livrer

- Vérifie les versions, chemins actifs et digests ; CLI `--help`, échange MCP
  initialize/tools/list, healthcheck API, arrêt Docker, opération WASM et
  appel FFI/Python si les artefacts sont disponibles. Respecte les gates
  ciblés du dépôt et la sérialisation Cargo.
- Sur Windows/macOS/ARM, vérifie les composants sur la cible réelle ; une
  compilation croisée ou Wine ne prouve pas leur exécution native.
- Termine avec les composants installés, release/digests, commandes de
  démarrage et rollback, résultats et écarts précis. Ne déclare pas complet
  un composant non publié, non exécuté ou sans authentification disponible.
  N'invente aucun gain de performance.

Référence Codex : [CLI officielle](https://developers.openai.com/codex/cli/reference/).
