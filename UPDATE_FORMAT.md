# Update manifest format

Each stable GitHub release must use a tag matching `v<versionName>` and attach one `update.json`
file with schema version 1:

```json
{
  "schemaVersion": 1,
  "packageName": "org.jellyfin.androidtv.family.debug",
  "versionName": "0.19.10-family.7",
  "versionCode": 191007,
  "apk": {
    "assetName": "Family-Flix-0.19.10-family.7.apk",
    "sha256": "64 lowercase hexadecimal characters",
    "sizeBytes": 12345678
  }
}
```

The named APK asset must exist exactly once in the same release. Its GitHub asset size must match
`sizeBytes`. Family Flix downloads no prerelease or draft release and rejects unknown manifest
fields, mismatched tags, packages, asset names, sizes, hashes, versions, or signing certificates.
