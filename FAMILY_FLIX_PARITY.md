# Family Flix Windows parity tracker

This is the release gate for the Windows client. A successful build alone does
not mean it can replace the Android TV app. Each row needs a Windows interaction
check against the same Jellyfin server and user profiles before release.

| Area | Windows source today | Required check or work |
| --- | --- | --- |
| Fixed server URL and visible-user sign in | Native API client and visible-user sign-in screen coded | Verify passwordless/password accounts, profile switch and persisted sign-in |
| Native playback, audio and subtitle tracks, resume | Jellyfin Desktop libmpv integration | Play representative x265 movies, older TV audio, subtitles, resume and seek |
| Home libraries, preferred order, hidden libraries, Continue Watching and Deck | Native Qt home loads libraries, Continue Watching and untouched Deck candidates | Add preferred/hidden-library settings, focus restoration and Android active-older-season Deck correction |
| Personal and family Watchlists | Not yet ported to native UI | Use the existing Family Flix server API and verify cross-device sync |
| Mixed movie/show/episode playlists | Not yet ported to native UI | Port Android playlist controls and verify mixed playback order |
| Profile switch and Watch Together | Native sign-in exists; Watching Together not yet ported | Port Android presets, selected home feed, participant reporting and exit flow |
| Family Night and household voting | Not yet ported to native UI | Port Android picker and voting behavior |
| Backdrops, themes and detail actions | First native detail/backdrop view coded | Port all Android actions, themes and remote focus rules |
| Intro, recap, preview and outro prompts | Not yet ported to native playback | Port Android Ask/Auto/Off and per-series choices |
| Live TV guide, preview, categories and time shifting | Native player available; guide not yet ported | Port Android two-hour guide, preview/fullscreen and buffer controls |
| Movie/show and Live TV one-hour buffers | Separate up-to-one-hour native settings with memory-first and temporary-disk fallback | Test long VOD and live playback, storage cap and seek behavior; actual hour depends on bitrate and stream seekability |
| Issues, broken-media warnings and admin Health Centre | Server plugin exists; native views not yet ported | Show warnings and reports in native details/playback |
| Settings sync and updates | Windows release check and download prompt coded; native session persisted | Port Android-like settings screens and preserve them through installs |
| Keyboard, mouse and remote | First native Qt controls coded | Test D-pad, Back, page restoration and focus on every screen |

The Windows installer should be published only after all checks pass. Until
then the Android TV release remains the complete Family Flix client.
