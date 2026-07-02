# EstPortfolioUpdater — native Android app

A pure native Kotlin app (no web code, no Capacitor) for field teams to publish a photo
collage to their dedicated slide on the notice board.

- **One app for all teams.** The team is **switchable in the Admin view** (⚙ *Admin* button on the
  main screen) along with the access token.
- Snap/pick a few photos → the app builds a collage natively (Android Canvas) → uploads it to the
  team's fixed slide file. The displays refresh automatically within ~15 minutes.
- The app **never edits config.json**; it only overwrites one image file per team.

## Project layout

```
android-app/
  app/src/main/
    java/com/estancia/photos/
      MainActivity.kt      photos → preview → upload
      AdminActivity.kt     switch team + enter/validate token
      CollageRenderer.kt   native 1080x1920 collage (backdrop, grid, rounded cells, title)
      GithubUploader.kt    GitHub Contents API: sha-fetch + atomic PUT overwrite
      Teams.kt             team → slide-filename + title mapping
      Prefs.kt             persisted team + token (SharedPreferences)
    res/                   layouts, strings, theme, launcher icon
```

## Team → slide mapping (`Teams.kt`)

| Team | Slide file | In config.json? |
|------|-----------|------------------|
| Gardening | `gardening-estancia.jpg` | ✅ |
| Pest Control | `pest-control-estancia.jpg` | ✅ |
| Housekeeping | `housekeeping-estancia.jpg` | ✅ |
| Maintenance | `maintenance-estancia.jpg` | ✅ |

Filenames are case-sensitive and must byte-match the config.json entries, or a second file is created
instead of overwriting. All four team slides are registered in the board's config.json (with `towers`),
so team uploads display right away. To add a **new** team, register its slide entry in config.json once
before its first upload.

The **MyGate notice** button (`mygate-estancia.jpg`) is different: it lets the uploader pick the
towers/cores per notice, and the app upserts that slide's config.json entry (name + chosen `towers`)
automatically on upload — so it needs no pre-registration.

## Access token (one shared token for all apps)

Authentication is **independent of the team** — the team dropdown only decides which slide file gets
overwritten. So create **one** GitHub token and paste the **same** token into every team's phone.

Create a GitHub **fine-grained PAT**:
- **Resource owner:** `estanciafoa`
- **Repository access:** Only select repositories → `noticeboard`
- **Permissions → Contents: Read and write** (everything else "No access")
- Set an expiry, generate, copy it.

The token must belong to an account with write access to `estanciafoa/noticeboard`. Enter it once per
phone in the Admin view; it is stored only on that phone, validated (a repo read) before saving, and can
be re-entered/rotated anytime. To rotate, generate a new token and re-enter it on each phone (revoking
the old one disables every phone using it — that's the trade-off of a single shared token).

## Build

Requires JDK 17 + Android SDK (already configured via `local.properties`).

```bash
cd android-app
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

Open in Android Studio (`File → Open` this folder) to run on a device/emulator, or build a signed
release APK with `./gradlew assembleRelease` once a signing config is added.

## Install on team phones (sideload)

1. Transfer `app-debug.apk` to the phone.
2. Allow "install unknown apps" for the source app, open the APK, install.
3. Launch **EstPortfolioUpdater** → ⚙ Admin → pick the team + paste the token → Save. Done.

## Build versions

Gradle 8.2.1 · AGP 8.2.1 · Kotlin 1.9.22 · compileSdk/targetSdk 34 · minSdk 24.
