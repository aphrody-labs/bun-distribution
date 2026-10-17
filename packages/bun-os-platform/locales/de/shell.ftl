app-name = Bun OS
nav-games = Spiele
nav-library = Bibliothek
nav-downloads = Downloads
nav-settings = Einstellungen
nav-power = Energie
action-play = Spielen
action-resume = Fortsetzen
action-restart = Neu starten
action-return = Zurück zum Spiel
action-steam-page = In Steam öffnen
action-open = Öffnen
action-game-hub = Spielübersicht
action-home = Startseite
action-close-game = Spiel beenden
action-screenshot = Screenshot
action-record = Aufnehmen
action-performance = Leistung
action-frame-limit = Bildratenlimit
action-scaling = Skalierung
action-volume-down = Leiser
action-volume-up = Lauter
action-cancel = Abbrechen
action-desktop = Zum Desktop zurückkehren
action-close-shell = Bun OS beenden
action-sleep = Energie sparen
action-restart-pc = PC neu starten
action-shutdown = Herunterfahren
library-count = { $count ->
    [one] { $count } Spiel
   *[other] { $count } Spiele
}
library-all = Alle
library-steam = Steam
library-emulators = Emulatoren
library-web = Web
library-empty-emulators = Noch keine emulierten Spiele. Füge mit bun-engine library add einen ROM-Ordner hinzu
platform-steam = Steam
platform-steam-not-installed = Steam, nicht installiert
platform-web = Web-Core
meta-instant-resume = Sofortige Fortsetzung bereit
meta-bun-engine = Bun Engine
meta-last-played = Zuletzt gespielt: { $date }
hub-profile = Spielprofil
hub-details = Details
hub-suspended-memory = Im Arbeitsspeicher angehalten: wird sofort fortgesetzt
hub-suspended-disk = Auf der Festplatte angehalten: wird dort fortgesetzt, wo du aufgehört hast
profile-frame-limit = Bildratenlimit
profile-scaling = Skalierung
profile-borderless = Randloser Vollbildmodus
profile-instant-resume = Sofortige Fortsetzung
profile-performance = Leistungsanzeige
value-on = Ein
value-off = Aus
value-display-rate = Bildwiederholrate
value-fps = { $fps } fps
value-sharp = Scharf (Nearest Neighbor)
value-smooth = Weich (bilinear)
value-fsr1 = FSR 1
value-system = System ({ $mode })
value-reduced = Reduziert
value-full = Vollständig
value-registered = Registriert
value-not-registered = Nicht registriert
value-recording = Aufnahme läuft
downloads-steam = Steam-Übertragungen
downloads-none = Kein Download oder Update aktiv
downloads-packages = Von bep installierte Emulatoren
downloads-progress = { $done } von { $total } GB
settings-console = Konsole
settings-haptics = Controller-Vibration
settings-motion = Bewegung reduzieren
settings-performance = Leistungsanzeige
settings-reload = Bibliothek neu laden
settings-session = Bei der Anmeldung starten
settings-desktop = Zum Desktop zurückkehren
settings-system = System
quick-title = Schnellmenü
quick-nvidia = NVIDIA
quick-display = Anzeige und Aufnahme
quick-session = Sitzung
power-title = Energie
activity-title = Aktivität
activity-resume = Fortsetzen
activity-running = Läuft
activity-downloads = Downloads
activity-transfers = { $count ->
    [one] { $count } Steam-Übertragung
   *[other] { $count } Steam-Übertragungen
}
activity-packages = { $count ->
    [one] { $count } Emulator installiert
   *[other] { $count } Emulatoren installiert
}
activity-last = Zuletzt gespielt
toast-resumed = { $title } fortgesetzt
toast-resumed-disk = { $title } dort fortgesetzt, wo du aufgehört hast
toast-playing = { $title } wird gespielt
toast-starting = { $title } wird gestartet
toast-starting-steam = { $title } wird in Steam gestartet
toast-steam-page = { $title } in Steam geöffnet
toast-not-launched = { $title } wurde nicht gestartet: { $reason }
toast-suspended = Angehalten. Die Fortsetzung erfolgt sofort
toast-paused = Pausiert. Dieses System kann seinen Zustand nicht speichern
toast-closed = { $title } beendet
toast-screenshot = Screenshot gespeichert: { $path }
toast-recording = Aufnahme mit { $encoder }
toast-recorded = { $path } mit { $encoder } aufgenommen
toast-record-failed = Aufnahme beendet: { $error }
toast-record-unavailable = Die Aufnahme erfasst Bun Engine-Spiele. Verwende für andere die Aufnahme von Steam oder Windows
toast-close-steam = Steam-Spiele aus dem Spiel heraus beenden
toast-asked-close = { $title } wurde zum Beenden aufgefordert
toast-back-from = Zurück aus { $title }
toast-not-started = { $title } wurde nicht gestartet
toast-reloaded = Bibliothek neu geladen: { $count ->
    [one] { $count } Spiel
   *[other] { $count } Spiele
}
toast-session = Zum Starten bei der Anmeldung ausführen: { $command }
toast-start-failed = Das Spiel konnte nicht gestartet werden: { $error }
toast-stopped = { $name } beendet
toast-cannot-save = Beendet: Dieses System kann seinen Zustand nicht speichern
toast-controller = { $name } verbunden
busy-steam = Steam-App { $app } läuft
busy-stream = { $name } streamt
