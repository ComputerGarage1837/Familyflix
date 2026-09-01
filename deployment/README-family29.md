# Family .29 guarded web deployment

These scripts install the browser-only Problems inbox contrast and control fix. They do not stop or restart Jellyfin, touch media, alter the database, modify user/watch state, or replace any existing JavaScript/CSS asset. Preparation and verification are read-only. Installation requires an elevated operator session because the live web root is under Program Files.

## Fixed scope

- Source: `C:\Users\Plex Server\Documents\Codex\2026-08-25\computer-plugin-computer-use-openai-bundled\work\familyflix-web-custom`
- Upstream Jellyfin Web: `10.11.5`
- Family build: `0.19.10-family.29`
- Live web root: `C:\Program Files\Jellyfin\Server\jellyfin-web`
- Reviewed live baseline: Family .28 index `B8499B8E2252AEB66A52CB25B671ED93F437FD442F4F668C1F7E194E95B713A7`
- Reviewed Jellyfin process at packaging: PID `21324`, Jellyfin `10.11.5`; the exact start time is captured and must remain unchanged through installation.
- Required plugin: Family Flix Watchlists `1.0.0.4`, SHA-256 `A90F7A91C26684F9A22AFB0F0EA7D81C0D643DEA871271C48EFCE98D86BD4745`
- Rollback directory: `C:\ProgramData\Jellyfin\Server\data\FamilyFlixWebBackups\web-family29-<UTC-timestamp>-<unique-suffix>`

Only `index.html` is replaced. The installer copies missing content-addressed build assets with create-new semantics and refuses to overwrite collisions. It preserves every existing asset, plus `config.json`, `manifest.json`, `robots.txt`, and the existing Family Flix v4 watchlist files byte-for-byte.

## Protected live fingerprints

| File | SHA-256 |
| --- | --- |
| Family .28 `index.html` | `B8499B8E2252AEB66A52CB25B671ED93F437FD442F4F668C1F7E194E95B713A7` |
| `config.json` | `4C68B3678DA63EED7BD3E0E324D46D64B7040D10E491742FD807BC135CAD982C` |
| `manifest.json` | `2671DD8F189C9190A71F9D32EDD721C07DFF4609237404C03E8F7741A16A376D` |
| `robots.txt` | `331EA9090DB0C9F6F597BD9840FD5B171830F6E0B3BA1CB24DFA91F0C95AEDC1` |
| `familyflix-watchlist-v4.js` | `3CA8F54AAAF9D39DB20DF9D5EE5390E780A941F6F83F09A3A9DBDF156C4350EC` |
| `familyflix-watchlist-v4.css` | `91EF3982D468F0E2431A8AFC0F27C199656FBFCC59EA786BCEDEDEA6FAC0ABA5` |
| `Family Flix Watchlists_1.0.0.4\Jellyfin.Plugin.FamilyWatchlist.dll` | `A90F7A91C26684F9A22AFB0F0EA7D81C0D643DEA871271C48EFCE98D86BD4745` |

The preparer preserves exactly one copy of each existing v4 tag and injects nothing else into the production entry page:

```html
<link rel="stylesheet" href="familyflix-watchlist-v4.css?v=4">
<script defer src="familyflix-watchlist-v4.js?v=4"></script>
```

## Verified sequence

Run from this deployment directory and always use the exact package path returned by preparation—never a wildcard or “newest directory” lookup.

1. Run the full TypeScript, lint, test, style, production-build, and browser-compatibility checks.
2. Run `& '.\test-family29-guards.ps1'`.
3. Run `& '.\prepare-family29-web.ps1' -VerifyOnly`.
4. Run `& '.\prepare-family29-web.ps1' -BuildVerifiedStable` and review the returned package and manifest hashes.
5. Run `& '.\deploy-family29-reviewed.ps1' -VerifyOnly`. The wrapper pins the exact package path, manifest, staged index, installer, and shared guard hashes.
6. Run `& '.\deploy-family29-reviewed.ps1'`. It requests one hidden elevated PowerShell process, installs only the pinned package, then repeats the complete read-only verification in the caller.
7. Confirm the live Family .29 marker/hash and unchanged Jellyfin process/protected files, then perform an authenticated browser smoke test.

Preparation freezes all build assets, the Family .28 rollback index, the staged Family .29 index, and complete old/new inventories into a unique package. Installation first creates a verified rollback backup, copies only missing hashed assets, rechecks both inventories and the server identity, then atomically replaces `index.html`. A changed PID/start time, plugin, protected file, collision, package byte, or target path fails closed.

## Rollback

Use only the `web-family29-*` backup path recorded by the successful Family .29 installation:

```powershell
& '.\rollback-family29-web.ps1' -BackupPath $ffReviewedBackup -VerifyOnly
& '.\rollback-family29-web.ps1' -BackupPath $ffReviewedBackup
```

Rollback atomically restores only the verified Family .28 entry page and retains the displaced Family .29 page in the backup. New hashed assets remain because deleting them could break another cached client or later deployment. Never run the Family .28 rollback directly while Family .29 is live.

Failed copying before the atomic switch leaves Family .28 live. A post-switch verification failure records `indexReplaced: true`; review that report and the exact verified backup before rolling back. No script performs broad synchronization, cleanup, recursive deletion, server restart, or user-data mutation.
