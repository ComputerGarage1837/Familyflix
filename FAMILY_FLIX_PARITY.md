# Family Flix Windows parity tracker

This is the release gate for the Windows client. A successful build alone does
not mean it can replace the Android TV app. Each row needs a Windows interaction
check against the same Jellyfin server and user profiles before release.

| Area | Windows source today | Required check or work |
| --- | --- | --- |
| Fixed server URL and visible-user sign in | Native API client and visible-user sign-in screen coded | Verify passwordless/password accounts, profile switch and persisted sign-in |
| Native playback, audio and subtitle tracks, resume | Native libmpv launch, basic audio selection, resume and session reporting coded | Test representative x265 movies, older TV audio, subtitles, resume, seek and watched-status sync; build full controls |
| Home libraries, preferred order, hidden libraries, Continue Watching and Deck | Native Qt home loads libraries and rows; per-user library order, rail visibility, focus restoration and active-older-season Deck correction are coded | Verify ordering/visibility persistence and Deck against watched older seasons on real profiles |
| Personal and family Watchlists | Native personal and family Watchlist read, display, membership and voting coded | Test cross-device sync, revision conflicts and playback auto-removal |
| Mixed movie/show/episode playlists | Native server-backed list, create, browse and add controls coded; series expands into playable episodes | Test mixed playback order, add remove/reorder and create-and-add flow |
| Profile switch and Watch Together | Native visible-user profile chooser exists; Watching Together not yet ported | Test password-protected/passwordless switching; port Android presets, selected home feed, participant reporting and exit flow |
| Family Night and household voting | Not yet ported to native UI | Port Android picker and voting behavior |
| Backdrops, themes and detail actions | Native details, backdrop and show/season/episode navigation coded | Port all Android actions, themes and remote focus rules |
| Intro, recap, preview and outro prompts | Not yet ported to native playback | Port Android Ask/Auto/Off and per-series choices |
| Live TV guide, preview, categories and time shifting | Native player available; guide not yet ported | Port Android two-hour guide, preview/fullscreen and buffer controls |
| Movie/show and Live TV one-hour buffers | Separate up-to-one-hour native settings with memory-first and temporary-disk fallback | Test long VOD and live playback, storage cap and seek behavior; actual hour depends on bitrate and stream seekability |
| Issues, broken-media warnings and admin Health Centre | Server plugin exists; native views not yet ported | Show warnings and reports in native details/playback |
| Settings sync and updates | Windows release check and download prompt coded; native session persisted | Port Android-like settings screens and preserve them through installs |
| Keyboard, mouse and remote | First native Qt controls and hidden-until-interaction playback bar coded | Test D-pad, Back, page restoration and focus on every screen |

The Windows installer should be published only after all checks pass. Until
then the Android TV release remains the complete Family Flix client.
