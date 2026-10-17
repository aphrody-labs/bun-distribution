# Bun OS console shell (crates/bun-os-shell). Shell keys `a.b` map to the Fluent id `a-b`.

app-name = Bun OS
nav-games = Games
nav-library = Library
nav-downloads = Downloads
nav-settings = Settings
nav-power = Power
action-play = Play
action-resume = Resume
action-restart = Restart
action-return = Return to game
action-steam-page = Open in Steam
action-open = Open
action-game-hub = Game hub
action-home = Home
action-close-game = Close game
action-screenshot = Screenshot
action-record = Record
action-performance = Performance
action-frame-limit = Frame limit
action-scaling = Scaling
action-volume-down = Volume down
action-volume-up = Volume up
action-cancel = Cancel
action-desktop = Return to the desktop
action-close-shell = Close Bun OS
action-sleep = Sleep
action-restart-pc = Restart the PC
action-shutdown = Shut down
library-count = { $count ->
    [one] { $count } game
   *[other] { $count } games
}
library-all = All
library-steam = Steam
library-emulators = Emulators
library-web = Web
library-empty-emulators = No emulated games yet. Add a ROM folder with bun-engine library add
platform-steam = Steam
platform-steam-not-installed = Steam, not installed
platform-web = Web core
meta-instant-resume = Instant resume ready
meta-bun-engine = Bun Engine
meta-last-played = Last played { $date }
hub-profile = Game profile
hub-details = Details
hub-suspended-memory = Suspended in memory: resumes instantly
hub-suspended-disk = Suspended on disk: resumes where you left off
profile-frame-limit = Frame limit
profile-scaling = Scaling
profile-borderless = Borderless full screen
profile-instant-resume = Instant resume
profile-performance = Performance overlay
value-on = On
value-off = Off
value-display-rate = Display rate
value-fps = { $fps } fps
value-sharp = Sharp (nearest)
value-smooth = Smooth (bilinear)
value-fsr1 = FSR 1
value-system = System ({ $mode })
value-reduced = Reduced
value-full = Full
value-registered = Registered
value-not-registered = Not registered
value-recording = Recording
downloads-steam = Steam transfers
downloads-none = No download or update in progress
downloads-packages = Emulators installed by bep
downloads-progress = { $done } of { $total } GB
settings-console = Console
settings-haptics = Controller haptics
settings-motion = Reduced motion
settings-performance = Performance overlay
settings-reload = Reload library
settings-session = Start at sign-in
settings-desktop = Return to the desktop
settings-system = System
quick-title = Quick menu
quick-nvidia = NVIDIA
quick-display = Display and capture
quick-session = Session
power-title = Power
activity-title = Activity
activity-resume = Resume
activity-running = Running
activity-downloads = Downloads
activity-transfers = { $count ->
    [one] { $count } Steam transfer
   *[other] { $count } Steam transfers
}
activity-packages = { $count ->
    [one] { $count } emulator installed
   *[other] { $count } emulators installed
}
activity-last = Last played
toast-resumed = Resumed { $title }
toast-resumed-disk = Resumed { $title } where you left off
toast-playing = Playing { $title }
toast-starting = Starting { $title }
toast-starting-steam = Starting { $title } in Steam
toast-steam-page = Opened { $title } in Steam
toast-not-launched = Did not start { $title }: { $reason }
toast-suspended = Suspended. Resume picks up instantly
toast-paused = Paused. This system cannot save its state
toast-closed = Closed { $title }
toast-screenshot = Screenshot saved: { $path }
toast-recording = Recording with { $encoder }
toast-recorded = Recorded { $path } with { $encoder }
toast-record-failed = Recording stopped: { $error }
toast-record-unavailable = Record captures Bun Engine games. Use Steam or Windows capture for others
toast-close-steam = Close Steam games from the game
toast-asked-close = Asked { $title } to close
toast-back-from = Back from { $title }
toast-not-started = { $title } did not start
toast-reloaded = Library reloaded: { $count ->
    [one] { $count } game
   *[other] { $count } games
}
toast-session = To start at sign-in, run: { $command }
toast-start-failed = Could not start the game: { $error }
toast-stopped = { $name } stopped
toast-cannot-save = Closed: this system cannot save its state
toast-controller = { $name } connected
busy-steam = Steam app { $app } is running
busy-stream = { $name } is streaming
