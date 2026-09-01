# Family .28 guarded web deployment

These scripts are prepared for operator review, not an instruction to deploy. Do not create the final package until the production build and browser smoke tests are stable. Neither preparation nor verification installs anything. Actual installation and rollback require the operator's elevated PowerShell session; the scripts do not request UAC, stop Jellyfin, or restart it themselves.

## Fixed scope

- Source: `C:\Users\Plex Server\Documents\Codex\2026-08-25\computer-plugin-computer-use-openai-bundled\work\familyflix-web-custom`, pinned upstream web version `10.11.5`, custom build `0.19.10-family.28`.
- Live web root: `C:\Program Files\Jellyfin\Server\jellyfin-web`.
- Packaging baseline: Jellyfin `10.11.5`, PID `7656`, and the exact live 1.0.0.3 plugin hash. Its process start time is captured and must remain the same throughout package preparation.
- Activating plugin 1.0.0.4 intentionally restarts Jellyfin, so installation does not reuse the stale preparation PID. It requires the exact 1.0.0.4 plugin hash, captures the sole post-activation Jellyfin PID/start instant, and requires that identity to remain unchanged throughout install or rollback. Windows may hide the executable path from a normal token; the guard records that explicitly and still pins the process name, on-disk executable version, and plugin hash. An elevated installer sees and checks the executable path normally.
- Rollback directory: `C:\ProgramData\Jellyfin\Server\data\FamilyFlixWebBackups\web-family28-<UTC-timestamp>-<unique-suffix>`.
- No media/library scan, settings API, database operation, plugin write, service restart, or asset deletion is performed.

The reviewed Dashboard-only package `family28-package-20260901-033955-143-ced3d3cb` was completed against the recorded PID 7656 baseline before Jellyfin later restarted. Its manifest is immutable and remains the only approved package. The old preparation PID is no longer live, so do not repeat the preparation/build steps or select the earlier package manually; a new package would require a fresh baseline review and a new set of pins.

Only `index.html` is intentionally replaced. `config.json`, `manifest.json`, and `robots.txt` are always retained byte-for-byte; these three and `index.html` are the only four root-file exclusions from the built asset-copy set. All other existing web files, including old bundles and v4 watchlist additions, are preserved and verified. Missing new assets are copied with `FileMode.CreateNew`; a pre-existing destination is never overwritten even if it appears between verification and copying.

The final Dashboard-only collision preflight found 6 new and 2,305 identical assets, with only the four excluded root files different. This is contextual, not an installer allowlist: the frozen manifest recalculates the exact file set and counts. All colliding asset hashes must match before any copying is permitted.

## Reviewed live fingerprints

| File | SHA-256 |
| --- | --- |
| `index.html` before .28 | `247B2344F7EA604BF63F01389D3A8259E6339CB0C3EEB33C472F9B9603B02399` |
| production .28 `dist\index.html` | `555B76840BA542F4EBE5B90EE51307CD02172010FE4844DCBF415885B3EE1E3A` |
| staged .28 `index.html` with preserved v4 tags | `B8499B8E2252AEB66A52CB25B671ED93F437FD442F4F668C1F7E194E95B713A7` |
| `config.json` | `4C68B3678DA63EED7BD3E0E324D46D64B7040D10E491742FD807BC135CAD982C` |
| `manifest.json` | `2671DD8F189C9190A71F9D32EDD721C07DFF4609237404C03E8F7741A16A376D` |
| `robots.txt` | `331EA9090DB0C9F6F597BD9840FD5B171830F6E0B3BA1CB24DFA91F0C95AEDC1` |
| `familyflix-watchlist-v4.js` | `3CA8F54AAAF9D39DB20DF9D5EE5390E780A941F6F83F09A3A9DBDF156C4350EC` |
| `familyflix-watchlist-v4.css` | `91EF3982D468F0E2431A8AFC0F27C199656FBFCC59EA786BCEDEDEA6FAC0ABA5` |
| packaging baseline `Family Flix Watchlists_1.0.0.3\Jellyfin.Plugin.FamilyWatchlist.dll` | `06820040505AA7B868AEE563B23048FCEE634BD1402AC7687ED39C4D4DB18240` |
| required `Family Flix Watchlists_1.0.0.4\Jellyfin.Plugin.FamilyWatchlist.dll` | `A90F7A91C26684F9A22AFB0F0EA7D81C0D643DEA871271C48EFCE98D86BD4745` |

The plugin is read only for its fingerprint at `C:\ProgramData\Jellyfin\Server\plugins\Family Flix Watchlists_1.0.0.4\Jellyfin.Plugin.FamilyWatchlist.dll`. Activate and verify plugin 1.0.0.4 first; preparation and installation deliberately fail closed while 1.0.0.3 remains live. Configuration uses the current `4C68...` fingerprint, not the obsolete `C600...` value.

The preparer extracts these exact existing tags and inserts them immediately before the built page's first deferred script, in this order. Nothing else in the built HTML is transformed:

```html
<link rel="stylesheet" href="familyflix-watchlist-v4.css?v=4">
<script defer src="familyflix-watchlist-v4.js?v=4"></script>
```

## Operator sequence (not executed by this document)

Run commands from the deployment directory shown above. All supplied package/backup paths must be absolute. The scripts reject path traversal, alternate data streams, reserved device names, linked/reparse files and directories, and unexpected target roots. Use Windows PowerShell 5.1 or newer.

