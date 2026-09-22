# Family Flix Windows parity tracker

This is the release gate for the Windows client. A successful build alone does
not mean it can replace the Android TV app. Each row needs a Windows interaction
check against the same Jellyfin server and user profiles before release.

| Area | Windows source today | Required check or work |
| --- | --- | --- |
| Fixed server URL and visible-user sign in | Fixed URL configured; server web sign in | Verify only visible users appear and switching preserves the current session |
| Native playback, audio and subtitle tracks, resume | Jellyfin Desktop libmpv integration | Play representative x265 movies, older TV audio, subtitles, resume and seek |
| Home libraries, preferred order, hidden libraries, Continue Watching and Deck | Server web home | Port Android TV Home/Deck rules and remote focus memory |
| Personal and family Watchlists | Existing server web watchlist injection | Verify additions, removals and real-time cross-device sync |
| Mixed movie/show/episode playlists | Server web playlist support | Verify add and playback for all three item types |
| Profile switch and Watch Together | Server web account switch | Port Watch Together participants, home-feed choice and exit flow |
| Family Night and household voting | Android-only interface | Port picker, filters and voting interface |
| Backdrops, themes and detail actions | Server web presentation | Match TV layout, action strip, theme choices and remote focus |
| Intro, recap, preview and outro prompts | Server web media segment controls | Verify Ask/Auto/Off and per-series choices during native playback |
| Live TV guide, preview, categories and time shifting | Server web guide plus native player | Verify two-hour guide, preview/fullscreen and buffer controls |
| Movie/show and Live TV one-hour buffers | Native libmpv cache defaults | Port separate settings and disk-backed ahead cache |
| Issues, broken-media warnings and admin Health Centre | Server web and plugins | Verify reports and warnings on details and playback |
| Settings sync and updates | Different Windows settings and build feed | Port profile settings sync and Windows update prompt/install |
| Keyboard, mouse and remote | Qt input plus server web | Test D-pad, Back, page restoration and focus on every screen |

The Windows installer should be published only after all checks pass. Until
then the Android TV release remains the complete Family Flix client.
