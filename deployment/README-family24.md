# Family .24 guarded web deployment

These scripts are prepared for operator review, not an instruction to deploy. Do not create the final package until the production build and browser smoke tests are stable. Neither preparation nor verification installs anything. Actual installation and rollback require the operator's elevated PowerShell session; the scripts do not request UAC, stop Jellyfin, or restart it themselves.

## Fixed scope

- Source: `C:\Users\Plex Server\Documents\Codex\2026-08-25\computer-plugin-computer-use-openai-bundled\work\familyflix-web-custom`, pinned upstream web version `10.11.5`, custom build `0.19.10-family.24`.
- Live web root: `C:\Program Files\Jellyfin\Server\jellyfin-web`.
- Reviewed running server: Jellyfin `10.11.5`, PID `17992`. Its process start time is captured at preparation and must remain the same throughout install/rollback. A restart or updated binary requires a fresh review, not bypassing the guard.
- Rollback directory: `C:\ProgramData\Jellyfin\Server\data\FamilyFlixWebBackups\web-family24-<UTC-timestamp>-<unique-suffix>`.
- No media/library scan, settings API, database operation, plugin write, service restart, or asset deletion is performed.

Only `index.html` is intentionally replaced. `config.json`, `manifest.json`, and `robots.txt` are always retained byte-for-byte; these three and `index.html` are the only four root-file exclusions from the built asset-copy set. All other existing web files, including old bundles and v4 watchlist additions, are preserved and verified. Missing new assets are copied with `FileMode.CreateNew`; a pre-existing destination is never overwritten even if it appears between verification and copying.

The first preliminary build inventory was 165 new and 2,143 identical assets, with only the four excluded root files different. This is contextual, not an installer allowlist: the final manifest recalculates the exact file set and counts. All colliding asset hashes must match before any copying is permitted.

## Reviewed live fingerprints

| File | SHA-256 |
| --- | --- |
| `index.html` before .24 | `8FF711029C7441C47EBCBD8D06A713E1BF998FDECCE5D057728BEB38E2338C41` |
| `config.json` | `4C68B3678DA63EED7BD3E0E324D46D64B7040D10E491742FD807BC135CAD982C` |
| `manifest.json` | `2671DD8F189C9190A71F9D32EDD721C07DFF4609237404C03E8F7741A16A376D` |
| `robots.txt` | `331EA9090DB0C9F6F597BD9840FD5B171830F6E0B3BA1CB24DFA91F0C95AEDC1` |
| `familyflix-watchlist-v4.js` | `3CA8F54AAAF9D39DB20DF9D5EE5390E780A941F6F83F09A3A9DBDF156C4350EC` |
| `familyflix-watchlist-v4.css` | `91EF3982D468F0E2431A8AFC0F27C199656FBFCC59EA786BCEDEDEA6FAC0ABA5` |
| `Family Flix Watchlists_1.0.0.2\Jellyfin.Plugin.FamilyWatchlist.dll` | `B62F374B8F67B295D5AE2123EAFC1DE701B28E26CB83AF2959222434C4B40989` |

The plugin is read only for its fingerprint at `C:\ProgramData\Jellyfin\Server\plugins\Family Flix Watchlists_1.0.0.2\Jellyfin.Plugin.FamilyWatchlist.dll`. Configuration uses the current `4C68...` fingerprint, not the obsolete `C600...` value.

The preparer extracts these exact existing tags and inserts them immediately before the built page's first deferred script, in this order. Nothing else in the built HTML is transformed:

```html
<link rel="stylesheet" href="familyflix-watchlist-v4.css?v=4">
<script defer src="familyflix-watchlist-v4.js?v=4"></script>
```

## Operator sequence (not executed by this document)

Run commands from the deployment directory shown above. All supplied package/backup paths must be absolute. The scripts reject path traversal, alternate data streams, reserved device names, linked/reparse files and directories, and unexpected target roots. Use Windows PowerShell 5.1 or newer.

