# Adding an app

Every folder in `apps/` is one app on the site. You don't need to touch any
code; you can do all of this in GitHub's website.

## The quick way (on github.com)

1. Open the [`_example`](_example) folder and copy its three files into a new
   folder, for example `apps/my-app/`. On GitHub: **Add file → Create new
   file**, type `apps/my-app/app.md` as the name, and paste the example in.
2. Edit **`app.md`**:
   - `name`: shown on the card.
   - `summary`: the one-line description on the card.
   - `repo`: the GitHub repo (`owner/name`) whose **latest release** has the
     APK. The site always installs the newest release.
   - `package`: the app's package name (e.g. `com.flipos.launcher`).
   - Everything below the second `---` is the **Read more** text, written in
     Markdown.
3. Edit **`commands.txt`**: the adb commands to run after the app is
   installed, one per line (see below). Delete it if the app needs none.
4. Upload an icon named **`icon.png`** or **`icon.svg`** (square works best).
   **Add file → Upload files** in the app's folder.
5. Commit. The site rebuilds and publishes in a couple of minutes (watch the
   **Actions** tab).

Folders whose name starts with `_` (like `_example`) are ignored.

## Adding an app from an APK file (no GitHub release)

For an app that isn't on GitHub, or to keep an app at one exact version:

1. Make the app's folder with `app.md` (leave out the `repo:` line),
   `commands.txt` and an icon, as above.
2. In that folder, **Add file → Upload files** and drag the `.apk` in. Any file
   name works.
3. Commit.

The site installs that file until you upload a different one (delete the old
`.apk` when you do). The card shows the file name as the version unless you set
`version:` in `app.md`. An uploaded APK always wins over `repo:` and `apk:`.

GitHub's website accepts files up to **25 MB**. For a bigger APK, put it
somewhere that gives a direct download link and use `apk: <link>` instead.
For a processor-split app, upload one APK per type with the type in the file
name (for example `myapp-arm64-v8a.apk` and `myapp-armeabi-v7a.apk`).

## MDM apps

Add **`type: mdm`** to an MDM's `app.md`. MDMs are listed in their own
**MDM / Filters** section, and when you tick several apps and click
**Install selected**, every regular app installs first and MDMs go last. If a
regular app fails to install, the selected MDMs are skipped (an MDM can block
installing other apps afterwards), so you can fix the problem first.

## `app.md` options

| Line | Needed? | What it does |
|---|---|---|
| `name:` | yes | App name on the card |
| `summary:` | yes | One-line description on the card |
| `package:` | yes | Package name; also fills in `{package}` in `commands.txt` |
| `repo:` | one of these three | Installs the latest GitHub release's `.apk` |
| `apk:` | | A direct download link to an `.apk` |
| an uploaded `.apk` file | | An APK file in the app's folder (any name); stays at that version |
| `type:` | no | `mdm` for an MDM (own section, installed last); leave out for a regular app |
| `asset:` | no | With `repo:`, when a release has several APKs: part of the file name to pick (e.g. `release`). By default the first non-debug APK is used. |
| `version:` | no | Version to show (filled in automatically for `repo:`) |
| `order:` | no | Sort position; lower numbers first (default 1000, then by name) |

If a release has one APK per processor type (file names containing
`arm64-v8a`, `armeabi-v7a`, `x86_64` or `x86`, like MatChat's), the site keeps
all of them, skips any `universal` APK, and installs the one that matches the
connected phone.

Pictures for the Read more text go in the same folder, e.g.
`![Home screen](home.png)`.

## `commands.txt`

Each line is run on the phone exactly as if you typed it after `adb shell`.
Lines starting with `#` are notes and blank lines are skipped. `{package}` is
replaced with the package name from `app.md`.

```
# Runtime permissions
pm grant {package} android.permission.READ_CONTACTS

# Anything else adb shell can do
appops set {package} SYSTEM_ALERT_WINDOW allow
```

Start a line with **`sdk N+:`** to run it only on Android API level N or newer
(API 26 = Android 8, 29 = Android 10, 30 = Android 11, 33 = Android 13). On older
phones the line shows as skipped instead of failed:

```
sdk 33+: grant {package} android.permission.POST_NOTIFICATIONS
```

These **shortcuts** do the fiddly ones safely:

| Shortcut | What it does |
|---|---|
| `grant {package} PERM PERM …` | Grants several runtime permissions in one line; ones this phone's Android version doesn't have are noted, not failed |
| `set-sms-app {package}` | Makes the app the default texting app; on phones that can't do that from adb, opens the phone's "change SMS app?" prompt and tells the user to answer Yes |
| `enable-accessibility pkg/.Service` | Turns on an accessibility service **without turning off the others already on** (a plain `settings put` would replace them) |
| `enable-notification-listener pkg/.Listener` | Grants notification access, using the right method for the phone's Android version |
| `set-home pkg/.Activity` | Makes the app the default Home screen; on phones that can't do that from adb, opens the "choose Home app" prompt and tells the user to pick it |
| `device-owner pkg/.AdminReceiver` | Makes an app device owner (for MDM apps); first checks for signed-in accounts and explains if any block it |

A failing line doesn't stop the rest. The site shows ✓ / ⚠ / ✗ for each line
with its output, and each app's **Read more** lists every command it will run.

## Checking your changes

The **Actions** tab shows each build. A broken `app.md` fails the build with a
message saying what's wrong, and the previous version of the site stays up. An
app whose repo has no release yet still shows, with its Install button
disabled.
