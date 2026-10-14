# Aphrody / Bun

Réponds en français, de façon concise. Aphrody et Bun portent l’identité du
produit. Les dépôts upstream sont des sources de bibliothèques. Préserve les
attributions, licences et notices.

Read GOAL.md, PLAN.md, MEMORY.md and START-HERE.md before changes.
Resolve paths from this checkout or explicit configuration. Never start WSL.
Native, SSH and Docker hosts retain separate permissions and qualification.

Utilise Bun 1.4.4 pour JavaScript et TypeScript et ses API natives.
Les contrôles TypeScript, lint, formatage et migration sont exclusivement
`bun check`, `bun lint`, `bun fmt` et `bun n2b`, lancés directement. N’utilise
aucun alias qui délègue ces contrôles à un sous-processus, `bunx`, Oxc autonome,
tsgo/tsc, ESLint, Prettier ou un n2b externe. Corrige les échecs natifs sans
fallback. Les dépendances d’outillage de ces contrôles ne doivent pas être
installées dans les packages.

Suis docs/style.md et les sources actuelles Linux, Debian, COSMIC et Bun.
Réutilise le SDK Bun Tauri v3 épinglé. Garde les historiques Git et workspaces
Cargo upstream indépendants. Publie les changements de bibliothèque avant les
pointeurs de sous-modules.

Preserve concurrent work and protected stores. Do not import sessions or secrets.
Bound long commands and serialize native builds. Do not add or run tests unless
explicitly requested. Commit owned paths as aphrody-dev <contact@aphrody.com>,
without co-authors. Fetch and check ancestry before push. Never force-push.
