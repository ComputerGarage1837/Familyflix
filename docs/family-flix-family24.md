# Family Flix browser update .24

Based on the existing Jellyfin Web **10.11.5** source. This is a client-only update; it does not require a Jellyfin Server upgrade, restart, plugin replacement, media scan, or watch-data migration.

## Scope

- Progressive Movies / Shows / Episodes search, with other supported video-related filters available separately.
- Bounded browsing/search recovery that keeps existing cards and focus. An unavailable request has a Retry action instead of being presented as an empty library. Old profile, query, and page responses cannot replace the current view.
- Music, music videos and Live TV are excluded from normal home/library navigation, default search and unused Favorites requests. Server configuration still receives the complete library list. Video audio, mixed playlists, books and audiobook playback support remain available.
- A **Show playback settings** action on show and episode detail pages shares portable settings with Family Flix TV .24. Audio language, subtitle mode/language, intro behaviour and autoplay are scoped by server, profile and show. Audio output, decoder, streaming quality, subtitle timing, watched state and resume positions are not part of preference sync.
- Existing v4 browser watchlists remain installed and are not modified by this deployment.

No Undo feature, recent-browsing history, or Deck-selection policy change is included.

## Shared preference contract

Use the existing authenticated DisplayPreferences API with `client=familyflix`, the active user, and the ID `familyflix-series-playback-v1-{canonical-lowercase-hyphenated-series-GUID}`. Preserve the entire returned DisplayPreferences object and unrelated custom preferences. The JSON string in `CustomPrefs.familyFlixSeriesPlaybackV1` contains version 1, revision, updatedAtEpochMillis, writerDeviceId and the portable values.

The schema and merge policy are implemented in `src/familyflix/seriesPreferencePolicy.ts`; the runtime is `src/familyflix/seriesPreferences.ts`. Reads have a 1.5-second total budget and cached fallback. Ordinary default-only reads never write. Offline edits are durably stored before an upload and merged field by field against their last observed base; conflicting newer server values win. An explicit reset writes defaults rather than deleting the remote document. Unknown schema versions and unknown enum values fail closed. The underlying API has no atomic conditional update, so simultaneous writers are not claimed to be transactionally conflict-free.

Authentication event binding is deferred until runtime access. Do not eagerly access `ServerConnections` during module evaluation: the existing player/import graph is circular. A regression test checks import-time initialization safety.

## Verification

- The full Vitest suite passed: **238 tests in 19 files**.
- TypeScript, changed-source ESLint, new-dialog Stylelint and diff whitespace checks passed. Existing upstream warnings are not treated as new failures.
- The production Webpack build passed with its existing asset-size warnings; dependencies and upstream version were not upgraded.
- The isolated browser fixture exercised settings save, separate profiles, offline pending edits, reconnect, retained browsing cards and focus. It uses synthetic users and no live server calls.
- The full production preview reached the login screen and profile password form without browser console errors. It uses synthetic public endpoints and rejects all writes. This is not a real-user playback, network-performance or hardware-device test.

## Development checks

Run the pinned repository's TypeScript, Vitest and production build commands. `qa/vite.config.mjs` starts the isolated production-form/recovery fixture. `qa/serve-production.mjs` serves the built client with read-only synthetic public endpoints and the existing v4 assets. Neither preview should be exposed outside loopback or used as a real server.

## Deployment

See `deployment/README-family24.md` and the guarded PowerShell scripts. Freeze a verified build, preserve configuration and all existing assets, add only absent hash-verified assets, and atomically switch the backed-up entry page. Rollback changes only the entry page and retains both old and new assets. Installation records the exact backup path and unchanged running server identity.

The TV update keeps its existing package and signing certificate. Install over the current app rather than uninstalling; no settings reset is required. Seven production-component remote-navigation instrumentation tests compile for an isolated package, but have not run because no Shield or emulator was connected. Android host unit tests passed: **451**.
