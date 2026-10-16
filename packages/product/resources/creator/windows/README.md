<!-- SPDX-License-Identifier: Apache-2.0 -->

# creator-kit / windows

Trois scripts PowerShell (Windows 11, Windows PowerShell 5.1 par défaut ou PowerShell 7, aucun module à installer).
Chacun est en **dry-run par défaut** (`-Apply` pour agir), sauvegarde ce qu'il modifie et offre un retrait.

**Exécution sous Windows : NON testée.** Les scripts ont été écrits sous Linux : analyse syntaxique, analyse statique
et compilation du C# embarqué seulement (détail en bas). Premier essai : lancez sans `-Apply` et lisez le plan.

Lancement (le fichier téléchargé peut être bloqué) :

```powershell
Unblock-File .\*.ps1
powershell -ExecutionPolicy Bypass -File .\dead-zone.ps1 -ListMonitors
```

Les scripts sont en UTF-8 avec BOM (accents lisibles en 5.1). Les parties graphiques (`dead-zone`, lanceur de `playnite-boost`) compilent
du C# via `Add-Type` : préférez `powershell.exe` (5.1) ; les tâches planifiées créées l'utilisent toujours.

## 1. dead-zone.ps1 : « 10 % de mon écran est mort »

Windows n'a pas d'option native pour réduire la surface du bureau, et une zone morte matérielle ne se répare pas par logiciel.
Le script réserve la bande comme **barre d'application** (comme la barre des tâches) peinte en noir : les fenêtres maximisées ne passent plus dessous.

```powershell
.\dead-zone.ps1 -ListMonitors                       # index, bornes en pixels physiques, DPI
.\dead-zone.ps1 -Edge Right -Percent 10             # plan seul
.\dead-zone.ps1 -Edge Right -Percent 10 -Run -Apply # maintenant ; icône de notification > Quitter
.\dead-zone.ps1 -Edge Right -Percent 10 -Install -Apply   # à chaque session (tâche masquée, utilisateur courant)
.\dead-zone.ps1 -Edge Right -Stop                   # sortie propre depuis une autre fenêtre
.\dead-zone.ps1 -Edge Right -Uninstall -Apply       # arrête, exporte le XML de la tâche, supprime
```

Options : `-Edge Left|Right|Top|Bottom`, `-Percent` (de la dimension perpendiculaire) ou `-Pixels` (physiques), `-Monitor <index>` (défaut : principal).
DPI : le processus se déclare Per-Monitor v2 (`SetProcessDpiAwarenessContext(-4)`, repli `SetProcessDpiAwareness(2)` puis `SetProcessDPIAware`) **avant** toute fenêtre ;
toutes les valeurs sont donc en pixels physiques. Si l'hôte est déjà « unaware », `-Run` refuse.
Limite connue : le shell place la barre des tâches au bord extérieur ; une zone morte en bas passerait donc sous la barre des tâches.

Alternatives sans script (documentées, **non testées**) :

