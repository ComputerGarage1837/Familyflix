# Family Flix for Windows

Family Flix is a family-specific Windows build based on Jellyfin Desktop. It opens
`https://myfamilyflix.duckdns.org/web/` directly and uses the Family Flix branding.
The native player comes from Jellyfin Desktop and uses libmpv. The upstream project
and its GPL-2.0 license remain credited below.

This is the **only active Family Flix for Windows project**. The older
`../familyflix-windows` WebView2 launcher is retired and must not be shipped.

This checkout is an early Windows port, not a finished Android TV-equivalent
release. The release gate is feature parity with the Family Flix Android TV app:
the same home and detail layouts, library ordering, Deck, Continue Watching,
watchlist, mixed playlists, profiles and Watching Together, Kids Mode, Live TV
guide, playback controls and skip prompts, themes, settings, buffers, update
prompts, and remote/keyboard navigation. It must also preserve user settings
between updates. A successful compile or a website wrapper is not sufficient.

The Qt/libmpv desktop base supplies native Windows playback. The current
Qt WebEngine screen is a temporary scaffold, not the planned Windows UI.
Windows screens and their behavior must be implemented in native Qt Quick/QML,
following the Android TV app's rules directly. Do not substitute the Family
Flix browser implementation for Android TV parity. Do not publish this port as
complete until the native screens and behavior are implemented and tested.

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
