# Recon map: console system UI (SteamOS gaming mode, PS5, Xbox Series X|S, Switch HOME Menu)

Scope: the core loop of a full-screen console session: boot to home, browse and pick a game,
launch or resume, the in-game quick menu (Guide/PS button: performance, settings, power),
downloads and installs, the game hub, Remote Play/streaming to another device, controller-first
navigation and notifications. SteamOS gaming mode (Steam Deck, Big Picture) is the primary
reference, the PS5 system UI is the quality bar, and Xbox Home/Guide and the Switch HOME Menu
are secondary references for specific patterns.
For: Bun OS, our own product. One player on a TV or desk, controller in hand. Targets: the Bun OS
console shell (`crates/bun-os-shell`, Bevy) and play.aphrody.app (`apps/play`). Product line:
"SteamOS, but Windows + NVIDIA + Bun/Rust, with a PS5-grade full-screen session".
Date: 2026-10-17

Clean-room rules: public pages only, read one at a time; no login, no app bundles, no
decompiling, no private APIs. Reference images are linked, not downloaded
(`replica/screens/README.md`). Valve, Sony, Microsoft and Nintendo help pages that render only
client-side (help.steampowered.com, steamcommunity.com announcements, support.xbox.com) gave
titles or search snippets only; rows below say so. Sites behind a bot challenge were skipped.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | marketing site (SteamOS) | https://www.steamdeck.com/en/software | Gaming mode features: library with collections, store, notifications without leaving the game, chat, Remote Play, cloud saves, settings and updates. Read. |
| 2 | changelog (Big Picture) | https://www.gamingonlinux.com/2022/10/steam-deck-ui-comes-to-desktop-in-beta-to-replace-big-picture-mode | Valve's feature list for the Deck UI on desktop: home (continue recent, what's new), universal search, controller configurator, controller store, in-game overlay and system menu on Guide, quick access menu on Guide+A. Read. |
| 3 | public API docs (Steamworks) | https://partner.steamgames.com/doc/steamdeck/recommendations | On-screen keyboard APIs (`ShowFloatingGamepadTextInput`, `ShowGamepadTextInput`), launcher rules (`SetGameLauncherMode`), per-device settings vs cloud saves, offline single player. Read. |
| 4 | public API docs (Steamworks) | https://partner.steamgames.com/doc/steamdeck/compat | Compatibility ratings Verified/Playable/Unsupported/Unknown, criteria (input, glyphs, text entry, display, seamlessness), badge in library, library filter/sort by rating. Read. |
| 5 | public API docs (Steamworks) | https://partner.steamgames.com/doc/store/assets/libraryassets | Library art model: capsule 600x900, header 920x430, hero 3840x1240 (no text, central safe area), logo over hero with 4 positions, parallax, fallback to screenshot + name. Read. |
| 6 | public API docs (Steamworks) | https://partner.steamgames.com/doc/features/overlay | Overlay contents, toasts bottom-right by default, `GameOverlayActivated_t` so games pause, `ActivateGameOverlay*`. Read. |
| 7 | public API docs (Steamworks) | https://partner.steamgames.com/doc/features/steam_controller | Steam Input handbook index (action sets, layers, templates, Workshop configs). Index only. |
| 8 | marketing site (Remote Play) | https://store.steampowered.com/remoteplay | Remote Play to phones/TVs/PCs via Steam Link, Remote Play Together, start from the library. Read. |
| 9 | changelog (SteamOS 3.2) | https://steamcommunity.com/ogg/1675200/announcements/detail/3297210455204349336 | "The SteamOS 3.2 Update" (refresh-rate and fan controls in the QAM, per the manifest capture). Client-rendered: title only. |
| 10 | changelog (lock screen) | https://steamcommunity.com/ogg/1675200/announcements/detail/3216142491800836086 | "The Lock Screen Update" (PIN lock on boot/wake). Client-rendered: title only. |
| 11 | help center (Steam Deck) | https://help.steampowered.com/en/faqs/view/69E3-14AF-9764-4C28 | "Steam Deck - Basic Use & Troubleshooting Guide". Client-rendered: title only. |
| 12 | third-party guide | https://tomsguide.com/how-to/how-to-enable-the-performance-overlay-on-the-steam-deck | QAM performance tab: four overlay levels, frame limit, refresh rate, TDP, GPU clock, per-game profile. Search snippet. |
| 13 | help center (PS5) | https://www.playstation.com/en-us/support/games/customize-ps5-control-center/ | Control Center: cards (activity, voice chat/broadcast, media) and controls (Home, Switcher, Notifications, Game Base, Music, Sound, Mic, Accessories, Profile, Power), reorder/hide with Options. Read. |
| 14 | marketing site (PS5) | https://www.playstation.com/en-us/ps5/ps5-features/ | Welcome hub widgets, game hub, Control Center, activities, game help, Game Base, Remote Play targets, Share Screen. Read. |
| 15 | changelog (PS5) | https://www.playstation.com/en-us/support/hardware/ps5/system-software-info/ | 2024-2026 updates: Welcome hub on home (24.06), haptic feedback while navigating (24.01), Remote Play user limits (24.06), power saver mode (25.06), classic home designs (25.03), full activity details on cards (25.02), Showcase/Slideshow (26.02). Read. |
| 16 | help center (PS5) | https://www.playstation.com/en-us/support/games/create-gamelist/ | Gamelists in Game Library > Your Collection, add via Options. Read. |
| 17 | help center (PS5) | https://www.playstation.com/en-us/support/games/hide-games-playstation-library/ | Game Library Filter and Sort, Hidden Items toggle. Search snippet. |
| 18 | help center (PS5) | https://www.playstation.com/en-us/support/games/remote-play-settings/ | Enable Remote Play per user, wake from rest over network, Pair Device code. Search snippet. |
| 19 | help center (PS5) | https://www.playstation.com/en-us/support/games/playstation-remote-play-on-pc-and-mac/ | Client app finds the console automatically, 5/15 Mbps guidance, manual pairing by number. Search snippet. |
| 20 | help center (PS5) | https://www.playstation.com/en-us/support/games/troubleshoot-downloaded-playstation-game/ | Control Center > Downloads/Uploads: Pause/Resume, Cancel and Delete, View Error Info, Try Again. Search snippet. |
| 21 | help center (PS5) | https://www.playstation.com/en-us/support/account/manage-notifications-ps5/ | Notifications list with Downloads and Copies / Uploads sections. Search snippet. |
| 22 | manual (PS5) | https://www.playstation.com/content/dam/global_pdc/en/corporate/support/manuals/ps5-docs/1200a/EN_FR_ES_AMER_CFI-1215A_Quick_Start_Guide_Web.pdf | Games home vs media home, Hub of the selected game, return home from the Control Center. Search snippet. |
| 23 | official blog (PS5) | https://blog.playstation.com/2020/10/15/first-look-playstation-5s-next-generation-user-experience/ | Control Center in one press, activity cards, picture-in-picture cards, fast switching. Read. |
| 24 | official blog (PS5) | https://blog.playstation.com/2021/09/14/ps5s-september-system-software-update-launches-globally-tomorrow/ | Control Center / Game Base 2021 update (manifest capture). Link from manifest. |
| 25 | official blog (PS5) | https://blog.playstation.com/2021/04/13/ps5-april-update-brings-new-storage-options-and-social-features/ | Extended storage: PS5 titles cannot run from USB; Installed tab. Search snippet. |
| 26 | official blog (PS5) | https://blog.playstation.com/2024/09/12/ps5-system-update-adds-welcome-hub-party-share-personalized-3d-audio-profiles-adaptive-controller-charging-and-more/ | Welcome hub (manifest capture). Link from manifest. |
| 27 | official blog (PS5) | https://blog.playstation.com/2025/04/23/new-ps5-system-software-update-features-audio-focus-and-the-return-of-the-classic-console-ui-customizations/ | Classic console home themes (manifest capture). Link from manifest. |
| 28 | help center (Xbox) | https://support.xbox.com/en-US/help/hardware-network/getting-started-set-up/using-the-guide | Guide on the Xbox button from anywhere; tabs cycled with bumpers, tab order customisable; profile, captures, achievements, parties, messages. Client-rendered: search snippet. |
| 29 | help center (Xbox) | https://support.xbox.com/en-AU/help/account-profile/customize-xbox-home/customize-your-home | Add to Home pins (up to 10 games and 10 groups), colour/theme/background. Client-rendered: search snippet. |
| 30 | help center (Xbox) | https://support.xbox.com/en-US/help/family-online-safety/passkey-guest-key/create-and-manage-xbox-one-passkey | Profile PIN. Title only. |
| 31 | changelog (Xbox) | https://news.xbox.com/en-us/2021/05/11/may-2021-xbox-update/ | Quick Resume group on Home and a Quick Resume tag on games. Search snippet. |
| 32 | changelog (Xbox) | https://news.xbox.com/en-us/2022/03/09/march-2022-xbox-update/amp/ | Pin up to two games in Quick Resume; pinned games drop only on manual removal or mandatory update. Search snippet. |
| 33 | official blog (Xbox) | https://news.xbox.com/en-us/2023/07/26/welcome-to-your-new-xbox-home/ | New Home (manifest captures). Behind Cloudflare bot management: skipped, link only. |
| 34 | help center (Switch) | https://en-americas-support.nintendo.com/app/answers/detail/a_id/22308 | HOME Menu: My Page top left, bottom row of system icons (Online, News, eShop, Album, Controllers, System Settings, Sleep Mode). Read. |
| 35 | help center (Switch 2) | https://en-americas-support.nintendo.com/app/answers/detail/a_id/68181 | Switch 2 HOME Menu adds GameChat, GameShare, Virtual Game Card. Read. |
| 36 | help center (Switch) | https://en-americas-support.nintendo.com/app/answers/detail/a_id/22321 | Quick Settings: hold HOME 1 s, right-side panel (sleep, brightness, flight mode, volume); close with B, HOME or tap outside. Search snippet. |
| 37 | walkthrough video | https://www.youtube.com/watch?v=TxI0z1yU64M | "Steam Deck UI Tour with Mas". Title only. |
| 38 | walkthrough video | https://www.youtube.com/watch?v=wCMMPxP-MUk | "The new Steam Deck UI!". Title and chapter list only. |
| 39 | walkthrough video | https://www.youtube.com/watch?v=8hxiKXb4X7M | "Steam Deck Unboxing, Setup, Startup, Dashboard and Gameplay". Title only. |
| 40 | reference index | `assets/reference/console-ui/manifest.json` | Already-surveyed official captures (PS5, Xbox, SteamOS, Switch, Wii U, 3DS, Wii, DS), linked in `replica/screens/README.md`. |

