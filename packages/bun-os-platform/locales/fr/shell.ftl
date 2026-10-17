app-name = Bun OS
nav-games = Jeux
nav-library = Bibliothèque
nav-downloads = Téléchargements
nav-settings = Paramètres
nav-power = Alimentation
action-play = Jouer
action-resume = Reprendre
action-restart = Recommencer
action-return = Retour au jeu
action-steam-page = Ouvrir dans Steam
action-open = Ouvrir
action-game-hub = Fiche du jeu
action-home = Accueil
action-close-game = Fermer le jeu
action-screenshot = Capture d'écran
action-record = Enregistrer
action-performance = Performances
action-frame-limit = Limite d'images
action-scaling = Mise à l'échelle
action-volume-down = Baisser le volume
action-volume-up = Monter le volume
action-cancel = Annuler
action-desktop = Revenir au bureau
action-close-shell = Fermer Bun OS
action-sleep = Veille
action-restart-pc = Redémarrer le PC
action-shutdown = Éteindre
library-count = { $count ->
    [one] { $count } jeu
   *[other] { $count } jeux
}
library-all = Tous
library-steam = Steam
library-emulators = Émulateurs
library-web = Web
library-empty-emulators = Aucun jeu émulé pour l'instant. Ajoutez un dossier de ROM avec bun-engine library add
platform-steam = Steam
platform-steam-not-installed = Steam, non installé
platform-web = Cœur web
meta-instant-resume = Reprise instantanée prête
meta-bun-engine = Bun Engine
meta-last-played = Joué le { $date }
hub-profile = Profil du jeu
hub-details = Détails
hub-suspended-memory = Suspendu en mémoire : reprise instantanée
hub-suspended-disk = Suspendu sur disque : reprise là où vous vous êtes arrêté
profile-frame-limit = Limite d'images
profile-scaling = Mise à l'échelle
profile-borderless = Plein écran sans bordure
profile-instant-resume = Reprise instantanée
profile-performance = Indicateur de performances
value-on = Activé
value-off = Désactivé
value-display-rate = Fréquence de l'écran
value-fps = { $fps } i/s
value-sharp = Net (plus proche voisin)
value-smooth = Lissé (bilinéaire)
value-fsr1 = FSR 1
value-system = Système ({ $mode })
value-reduced = Réduit
value-full = Complet
value-registered = Enregistré
value-not-registered = Non enregistré
value-recording = Enregistrement
downloads-steam = Transferts Steam
downloads-none = Aucun téléchargement ni mise à jour en cours
downloads-packages = Émulateurs installés par bep
downloads-progress = { $done } sur { $total } Go
settings-console = Console
settings-haptics = Vibrations de la manette
settings-motion = Animations réduites
settings-performance = Indicateur de performances
settings-reload = Recharger la bibliothèque
settings-session = Démarrer à l'ouverture de session
settings-desktop = Revenir au bureau
settings-system = Système
quick-title = Menu rapide
quick-nvidia = NVIDIA
quick-display = Affichage et capture
quick-session = Session
power-title = Alimentation
activity-title = Activité
activity-resume = Reprendre
activity-running = En cours
activity-downloads = Téléchargements
activity-transfers = { $count ->
    [one] { $count } transfert Steam
   *[other] { $count } transferts Steam
}
activity-packages = { $count ->
    [one] { $count } émulateur installé
   *[other] { $count } émulateurs installés
}
activity-last = Dernière partie
toast-resumed = { $title } a repris
toast-resumed-disk = { $title } a repris là où vous vous étiez arrêté
toast-playing = En jeu : { $title }
toast-starting = Lancement de { $title }
toast-starting-steam = Lancement de { $title } dans Steam
toast-steam-page = { $title } ouvert dans Steam
toast-not-launched = { $title } n'a pas démarré : { $reason }
toast-suspended = Suspendu. La reprise est instantanée
toast-paused = En pause. Ce système ne peut pas sauvegarder son état
toast-closed = { $title } fermé
toast-screenshot = Capture enregistrée : { $path }
toast-recording = Enregistrement avec { $encoder }
toast-recorded = { $path } enregistré avec { $encoder }
toast-record-failed = Enregistrement arrêté : { $error }
toast-record-unavailable = L'enregistrement capture les jeux Bun Engine. Utilisez Steam ou la capture Windows pour les autres
toast-close-steam = Fermez les jeux Steam depuis le jeu
toast-asked-close = Fermeture de { $title } demandée
toast-back-from = Retour de { $title }
toast-not-started = { $title } n'a pas démarré
toast-reloaded = Bibliothèque rechargée : { $count ->
    [one] { $count } jeu
   *[other] { $count } jeux
}
toast-session = Pour démarrer à l'ouverture de session, lancez : { $command }
toast-start-failed = Impossible de lancer le jeu : { $error }
toast-stopped = { $name } arrêté
toast-cannot-save = Fermé : ce système ne peut pas sauvegarder son état
toast-controller = { $name } connectée
busy-steam = L'application Steam { $app } est en cours
busy-stream = { $name } diffuse
