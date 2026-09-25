# Family Flix for Windows

Family Flix is a family-specific Windows build based on Jellyfin Desktop. It
packages a dedicated Jellyfin Web 10.11.5 client from the
`familyflix-desktop-web` branch and connects to
`https://myfamilyflix.duckdns.org/`. It does not load the server's customized
web interface. Jellyfin Desktop supplies the native libmpv video player. The
upstream projects and their GPL licenses remain credited below.

The dedicated desktop client loads the existing Family Flix Watchlist plugin's
JavaScript and CSS from the server, so personal and household Watchlists use
the same server data as Android. This integration still requires runtime QA.
The home screen now places Continue Watching, Deck, and recent library rows in
the Family Flix sequence; recent library rows and the navigation menu use the
Android profile's saved library order and visibility. Recent movie/show cards
prefer wide backdrops. The header shows a date and clock, and Live TV's menu
entry opens the guide. These changes still require runtime QA and do not yet
complete Android TV feature parity.

This is the **only active Family Flix for Windows project**. The older
`../familyflix-windows` WebView2 launcher is retired and must not be shipped.

This checkout is an early Windows port, not a finished Android TV-equivalent
release. The release gate is feature parity with the Family Flix Android TV app:
the same home and detail layouts, library ordering, Deck, Continue Watching,
watchlist, mixed playlists, profiles and Watching Together, Kids Mode, Live TV
guide, playback controls and skip prompts, themes, settings, buffers, update
prompts, and remote/keyboard navigation. It must also preserve user settings
between updates. A successful compile or a website wrapper is not sufficient.

The Qt/libmpv desktop base supplies native Windows playback. Windows loads
`webview.qml` with the separately packaged desktop client. The previous
`nativeview.qml` experiment remains in the tree temporarily but is not the
Windows entry point. Port Android TV features onto the dedicated desktop client
without copying the server browser's customizations wholesale. Do not publish
this port as complete until its screens and behavior are implemented and tested.

# Jellyfin Desktop

Jellyfin desktop client built with Qt WebEngine and [libmpv](https://github.com/mpv-player/mpv). Supports audio passthrough, hardware decoding, and playback of more formats without transcoding.

![Screenshot of Jellyfin Desktop](screenshots/video_player.png)

## Downloads
- [Flathub (Linux)](https://flathub.org/apps/details/org.jellyfin.JellyfinDesktop)

### Development Builds
Built from the latest commit on `master`.

#### macOS
- [Apple Silicon](https://nightly.link/jellyfin/jellyfin-desktop/workflows/build-macos/master/macos-arm64.zip)
- [Intel](https://nightly.link/jellyfin/jellyfin-desktop/workflows/build-macos/master/macos-x86_64.zip)

#### Windows
- [x64 Installer](https://nightly.link/jellyfin/jellyfin-desktop/workflows/build-windows/master/windows-x64-installer.zip)
- [x64 Portable](https://nightly.link/jellyfin/jellyfin-desktop/workflows/build-windows/master/windows-x64-portable.zip)

#### Linux
- [AppImage (x86_64)](https://nightly.link/jellyfin/jellyfin-desktop/workflows/build-appimage/master/linux-appimage-x86_64.zip)

## Building
See [dev/](dev/) for platform-specific build instructions.

## File Locations
Data is stored per-profile in a `profiles/<profile-id>/` subdirectory. The main configuration file is `jellyfin-desktop.conf`. You can also add `mpv.conf` to configure MPV directly.

**Windows:**
- Config: `%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\`
- Cache: `%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\`
- Logs: `%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\logs\`

**Linux:**
- Config: `~/.local/share/jellyfin-desktop/profiles/<profile-id>/`
- Cache: `~/.cache/jellyfin-desktop/profiles/<profile-id>/`
- Logs: `~/.local/share/jellyfin-desktop/profiles/<profile-id>/logs/`

**Linux (Flatpak):**
- Config: `~/.var/app/org.jellyfin.JellyfinDesktop/data/jellyfin-desktop/profiles/<profile-id>/`
- Cache: `~/.var/app/org.jellyfin.JellyfinDesktop/cache/jellyfin-desktop/profiles/<profile-id>/`
- Logs: `~/.var/app/org.jellyfin.JellyfinDesktop/data/jellyfin-desktop/profiles/<profile-id>/logs/`

**macOS:**
- Config: `~/Library/Application Support/Jellyfin Desktop/profiles/<profile-id>/`
- Cache: `~/Library/Caches/Jellyfin Desktop/profiles/<profile-id>/`
- Logs: `~/Library/Logs/Jellyfin Desktop/<profile-id>/`
