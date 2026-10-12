---
name: MatChat
summary: End-to-end encrypted group chat (Matrix) for D-pad flip phones, with no people or room search by design.
repo: UncleAndy123/MatChat
package: org.matchat.client
order: 4
---
Matrix group messaging for Kyocera flips and other D-pad "dumbphones", by
[UncleAndy123](https://github.com/UncleAndy123/MatChat). It's driven entirely by
the D-pad and two soft keys.

### What it does

- **End-to-end encrypted** chat, built on the same Matrix Rust SDK as Element X.
  Unencrypted rooms show a warning.
- **No discovery, ever**: no room directory or people search. You join a room
  only by accepting an invitation or starting a chat with an address you
  already know (like `@wayne:example.org`).
- **Made for a 2.6″ screen**, with large text and high-contrast focus.
- **Admin-manageable**: an allow-list of servers can be pushed by an MDM.
- **Stays in sync** with a background service, since these phones have no
  Google push. It updates itself from GitHub Releases.

MatChat is **pre-release** software. You'll need a **Matrix account** on a
homeserver (for example matrix.org) to sign in.

### What the installer sets up

- The **microphone** (for calls, in progress) and, on Android 13+,
  notifications and pictures.
- Keeps Android's **battery saver** from stopping its sync.
- Turns on its **Accessibility "background helper"**, which fixes the right soft
  key on phones whose predictive keyboard swallows it, and lets sync run without
  the "MatChat is running" notification.
- Lets it **install its own updates**.

This page installs the version built for your phone's processor (about 50 MB,
or 75 MB on 64-bit phones), so it takes a little longer than the other apps.

[More on GitHub](https://github.com/UncleAndy123/MatChat)
