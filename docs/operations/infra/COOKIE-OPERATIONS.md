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
référentiel ne contient que `tools/config/cookie-layout.env.example` et le script de
préparation des permissions.

Après toute exposition d'un cookie, la session doit être révoquée depuis le
compte Google puis recréée localement sur chaque hôte qui en a réellement
besoin. Une authentification sur Windows ne constitue pas une autorisation
pour un VPS.

## Préparation

Tous hôtes : `bun --no-env-file scripts/tools/secure-cookie-layout.ts [--home <dir>] [--dir <cookies>]`

Le script ne lit ni n'affiche le contenu des fichiers. Il crée le répertoire et
le réserve à l'utilisateur courant : DACL protégée accordée à son seul SID via
`bun:ffi` sur Windows (sans PowerShell ni `icacls`), mode 0700 ailleurs. Sur
Windows il persiste `APHRODY_HOME` et `BXC_COOKIES_DIR` dans l'environnement
utilisateur ; ailleurs il affiche les deux affectations à reporter dans le profil
ou l'unité de l'hôte. Un `BXC_COOKIES_DIR` exporté qui désigne un autre
répertoire est refusé.