`test-family24-guards.ps1` runs 27 pure synthetic process-identity checks without contacting the server or writing files. It passes in PowerShell 5.1 and 7.6.4, including the different timestamp types produced by their JSON readers. Exact UTC instants must match; one-tick differences, invalid/default/unspecified dates and changed process/path/version/plugin values still fail closed.

1. Finish the final production build and offline/authenticated browser smoke checks. Confirm no more edits or builds are running.
2. Read-only build/live preflight: `& '.\prepare-family24-web.ps1' -VerifyOnly`. It writes no package, manifest, result, or backup.
3. Only after the operator declares the build stable: `& '.\prepare-family24-web.ps1' -BuildVerifiedStable`. This creates a unique local `family24-package-...` directory containing frozen assets, original/built/staged entry pages, the hash manifest, and a summary. It never writes to the live server. An interrupted package without a completed manifest is unusable; leave it for review and prepare a new unique package.
4. Review the output package path, manifest fingerprint, final new/same counts, protected fingerprints, and the two-tag-only entry-page transformation. Set `$ffReviewedPackage` to that exact absolute package path; do not use a wildcard or select the newest directory automatically.
5. Run `& '.\install-family24-web.ps1' -PackagePath $ffReviewedPackage -VerifyOnly`. This rehashes the complete staged set and all live collision targets, checks every original web file and the pinned process/version/config/plugin state, and produces only console output. It can run without elevation if those paths are readable.
6. After explicit operator review, run the same installer **without** `-VerifyOnly` in an elevated session. It repeats preflight, makes and verifies the timestamped original-index backup, copies only missing new assets, rechecks all old/new assets and protected state, and atomically replaces the entry page. An explicit `index.atomic-rollback.html` backup path is supplied to `File.Replace` because a null backup argument is unsafe under Windows PowerShell 5 marshaling.
7. Read the successful result in both the local deployment directory (`install-family24-<timestamp>.json`) and the backup (`install-result.json`). Verify unchanged server PID/start time, stock version, configuration/watchlist/plugin fingerprints, and `existingAssetsPreserved: true`. Re-run installer `-VerifyOnly` to verify the installed state, then perform the agreed browser smoke checks against the live entry page. No scripted user-data mutation is required to verify installation.

The installer returns read-only success for an already-installed matching package; it does not make another backup or reinstall. A differently changed entry page, asset collision, changed protected hash, changed process, or linked path fails closed. Existing v4 client files are never updated by this deployment.

## Rollback and failure handling

Do not delete new bundles, partial copies, pending entry-page files, old assets, or backup files automatically. Before the atomic switch, failed copying leaves the original page in place. After the switch, the failure report identifies `indexReplaced: true`; do not assume a verification failure automatically restored the old page. Review the report and exact backup path first.

Set `$ffReviewedBackup` to the absolute `backupPath` from the installation result/backup plan. Run `& '.\rollback-family24-web.ps1' -BackupPath $ffReviewedBackup -VerifyOnly`. This validates the pinned original page, the backup manifest/inventory, the currently installed .24 page, all original assets, and unchanged server/protected state, without writing a result or any file. A later unrelated deployment blocks rollback.

After operator approval, run the rollback without `-VerifyOnly` in an elevated session. It atomically restores **only** the original entry page and keeps the displaced .24 page in the same backup directory. It leaves every original and newly added asset in place, verifies that no other existing file changed, and records results locally and in the backup. No media/database/plugin/config changes or server restart are performed. Browser caches may need a normal reload; do not clear application/user data as part of this procedure.

Both scripts record a failure result when execution was requested and a safe output path is available. `-VerifyOnly` never writes failure reports. All write operations are scoped to a new local package, new live asset paths/pending entry page, the one live entry-page replacement, or the exact timestamped backup and local result files. There is intentionally no broad synchronization, mirror, cleanup, or recursive-delete command.
