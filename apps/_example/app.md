---
# Copy this folder, rename it (lowercase, dashes, e.g. my-app), and fill these in.
# Folders whose name starts with _ are ignored, so this one never shows on the site.
name: My App
summary: One sentence shown on the app's card.
# Where the APK comes from. Use ONE of these:
repo: some-user/some-repo          # the latest GitHub release's .apk (recommended)
# apk: https://example.com/app.apk # a direct download link
# ...or upload the APK file into this folder (any name) and remove both lines above.
package: com.example.myapp         # the app's package name
order: 10                          # optional: lower numbers show first
# type: mdm                        # only for MDMs: own section, installed after the other apps
---
Everything below the dashes is the **Read more** text. It's Markdown:

- bullet lists like this one
- **bold**, *italic*, [links](https://example.com)
- pictures: put the image in this folder and write ![Screenshot](screenshot.png)