## Core loop

Turn the console on, see the last game you played full-bleed, press A, be playing; press the
Guide button at any time for performance, settings and power without leaving the game.

## Screens

Reference columns describe the original (SteamOS first, PS5/Xbox/Switch where they differ).
"Bun OS today" is our current state (shell = `crates/bun-os-shell`, play = `apps/play`).

| ID | screen | route / how to reach | purpose | key components | states seen | Bun OS today |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | Boot / startup | Power on or wake; SteamOS startup movie; PS5 "press the PS button" | Branded transition into the session, no desktop | full-screen video/logo, spinner | first boot, normal boot, update pending | partial: `--session` borderless window; Windows Run-key autostart, Explorer still runs |
| S02 | Lock / user select | After boot or wake when a PIN or several users exist (SteamOS lock screen, PS5 user select, Xbox profile PIN) | Pick the player, unlock | avatar list, PIN pad (controller digits), clock | single user (skipped), multi-user, wrong PIN, locked out | no |
| S03 | Home | Default after boot; Steam/PS/Xbox/HOME button > Home | Resume the last game, see recent and new | hero art full-bleed, horizontal rail of recent tiles, Play/Resume button, "what's new" row, status bar (time, battery, Wi-Fi, controller) | empty library, filled, game running (tile shows Resume), offline | yes (shell `spawn_home`: hero cross-fade, rail, Play/Hub, activity row) |
| S04 | Game hub / details | A on a tile; PS5 game hub under the tile | Everything about one game and its main action | hero + logo overlay (parallax), Play / Resume / Install / Update / Stream button, play time and last played, activity/news, achievements, compatibility badge, gear menu (properties, controller layout, manage) | installed, not installed, update required, downloading, running, streaming available from another host, unsupported | partial (shell `spawn_hub`: platform, size, developer, year, play count, last played, route, profile; no news, achievements or description) |
| S05 | Library | Steam button > Library; PS5 Game Library; Switch All Software | Find any game | tab bar on bumpers (Great on Deck, All, Installed, Non-Steam, Collections), Filter and Sort sheet, tile grid, letter jump | empty tab, filtered to none, loading art, hidden items | partial (shell `spawn_library`: All/Steam/Emulators/Web chips; play has search; no sort or collections) |
| S06 | Collections / gamelists | Library > Collections tab; PS5 Your Collection > gamelists; Xbox groups | Group games by hand or by rule | collection cards, dynamic-collection rule editor, add-to-collection sheet | none yet, static, dynamic | no |
| S07 | Main menu | Steam button outside a game (SteamOS side menu); Xbox Guide tabs; Switch bottom icon row | Jump between top-level areas | vertical nav list (Home, Library, Store, Media, Downloads, Friends, Settings, Power), user avatar, glyph hints | closed, open, game running (adds Resume/Exit) | partial (shell top-level screens Home/Library/Hub/Downloads/Settings; no side menu) |
| S08 | Quick Access Menu / Control Center | QAM (`...`) button or Guide+A (SteamOS); PS button (PS5 Control Center); hold HOME (Switch Quick Settings) | Change the session without leaving the game | side drawer with icon tabs (Notifications, Friends, Quick settings, Performance, Music, Help), PS5 card row + control strip, sliders, toggles | in game, on home, with notification badge, customised order (PS5) | yes (shell `spawn_quick`: Resume, Home, Screenshot, Record, HUD, Frame limit, Scaling, Volume, Close game, NVIDIA, Power) |
| S09 | In-game overlay / game menu | Steam button while a game runs; PS5 Control Center cards; Xbox Guide | Pause-side actions for the running game | Resume, Exit game, achievements, guides, notes, screenshots, controller settings; game receives "overlay activated" and pauses | single-player paused, online (no pause), game not responding | partial (shell quick menu pauses emulators via `pause_for_overlay`; external games not paused) |
| S10 | Performance HUD | QAM > Performance > overlay level 1-4 | Live FPS, frametime, CPU/GPU load, temps, power | corner overlay, frametime graph | off, level 1 (FPS), 2, 3, 4 (full) | yes (shell `Bind::Hud`: UI fps/p99, emulator fps, GPU temp/MHz/load/W from NVAPI/NVML; no CPU) |
| S11 | Power menu | Hold power or Steam button > Power; PS5 Control Center > Power | Sleep, restart, shut down, leave the session | modal list (Suspend, Restart, Shut down, Switch to Desktop, Lock), confirm | game running (warn), update pending | yes (shell `spawn_power`: Sleep, Restart, Shutdown, Desktop) |
| S12 | Downloads | Steam button > Downloads; PS5 Control Center > Downloads/Uploads | Watch and order installs and updates | current download with rate graph, up-next queue (reorder), scheduled, completed, pause/resume all, error info + retry | idle, downloading, paused, error, disk full, scheduled | partial (shell `spawn_downloads`: Steam transfers with progress, bep packages; play shows rate/state; no pause or order) |
| S13 | Storage manager | Settings > Storage | See drives, move or uninstall games | drive bars (used/free), per-drive game list with sizes, Move/Uninstall, set default drive | one drive, many drives, drive missing, moving | partial (bun-steam `listLibraries`, `candidateDisks`, `moveLibrary`; play libraries table; nothing in the shell) |
| S14 | Store | Steam button > Store; PS Store; eShop | Buy and browse new games | controller-optimised web store | n/a | skip (see Out of scope) |
| S15 | Search | Steam button > search or keyboard key; Xbox/PS search | Find a game, store page or friend fast | search field, on-screen keyboard, grouped results (Library, Store, Friends) | empty query, no results, results | partial (play library search box; bun-steam `searchApps`; none in the shell) |
| S16 | Friends and chat | Steam button > Friends; PS5 Game Base; Switch My Page | Social presence and messages | friend list by state, chat, join game | n/a | skip (network) |
| S17 | Notifications | QAM > Notifications; PS5 Control Center > Notifications | Review what happened | toast (bottom-right on Steam), list with timestamps, unread badge, action buttons | none, unread, read, actionable (download done, update ready) | partial (shell `Shell::toast`, `ToastBox`; no list or history) |
| S18 | Settings | Steam button > Settings; PS5 Settings; Switch System Settings | Configure the system | category list (System, Display, Audio, Bluetooth, Controller, Keyboard, Customisation, Downloads, Cloud, Family, Remote Play, Storage, Accessibility, Power), detail panes | default, changed, needs restart | partial (shell `spawn_settings`: sounds, haptics, reduced motion, HUD, rescan, start at sign-in, desktop; read-only display/NVIDIA/session panels) |
| S19 | Controller configurator | Game hub > controller icon; Settings > Controller | Remap inputs per game | layout picker (templates, community), button map, action sets, glyph test | default, custom, community layout, controller missing | partial (engine-core `steam/input.rs` action sets; no per-game remap UI) |
| S20 | On-screen keyboard | Steam+X, or automatic on text fields (`ShowFloatingGamepadTextInput`) | Type with a controller | key grid, trackpad/stick typing, suggestions | floating (in game), full (search), password | no |
| S21 | Remote Play / stream | Game hub > Stream (game installed on another host); PS Remote Play app > pick console; Steam Link | Play a game running on another machine | host picker, pairing code dialog, connection quality, stream HUD | host asleep (wake), pairing, connected, poor network, ended | partial (play `/stream` WebRTC client + relay; engine-core Moonlight client with PIN pairing; bun-steam `remotePlayState`; no host session in the shell) |
| S22 | Media / captures | Steam button > Media; PS5 Media Gallery; Switch Album | See and share screenshots and clips | grid by game, viewer, delete | empty, filled | partial (shell Screenshot/Record via Media Foundation encoders; no gallery) |
| S23 | Game properties | Game hub > gear > Properties | Per-game technical settings | launch options, compatibility tool (Proton), per-game performance profile, shader cache, cloud saves toggle | default, custom | partial (shell `profiles.rs`: fps limit, scaler, borderless, instant resume, HUD; bun-steam `setCompatTool`, `setLaunchOptions` not surfaced in the shell) |
| S24 | Switcher / Quick Resume | PS5 Control Center > Switcher; Xbox Quick Resume group on Home | Jump between suspended games | list of running/suspended games with state tags, pin, close | one game, several, game evicted | partial (shell save-state suspend for in-process emulators, `system::focus` for external games; one game at a time) |
| S25 | Achievements / trophies | Overlay or game hub > Achievements; PS5 activity cards | Progress in the game | list, progress bars, unlock toast | none, partial, complete | no (engine-core `steam/stats.rs` read-only stub) |
| S26 | Welcome hub | PS5 home (24.06+) | Personal dashboard of widgets | widgets, layout presets, background from captures | default, customised | no (could) |
| S27 | First-run setup | First boot | Language, network, account, controller pairing, display check | stepper, controller pairing prompt | each step, skip, error | no |
| S28 | System update | Settings > System; notification | Update the OS and shell | version, channel, check/apply, restart prompt | up to date, available, downloading, failed | no |

