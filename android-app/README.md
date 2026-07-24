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
      AdminActivity.kt     switch team + enter/validate token + open Slides
      SlidesActivity.kt    admin board manager (hide/show, move, locations, add)
      DisplayStatusActivity.kt  live online/offline status of every display
      Heartbeat.kt         fetch + parse the heartbeat backend JSON
      ThumbLoader.kt       async slide-thumbnail loader (GitHub Pages + raw fallback)
      CollageRenderer.kt   native 1080x1920 collage (backdrop, grid, rounded cells, title)
      GithubUploader.kt    GitHub Contents API: sha-fetch + atomic PUT overwrite
      Teams.kt             team → slide-filename + title mapping
      Prefs.kt             persisted team + token (SharedPreferences)
    res/                   layouts, strings, theme, launcher icon
```

## Admin: manage the board deck (`SlidesActivity.kt`)

Behind the admin password: **⚙ Admin → 🖼 Manage board slides**. This is a mobile
view of the notice-board slide deck (`config.json` → `slides[]`), so an admin can
rearrange the board from a phone. It edits `config.json` directly (re-reading it
before every write so it never clobbers a concurrent web-admin or other-phone edit).

- **View** — a full-screen, swipeable preview (one slide per screen, like the web's TV
  preview). The top overlay shows the position (`n / N · on board`, or *Available to add*),
  a refresh, and an upload-new (＋) button; the bottom overlay shows the filename, where it
  shows, and floating action icons. Board slides come first (in display order), then the
  *Available to add* images not yet on the board.
- **Hide / Show** (🙈 / 👁) — hiding clears a slide's display locations (so it shows nowhere)
  but keeps it in the deck, dimmed with a *Hidden* tag; the previous locations are remembered
  and restored on **Show**.
- **Location** (📍) — change which towers/cores (and clubhouse/gate) a slide shows on.
- **Move** (↕) — change a slide's position in the rotation.
- **Add at a position** — swipe to an *Available to add* image and tap ＋, or use the top-bar
  ＋ to **upload a new slide** from the phone (pick image → name it → choose position + locations).

The displays play slides in `slides[]` order and only show a slide on a display whose
tower id is in that slide's `towers`; an empty `towers` hides it everywhere. This screen
is the source of truth those two rules act on.

## Admin: display status (`DisplayStatusActivity.kt`)

Reached from the **📺 icon in the board control top bar** (Admin → Manage board slides →
`EM@2026` → 📺). A native version of the web admin's *Displays* panel:
it GETs the heartbeat backend (`heartbeatUrl` in config.json) and shows every display
(tower/core + clubhouse + gate) as **online / offline / never reported**, worst-state
first. Each card shows the last-seen time, app version, and slide count. The list
re-polls every 30 seconds while open. A display is considered **offline after 35 minutes**
of silence — the same threshold as `js/status.js` (`STALE_MS`). It's read-only (makes no
changes) and lives inside the board control screen, so it's behind the `EM@2026` gate.

Parsing lives in [`Heartbeat.kt`](app/src/main/java/com/estancia/photos/Heartbeat.kt);
the backend and its one-time setup are documented in [`../heartbeat/README.md`](../heartbeat/README.md).

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
