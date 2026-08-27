# Family Flix releases

This public repository is the update feed for the Family Flix Android TV client used by our family.

Family Flix checks the latest published GitHub release from inside the app. An available update is
shown as a remote-friendly prompt with **Install**, **Later**, and **Skip this version** choices.
Android may show its own final installation confirmation.

## Release assets

Each published release contains exactly these update assets:

- `Family-Flix-<version>.apk` — the installable Android TV application.
- `update.json` — package identity, version, file size, SHA-256 checksum, and release information.

The APK must always use the same Family Flix application ID and signing certificate, with a higher
Android version code than the previous release. The app verifies the metadata, complete APK hash,
package identity, version, and signing certificate before handing an update to Android.

## Installation

The first updater-enabled version must be installed manually. Later releases can be discovered and
downloaded from inside Family Flix. On each Shield, Android's **Allow from this source** permission
must be enabled for Family Flix before it can request an installation.

Family Flix is a personal customization based on the Jellyfin Android TV client and is not an
official Jellyfin release.