## Flows

Clicks count confirming presses on the happy path (directional moves not counted unless noted).

```
F01 Boot to home
    power on -> S01 boot -> (S02 lock if PIN) -> S03 home
    happy path clicks: 0 (auto sign-in), 1 + PIN (lock); PS5: 2 (PS button, pick user)
    edge: several users, PIN wrong, update pending at boot, display mode change, controller not paired

F02 Resume the last game (the number to beat)
    S03 home (last game focused) -> A on Play/Resume
    happy path clicks: SteamOS 2 (A on tile opens S04, A on Play), PS5 1-2, Bun OS target 1
    edge: game needs update first, game running on another host (offer Stream), save state stale, cloud conflict

F03 Browse the library and launch
    S03 -> Steam button (S07) -> Library (S05) -> bumpers to a tab -> tile -> S04 -> Play
    happy path clicks: 5 (+ tab bumpers); with search (F11) 4 + typing
    edge: empty tab, art missing (typographic tile), not installed (F04), unsupported on this machine

F04 Install a game that is not installed
    S05 Installed filter off -> tile -> S04 Install -> pick drive -> confirm -> S12 shows progress -> toast "ready" -> Play
    happy path clicks: 4
    edge: disk full (offer S13), download error (retry), queue busy (move to top), offline

F05 In-game quick menu: change performance
    in game -> QAM / PS button (S08) -> Performance tab -> frame limit slider -> back to game
    happy path clicks: 3 (open, tab, change) + 1 close; Switch Quick Settings 1 hold + change
    edge: setting needs per-game profile on, game in exclusive fullscreen, HUD covering game UI

F06 Leave or switch game
    in game -> Steam/PS button (S09/S24) -> Exit game -> confirm -> S03
    happy path clicks: 3; PS5 Switcher: 2 (PS button, pick other game)
    edge: game not responding (force close), unsaved progress warning, Quick Resume eviction

F07 Sleep and wake into the game
    power button short press (or S08/S11 > Sleep) -> sleep; any button -> (S02) -> game resumes
    happy path clicks: 1 to sleep, 1 to wake; via menu 3
    edge: game loses network session, controller wake not supported, PIN on wake

F08 Manage downloads
    Steam button (S07) -> Downloads (S12) -> pick item -> move to top / pause
    happy path clicks: 4; PS5: PS button -> Downloads/Uploads -> item -> Pause/Resume = 4
    edge: error with View Error Info + Try Again, scheduled window, bandwidth limit

F09 Stream a game to another device
    client device: S03/S05 -> game installed on host -> S04 Stream -> (pair once: code on host) -> S21 playing
    happy path clicks: 2 after pairing; first time +3 (pair, enter code, confirm)
    edge: host asleep (wake on LAN), host busy with another game, poor network (bitrate drops), different resolution

F10 Act on a notification during play
    toast appears in game -> QAM (S08) Notifications tab (S17) -> select -> action (for example Play now)
    happy path clicks: 2-3
    edge: do-not-disturb in game, many toasts stacking, toast covering HUD

F11 Search and open a game
    Steam button -> search (S15) -> S20 keyboard -> result -> S04
    happy path clicks: 3 + typing
    edge: no results, result is a store item (skip), keyboard over results

F12 Change the per-game compatibility tool or profile
    S04 -> gear -> Properties (S23) -> Compatibility -> pick tool -> back -> Play
    happy path clicks: 5
    edge: tool not installed (install first), game already running (apply on next launch)

F13 Take a screenshot and look at it
    in game -> Steam+R1 / Share / Capture -> toast -> S22 Media
    happy path clicks: 1 (chord) to take, 3 to view
    edge: HDR capture tone mapping, protected content black frame, disk full

F14 First-run setup
    S01 -> S27 language -> network -> account -> controller -> S03
    happy path clicks: 6-8
    edge: no network (offline mode), no controller (keyboard), TV overscan

F15 Remap the controller for one game
    S04 -> controller icon (S19) -> pick template or edit -> save -> Play
    happy path clicks: 4
    edge: controller not detected, game reads raw XInput, glyph mismatch
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Game tile (capsule) | portrait capsule, landscape header, typographic fallback, small (list) | default, focused (scale + ring), running badge, not installed (dimmed), downloading (progress), update badge | S03, S05, S06, S24 |
| Hero banner | home hero, hub hero with logo overlay (4 logo positions), screenshot fallback | cross-fade on focus change, parallax on scroll | S03, S04 |
| Rail | horizontal tile row, row with header | scrolled, wrapped at ends, empty | S03, S06, S26 |
| Primary action button | Play, Resume, Install, Update, Stream, Cancel | default, focused, pressed, disabled, busy (progress) | S04, S03 |
| Tab bar (bumper tabs) | icon tabs (QAM), text tabs (library) | active, inactive, with badge | S05, S08, S18 |
| Side drawer | left main menu, right quick menu | closed, sliding, open over scrim | S07, S08 |
| Control strip / card (PS5) | control icon, activity card, media card, voice card | focused, customise mode, hidden | S08, S09 |
| Slider | stepped (frame limit, refresh), continuous (volume, brightness, TDP) | default, focused, disabled (profile off) | S08, S18, S23 |
| Toggle | on/off with description | on, off, disabled, needs restart | S08, S18, S23 |
| Select / dropdown | inline cycle, full-screen list | closed, open, value | S18, S23 |
| List row | settings row, download row, notification row, drive row | focused, with trailing value, with action | S12, S13, S17, S18 |
| Progress bar | determinate, indeterminate, with rate | running, paused, error | S12, S04, S03 |
| Toast | info, success, error, actionable | entering, visible, leaving, stacked | global |
| Modal dialog | confirm, destructive confirm, pairing code, error with retry | open, focused button | S11, S12, S21 |
| Glyph hint bar | A select, B back, X/Y contextual, bumpers | per controller family (Xbox, PlayStation, Switch, keyboard) | global footer |
| Status bar | clock, battery, Wi-Fi, controller battery, download indicator | normal, low battery, offline | S03, S07 |
| Performance HUD | levels 1-4 | off, compact, full | S10 |
| On-screen keyboard | floating, full, numeric/PIN | open, typing, suggestion focused | S02, S15, S20 |
| Badge | compatibility rating, installed, update, running, cloud | n/a | S04, S05 |
| Focus ring | tile ring, row highlight | moving (spring), pressed | global |
| Empty state | library empty, no downloads, no results, no captures | with action | S05, S12, S15, S22 |
| Filter and sort sheet | filters (installed, platform, compatibility, hidden), sort (alpha, recent, size, play time) | open, applied (chip shown) | S05 |

## Inferred data model

```
Game      id, kind (steam | emulated | native | web | streamed), source_id (Steam appid, ROM md5),
          title, art {capsule, header, hero, logo, logo_position, icon}, installed (bool),
          install_dir, size_on_disk, last_played_at, playtime_minutes, play_count,
          compat_rating (verified | playable | unsupported | unknown), hidden (bool)
          evidence: S03/S04/S05, Steamworks library assets (#5), compatibility (#4), PS5 hide games (#17)
          confidence: high

Collection id, name, kind (static | dynamic), rules (json: filters for dynamic), game_ids[]
          evidence: S06, steamdeck.com "collections" (#1), PS5 gamelists (#16), Xbox groups (#29)
          confidence: high (fields), guess (rule format)

LibraryFolder id, path, drive_label, total_bytes, free_bytes, is_default, game_ids[]
          evidence: S13, bun-steam listLibraries/candidateDisks, PS5 extended storage (#25)
          confidence: high

Download  id, game_id, kind (install | update | dlc | system), state (queued | active | paused |
          scheduled | completed | error), bytes_done, bytes_total, rate_bps, queue_position,
          error_code, scheduled_window
          evidence: S12, PS5 Downloads/Uploads Pause/Resume/Try Again (#20), Steam downloads (#1)
          confidence: high (state, progress), medium (schedule)

Session   id, game_id, pid or machine handle, started_at, state (running | suspended | paused |
          streaming_out), suspend_kind (save_state | process_suspend | none), pinned (bool)
          evidence: S09, S24, Xbox Quick Resume (#31, #32), PS5 Switcher (#13)
          confidence: medium

PerfProfile scope (global | game_id), fps_limit, refresh_hz, power_limit_w (TDP on Deck,
          NVIDIA power limit for us), gpu_clock, scaler (fsr | nis | integer | linear),
          hud_level (0-4), vrr (bool)
          evidence: S08/S10/S23, QAM performance tab (#12), SteamOS 3.2 (#9), PS5 power saver (#15)
          confidence: high (fields), guess (power_limit on NVIDIA)

LaunchConfig game_id, compat_tool, launch_options, controller_layout_id, cloud_sync (bool)
          evidence: S23, bun-steam setCompatTool/setLaunchOptions, Steamworks recommendations (#3)
          confidence: high

Notification id, kind (download_done | update_ready | friend | achievement | system),
          title, body, created_at, read (bool), action {label, target}
          evidence: S17, PS5 notifications (#21), Steam overlay toasts (#6)
          confidence: medium

User      id, name, avatar, pin_hash, auto_sign_in (bool), remote_play_allowed (bool)
          evidence: S02, lock screen update (#10), PS5 Remote Play per user (#15, #18), Xbox PIN (#30)
          confidence: medium

StreamHost id, name, address, mac (wake on LAN), paired (bool), paired_at, status
          (online | asleep | busy), installed_game_ids[]
          evidence: S21, PS5 pair device (#18, #19), Steam Remote Play (#8)
          confidence: medium

StreamSession id, host_id, game_id, codec, resolution, fps, bitrate_kbps, rtt_ms, started_at
          evidence: S21, engine-core STREAM.md, play /stream
          confidence: medium

Controller id, family (xbox | playstation | switch | steam | generic), battery, connected,
          layout per game (via LaunchConfig)
          evidence: S19, PS5 Accessories control (#13), Switch Controllers (#34)
          confidence: medium

Achievement game_id, api_name, title, unlocked_at, progress
          evidence: S25, overlay (#2)
          confidence: high (Steam schema), skip for non-Steam

Capture   id, game_id, kind (screenshot | clip), path, taken_at, duration_ms
          evidence: S22, Switch Album (#34), PS5 Share (#14)
          confidence: high

Setting   key, value, scope (system | user | game)
          evidence: S18
          confidence: guess (storage shape)
```

Relationships: User 1-n Session; Game 1-n Session; Game n-n Collection; LibraryFolder 1-n Game;
Game 1-n Download; Game 0-1 PerfProfile (plus one global); Game 1-1 LaunchConfig; StreamHost 1-n
StreamSession; Game 1-n Achievement; Game 1-n Capture; User 1-n Notification.

## Feature matrix

See `features.csv`. Must: 30, should: 26, could: 12, skip: 9 (77 rows).
Current state (`clone` column): yes 14, partial 27, no 27, skip 9.

## Out of scope (cannot or should not be cloned)

- Steam Store, PlayStation Store, Microsoft Store and eShop catalogues and purchasing: licensed
  content and partner deals. Bun OS deep-links to Steam (`steam://`) instead.
- Friends, chat, parties, Game Base, Share Screen, GameChat: the networks and their users.
- Subscription catalogues and cloud gaming (PS Plus, Game Pass, xCloud, GeForce NOW).
- Community content: Game Help videos, guides, Workshop layouts, news feeds owned by the platforms.
- Platform achievements/trophies servers beyond what the Steam Web API exposes for the user.
- Console hardware features: DualSense adaptive triggers, Deck APU TDP control, rest-mode
  controller charging, HDMI-CEC on proprietary boards.
- Brand assets and trade dress: startup movies, PS/Xbox/Steam/HOME button names and glyph art,
  system sounds, theme art. Bun OS uses its own type, M3 dynamic colour and neutral glyphs.
- The reference captures themselves (linked only, never shipped).

## Size

Screens 28 (2 skip), flows 15, entities 14.

Hard parts:
1. Overlay and quick menu over arbitrary Windows games (exclusive fullscreen DX11/12/Vulkan):
   needs a topmost layered window or present-hook injection, input routing and "pause" without the
   Steam overlay callback.
2. Suspend/resume of native PC games: no Quick Resume on Windows; only in-process emulators have
   save states. Process suspend (NtSuspendProcess) breaks network sessions and anti-cheat.
3. Controller everywhere: per-game remap, on-screen keyboard injected into any game, glyphs per
   controller family; Steam Input owns this for Steam games.
4. Host-side streaming session: capture + NVENC + WebRTC/Moonlight per game, pairing, wake on LAN.
5. A real session: boot straight to the shell without Explorer (Windows shell replacement or
   Assigned Access), sleep/wake into the game, lock PIN.

Size: L (a quarter) for the whole slice; the shell already covers home, hub, quick menu, HUD,
power and emulator resume, so the remaining gap is roughly M for the must rows.