- **NVIDIA** : Panneau > Affichage > _Ajuster la taille et la position du bureau_ > onglet _Mise à l'échelle_ (Aspect ratio / Full-screen / No scaling / Integer scaling), _Perform scaling on_ : GPU. Pour un téléviseur, la page NVIDIA conseille d'abord les réglages de l'écran (« Just Scan », « 1:1 », « Screen Fit »). Création de résolution personnalisée : non trouvée dans la doc consultée.
- **AMD Software: Adrenalin** : rechercher « Display » > _GPU Scaling_ = Enabled, _Scaling Mode_ : Preserve aspect ratio / Full panel / Center ; _HDMI Scaling_ (curseur d'overscan, HDMI uniquement) ; _Custom Resolutions_ (Create New).
- **Intel Graphics Command Center** : Display > _Scale_ : Centered / Stretched / Maintain Aspect Ratio / Maintain Display Scaling / **Custom** (curseurs d'overscan ; indisponible sur les écrans intégrés de portable, d'après les pages Intel).
- Menu OSD de l'écran : taille/position de l'image.
  Ces réglages réduisent l'image de façon symétrique ; qu'ils conviennent à une bande d'un seul côté n'est pas vérifié.

## 2. playnite-boost.ps1 : démarrage et optimisation de Playnite

Arguments utilisés, **tous vérifiés** dans `CmdLineOptions.cs` (dépôt, master du 2026-10-06) et la doc « Application arguments » :
`--hidesplashscreen --nolibupdate --startdesktop --startfullscreen --startclosedtotray`. Les noms `--skiplibupdate`, `--safemode`, `--clearcache` n'existent pas
(les vrais : `--nolibupdate`, `--safestartup`, `--clearwebcache`).
Playnite est mono-instance : relancer l'exécutable sans argument restaure l'instance existante (`CheckOtherInstances`), donc jamais de doublon.

```powershell
.\playnite-boost.ps1 -Optimize                                  # rapport lecture seule
.\playnite-boost.ps1 -StartupTask -DelaySeconds 30 -Mode Fullscreen -SkipLibraryUpdate -Apply
.\playnite-boost.ps1 -Hotkey 'Ctrl+Alt+G' -Apply               # lanceur en zone de notification (démarre ou focalise)
.\playnite-boost.ps1 -Hotkey 'Ctrl+Alt+G' -InstallHotkeyTask -Apply
.\playnite-boost.ps1 -Optimize -DisableExtension MonId -Apply  # déplacé (jamais supprimé) ; annulation : -RestoreExtension MonId -Apply
.\playnite-boost.ps1 -Optimize -ClearCache Web -Apply          # caches reconstructibles seulement
.\playnite-boost.ps1 -Stop ; .\playnite-boost.ps1 -Uninstall -Apply
```

Réglages natifs équivalents : « Launch Playnite when you start your computer » (+ « Start closed to tray ») crée `Playnite.lnk` dans le dossier Démarrage avec `--hidesplashscreen` ;
« Launch in Fullscreen Mode » ; « Update libraries » (Only manually / Once a day / Once a week / On every startup, défaut : à chaque démarrage). Si `Playnite.lnk` existe, le script le signale (désactivez l'un des deux).
`-Optimize` détecte portable (pas de `unins000.exe` : données dans le dossier du programme) ou `%APPDATA%\Playnite`, liste extensions/thèmes avec tailles, lit `config.json`, mesure le démarrage dans `playnite.log`
(écart « Application started from » → « Application X started »), signale les motifs lourds (heuristiques de ma part : ≥ 4 plugins de bibliothèque actifs + mise à jour à chaque démarrage, vidéo/animation dans un thème, thème > 100 Mo, ≥ 15 extensions tierces).
Les extensions intégrées (`*_Builtin`) ne sont jamais déplacées ; Playnite doit être fermé (le script ne le ferme jamais) ; `JITProfiles` n'est jamais vidé. Sauvegarde native avant tout : `Playnite.DesktopApp.exe --backup <dossier>`.

## 3. stacher-cookies.ps1 : blocage des cookies (redémarrer le PC / changer de navigateur)

Causes (sources primaires) :

1. **Verrou** : Chrome/Edge ouvrent `Network\Cookies` en exclusif sous Windows tant qu'un processus tourne, y compris en arrière-plan ; yt-dlp échoue avec « Could not copy Chrome cookie database » ([yt-dlp #7271](https://github.com/yt-dlp/yt-dlp/issues/7271), ouverte). Redémarrer ou tuer tous les processus lève le verrou.
2. **App-Bound Encryption** (Chrome 127+, [blog Google](https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html)) : « Failed to decrypt with DPAPI » ([#10927](https://github.com/yt-dlp/yt-dlp/issues/10927), ouverte ; les mainteneurs proposent Firefox ou un export par extension). Fermer le navigateur n'y change rien.
3. Firefox n'a pas ce chiffrement ; `cookies.py` copie `cookies.sqlite` (pas le `-wal` : des cookies très récents peuvent manquer, déduit du code).

Stacher est fermé et non patchable : le script agit en amont (`cookies.txt` à chemin stable via `yt-dlp --cookies-from-browser X --cookies fichier`, sans URL : yt-dlp écrit le fichier puis sort avec le code 2, attendu).

```powershell
.\stacher-cookies.ps1                                   # diagnostic lecture seule
.\stacher-cookies.ps1 -Export -Browser firefox -Domains youtube.com,google.com -Apply
.\stacher-cookies.ps1 -Export -Browser chrome -CloseBrowser -Apply   # liste, ferme proprement ; -ForceKill pour les restes (explicite)
.\stacher-cookies.ps1 -Schedule -EveryHours 6 -Domains youtube.com,google.com -Apply   # Firefox seulement
.\stacher-cookies.ps1 -Uninstall -Apply                # retire la tâche et supprime cookies.txt/.prev/journal
```

Fichier : `%LOCALAPPDATA%\Aphrody\creator-kit\cookies\cookies.txt` (ACL = utilisateur courant seul ; l'ancien fichier reste en `.prev`). Les valeurs ne sont jamais affichées ni journalisées.
**`cookies.txt` donne accès à vos comptes** : ne le partagez pas, limitez-le avec `-Domains`, supprimez-le après usage. YouTube fait tourner les cookies des sessions ouvertes (wiki yt-dlp : exporter depuis une fenêtre privée) : un export normal peut expirer vite.
Stacher : la copie de yt-dlp serait dans `%USERPROFILE%\.stacher\` (source secondaire) ; le changelog officiel mentionne un réglage « Custom Arguments » : essayez `--cookies "<chemin>"` là. **L'option cookies de Stacher n'a pas pu être vérifiée** (site SPA sans doc, Reddit inaccessible).

## Vérifié / Non vérifié

| Sujet         | Vérifié (source)                                                                                                                                                                                                                                                                                                                                                      | Non vérifié                                                                                                            |
| :------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| Appbar        | `SHAppBarMessage`, `APPBARDATA` (36 o x86 / 48 o x64), ABM_/ABN_/ABE_ (Learn + `shellapi.h`), séquence NEW → QUERYPOS → SETPOS, REMOVE avant destruction                                                                                                                                                                                                              | Rendu réel, multi-écran, interaction barre des tâches, nettoyage après arrêt brutal, flash console de la tâche masquée |
| DPI           | `SetProcessDpiAwarenessContext` (échec si déjà défini, avant toute fenêtre), constantes -1..-5, enum `DPI_AWARENESS`                                                                                                                                                                                                                                                  | `GetDpiForMonitor` (affichage seul), comportement sous ISE                                                             |
| Raccourci     | `RegisterHotKey` (MOD_*, NOREPEAT, F12 réservée, WM_HOTKEY)                                                                                                                                                                                                                                                                                                           | Conflits de raccourcis, balloon de notification                                                                        |
| Tâches        | cmdlets ScheduledTasks (Learn) ; `LogonTrigger.Delay` ISO 8601 (pas de `-Delay` dans `New-ScheduledTaskTrigger`)                                                                                                                                                                                                                                                      | Création sans élévation, comportement du délai sur CimInstance                                                         |
| Playnite      | arguments, mono-instance, `Playnite.lnk`, chemins, portable, IDs intégrés, réglages et libellés (code source du dépôt)                                                                                                                                                                                                                                                | Format réel de `playnite.log` (déduit de la mise en page NLog par défaut), seuils d'heuristiques, lancement réel       |
| yt-dlp        | README, FAQ, `cookies.py`, `__init__.py`/`YoutubeDL.py` (sortie sans URL), issues #7271 et #10927, blog Chrome 127, clé `os_crypt.app_bound_encrypted_key` (code Chromium)                                                                                                                                                                                            | Fonctionnement réel avec vos navigateurs, version minimale Edge/Brave pour App-Bound                                   |
| Stacher       | site officiel (SPA), changelog (« Custom Arguments », yt-dlp nightly par défaut)                                                                                                                                                                                                                                                                                      | Option cookies, chemin `.stacher` (secondaire), prise en charge de `--cookies`                                         |
| GPU           | pages NVIDIA, AMD, Intel lues                                                                                                                                                                                                                                                                                                                                         | Toute manipulation réelle ; création de résolution NVIDIA                                                              |
| Local (Linux) | `Parser.ParseFile` PowerShell 7.6 : 3 scripts OK ; PSScriptAnalyzer 1.25 (`PSUseCompatibleSyntax` 5.1/7.0 : aucun écart) ; C# compilé avec le SDK .NET contre .NET Framework 4.8 (C# 5) et net10.0-windows : 0 erreur ; logique testée sur données factices (rapport/déplacement/restauration/caches Playnite, export cookies avec faux yt-dlp, arguments des tâches) | Tout ce qui touche Win32, WinForms, Task Scheduler, ACL et processus Windows                                           |
