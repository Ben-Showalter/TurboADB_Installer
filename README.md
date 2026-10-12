# TurboADB Installer

A website that installs Android apps on a phone plugged into your computer,
then runs the adb commands each app needs (permissions, accessibility,
notification access, default Home screen). It works like the
[JTech MDM Installer](https://github.com/JTech-Forums/mdminstaller).

**Live site:** https://ben-showalter.github.io/TurboADB_Installer/

## Using it

1. Turn on **USB debugging** on the phone (the site's Help section explains how).
2. Open the site in **Chrome or Edge** on a computer and plug the phone in.
3. Click **Connect phone**, tap **Allow** on the phone, then **Install** on an app.

Firefox and Safari can't do this; they don't support WebUSB.

## Adding or changing apps

See **[apps/README.md](apps/README.md)**. Each app is a folder with an icon,
an `app.md` (name, description, GitHub repo) and a `commands.txt` (adb
commands). The site always installs each app's latest GitHub release.

## How it works

- It's a static site on GitHub Pages: plain HTML, CSS and JavaScript, no server.
- The browser talks to the phone over USB with
  [Tango (ya-webadb)](https://github.com/yume-chan/ya-webadb), loaded from jsDelivr.
  Nothing is sent anywhere else.
- A GitHub Action (`.github/workflows/deploy.yml`) runs on every push, every
  6 hours, and on demand. It runs `scripts/build-catalog.mjs`, which reads
  `apps/`, downloads each app's latest release APK into the site, and writes
  `catalog.json`. The page reads only that file.

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | The page |
| `js/ui.js` | App cards, Read more dialog, connect bar |
| `js/install.js` | Download → copy to phone → install → run commands |
| `js/commands.js` | Runs `commands.txt` lines and expands the shortcuts |
| `js/adb.js` | USB connection and adb commands (via Tango) |
| `scripts/build-catalog.mjs` | Builds `_site/` from `apps/` |

## Working on it locally

Needs [Node.js](https://nodejs.org) 20 or newer.

```
npm install
npm test           # unit tests
npm run preview    # build into _site/ and open it in the browser
```

`node scripts/build-catalog.mjs --offline` builds without downloading APKs.
Set `GITHUB_TOKEN` if you hit GitHub's rate limit.

## First-time setup (once)

In the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.

GitHub pauses scheduled workflows in repos with no activity for 60 days. If
new releases stop showing up, run the workflow from the **Actions** tab (or
push any change).

To make an app's release show up right away instead of within 6 hours, its
own release workflow can send a `repository_dispatch` event of type
`app-released` to this repo.

## Credits

The connection and install approach is adapted from the
[JTech MDM Installer](https://github.com/JTech-Forums/mdminstaller)
(MIT, © 2025 Edwin Zimmerman and Usher Weiss). See [LICENSE](LICENSE).
