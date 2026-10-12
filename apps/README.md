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

## `app.md` options

| Line | Needed? | What it does |
|---|---|---|
| `name:` | yes | App name on the card |
| `summary:` | yes | One-line description on the card |
| `package:` | yes | Package name; also fills in `{package}` in `commands.txt` |
| `repo:` | one of these three | Installs the latest GitHub release's `.apk` |
| `apk:` | | A direct download link to an `.apk` |
| `app.apk` file | | An APK file put in the app's folder |
| `asset:` | no | With `repo:`, when a release has several APKs: part of the file name to pick (e.g. `release`). By default the first non-debug APK is used. |
| `version:` | no | Version to show (filled in automatically for `repo:`) |
| `order:` | no | Sort position; lower numbers first (default 1000, then by name) |

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

These **shortcuts** do the fiddly ones safely:

| Shortcut | What it does |
|---|---|
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