`test-family28-guards.ps1` runs 27 pure synthetic process-identity checks without contacting the server or writing files. It passes in PowerShell 7.6.4 and retains Windows PowerShell 5.1-compatible syntax, including handling the different timestamp types produced by their JSON readers. Exact UTC instants must match; one-tick differences, invalid/default/unspecified dates and changed process/path/version/plugin values still fail closed.

1. Finish the final production build and offline/authenticated browser smoke checks. Confirm no more edits or builds are running.
2. Read-only build/live preflight: `& '.\prepare-family28-web.ps1' -VerifyOnly`. It verifies the exact pre-activation 1.0.0.3 baseline and writes no package, manifest, result, or backup.
3. Only after the operator declares the build stable: `& '.\prepare-family28-web.ps1' -BuildVerifiedStable`. This creates a unique local `family28-package-...` directory containing frozen assets, original/built/staged entry pages, the hash manifest, and a summary. It never writes to the live server. An interrupted package without a completed manifest is unusable; leave it for review and prepare a new unique package.
4. Review the output package path, manifest fingerprint, final new/same counts, protected fingerprints, and the two-tag-only entry-page transformation. Set `$ffReviewedPackage` to that exact absolute package path; do not use a wildcard or select the newest directory automatically.
5. Activate and verify the pinned Family Flix Watchlists 1.0.0.4 package using the separately reviewed activation script.
6. Run `& '.\install-family28-web.ps1' -PackagePath $ffReviewedPackage -VerifyOnly`. This rehashes the complete staged set and all live collision targets, checks every original web file and the newly captured process/version/config/1.0.0.4 plugin state, and produces only console output. It can run without elevation if those paths are readable.
7. After explicit operator review, run the same installer **without** `-VerifyOnly` in an elevated session. It repeats preflight, makes and verifies the timestamped original-index backup, copies only missing new assets, rechecks all old/new assets and protected state, and atomically replaces the entry page. An explicit `index.atomic-rollback.html` backup path is supplied to `File.Replace` because a null backup argument is unsafe under Windows PowerShell 5 marshaling.
8. Read the successful result in both the local deployment directory (`install-family28-<timestamp>.json`) and the backup (`install-result.json`). Verify unchanged server PID/start time, stock version, configuration/watchlist/plugin fingerprints, and `existingAssetsPreserved: true`. Re-run installer `-VerifyOnly` to verify the installed state, then perform the agreed browser smoke checks against the live entry page. No scripted user-data mutation is required to verify installation.

The installer returns read-only success for an already-installed matching package; it does not make another backup or reinstall. A differently changed entry page, asset collision, changed protected hash, changed process, or linked path fails closed. Existing v4 client files are never updated by this deployment.

### One-prompt combined activation

`C:\Users\Plex Server\Documents\Codex\2026-08-25\computer-plugin-computer-use-openai-bundled\work\activation-staging\activate-familyflix-v1004-family28.ps1` (SHA-256 `71A62E01BFC6B42C384E3EE8EF21B5DB8D067115D192A16E155E51AE99DAF8AC`) is the exact combined wrapper for the immutable package `family28-package-20260901-033955-143-ced3d3cb` (manifest SHA-256 `856E7B3B0A566168B5051F831883795DC1C8E8C347FEC7E1195BBBBFE9F8DAFB`). Its `-VerifyOnly` mode validates every pinned child script and the web manifest without requesting elevation or writing anything. A normal PowerShell 7 run requests one UAC elevation, performs the plugin activation first, and invokes the Family .28 installer only after the plugin result proves version/hash, administrator/non-administrator permission checks, and the sanitized Health contract. The activation preflight explicitly flattens Jellyfin's session/plugin arrays, compares plugin IDs as GUIDs, and refuses to proceed while any active or paused playback exists. The failed first activation record is retained; the reviewed retry writes to a separate result path and never overwrites it.

The combined wrapper never performs a cross-component rollback. A plugin failure uses only the activation script's plugin rollback. A later web failure leaves the successfully verified plugin active and records the web installer's own result/backup paths for operator-reviewed web rollback. One unique combined JSON result is written for success or failure.

## Rollback and failure handling

Do not delete new bundles, partial copies, pending entry-page files, old assets, or backup files automatically. Before the atomic switch, failed copying leaves the original page in place. After the switch, the failure report identifies `indexReplaced: true`; do not assume a verification failure automatically restored the old page. Review the report and exact backup path first.

Set `$ffReviewedBackup` to the absolute `backupPath` from the installation result/backup plan. Run `& '.\rollback-family28-web.ps1' -BackupPath $ffReviewedBackup -VerifyOnly`. This validates the pinned original page, the backup manifest/inventory, the currently installed .28 page, all original assets, and unchanged server/protected state, without writing a result or any file. A later unrelated deployment blocks rollback.

After operator approval, run the rollback without `-VerifyOnly` in an elevated session. It atomically restores **only** the original entry page and keeps the displaced .28 page in the same backup directory. It leaves every original and newly added asset in place, verifies that no other existing file changed, and records results locally and in the backup. No media/database/plugin/config changes or server restart are performed. Browser caches may need a normal reload; do not clear application/user data as part of this procedure.

Both scripts record a failure result when execution was requested and a safe output path is available. `-VerifyOnly` never writes failure reports. All write operations are scoped to a new local package, new live asset paths/pending entry page, the one live entry-page replacement, or the exact timestamped backup and local result files. There is intentionally no broad synchronization, mirror, cleanup, or recursive-delete command.
