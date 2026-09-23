# Family Flix Windows parity tracker

This is the release gate for the Windows client. A successful build alone does
not mean it can replace the Android TV app. Each row needs a Windows interaction
check against the same Jellyfin server and user profiles before release.

| Area | Windows source today | Required check or work |
| --- | --- | --- |
| Fixed server URL and visible-user sign in | Native API client and visible-user sign-in screen coded | Verify passwordless/password accounts, profile switch and persisted sign-in |
| Native playback, audio and subtitle tracks, resume | Native libmpv launch, audio/subtitle track chooser, resume and session reporting coded | Test representative x265 movies, older TV audio, subtitles, resume, seek and watched-status sync; build full controls |
| Home libraries, preferred order, hidden libraries, Continue Watching and Deck | Native Qt home loads libraries and rows; All Libraries now browses paginated collections; per-user library order, rail visibility, focus restoration and active-older-season Deck correction are coded | Verify ordering/visibility persistence, full-library browsing and Deck against watched older seasons on real profiles |
| Personal and family Watchlists | Native personal and family Watchlist read, display, membership and voting coded | Test cross-device sync, revision conflicts and playback auto-removal |
| Mixed movie/show/episode playlists | Native server-backed list, create, browse, add, remove and reorder controls coded; series expands into playable episodes | Test mixed playback order and create-and-add flow on real server |
| Profile switch and Watch Together | Native visible-user chooser, saved-profile switching, participant selection, combined label, feed owner, playback reporting, server-synced presets, exit flow and fair merged group Deck coded | Test login/profile switching, presets, party reporting and Deck against multiple real profiles; add Android active-older-season correction per group participant |
| Family Night and household voting | Native picker merges current/Watch Together personal Watchlists, filters type/runtime/age/genre, rerolls, opens details or plays a movie/first unwatched show episode; playback resolves current viewer's state first; household voting is available on item details | Test with real multi-profile lists, ratings, episode lookup and vote sync; add moved-item provider-ID fallback |
| Backdrops, themes and detail actions | Native details, focus-driven backdrops with thumbnail fallback and 60-second random idle rotation, show/season/episode navigation, watched/unwatched action, compact single-row actions and 15 per-user Android palette choices coded | Port remaining Android detail actions and remote focus rules; verify every theme contrast and image fallback on real media |
| Intro, recap, preview and outro prompts | Native segment fetch, Ask/Auto/Off defaults and playback prompt coded | Build and runtime test detection, timing, focus and per-series choices |
| Live TV guide, preview, categories and time shifting | Native categories, channel list, two-hour viewport/scrolling timeline, preview/fullscreen selection coded | Test live playback, guide timing, category/disabled-channel handling, pause/seek and buffer controls |
| Movie/show and Live TV one-hour buffers | Separate up-to-one-hour native settings with memory-first and temporary-disk fallback | Test long VOD and live playback, storage cap and seek behavior; actual hour depends on bitrate and stream seekability |
| Issues and broken-media warnings | Native item-detail warnings and movie/episode reporting coded against the server plugin | Test reports and warnings; admin Health Centre remains in the Jellyfin dashboard as requested |
| Settings sync and updates | Windows release check and download prompt coded; native session persisted | Port Android-like settings screens and preserve them through installs |
| Keyboard, mouse and remote | First native Qt controls and hidden-until-interaction playback bar coded | Test D-pad, Back, page restoration and focus on every screen |

The Windows installer should be published only after all checks pass. Until
then the Android TV release remains the complete Family Flix client.
