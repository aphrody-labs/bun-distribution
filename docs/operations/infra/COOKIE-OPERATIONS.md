# Cookie operations contract

Les cookies Google/Gemini sont des identifiants de session. Ils ne sont jamais
versionnés, copiés entre Windows/WSL/VPS, envoyés par MCP, placés dans un dump
ou écrits dans les journaux.

Chaque hôte utilise son propre magasin BXC :

- Windows : `%USERPROFILE%\\.aphrody\\cookies`
- WSL : `$HOME/.aphrody/cookies`
- VPS : `$HOME/.aphrody/cookies`

La racine est partagée par `APHRODY_HOME`; `BXC_COOKIES_DIR` pointe vers son
sous-répertoire `cookies`. Aphrody Python,
Aphrody Web/BXC, Aphrody OS et les agents maison consomment cette variable et
ne connaissent pas de valeur de cookie. Le
référentiel ne contient que `config/cookie-layout.env.example` et le script de
préparation des permissions.

Après toute exposition d'un cookie, la session doit être révoquée depuis le
compte Google puis recréée localement sur chaque hôte qui en a réellement
besoin. Une authentification sur Windows ne constitue pas une autorisation
pour un VPS.

## Préparation

Windows : `pwsh -File scripts/tools/secure-cookie-layout.ps1`

Linux/WSL/VPS : `bash scripts/tools/secure-cookie-layout.sh`

Ces scripts ne lisent ni n'affichent le contenu des fichiers. Ils créent le
répertoire, imposent les permissions du propriétaire et exportent
`BXC_COOKIES_DIR` pour le processus appelant.
