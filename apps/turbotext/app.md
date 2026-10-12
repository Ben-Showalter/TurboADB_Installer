---
name: TurboText
summary: A messaging app for the Kyocera E4810 with speech-to-text, translation, MMS and group texts.
repo: Ben-Showalter/TurboText
package: com.turbotext.app
order: 2
---
A replacement for the stock messaging app, built for the Kyocera **E4810** flip
phone. The E4811 and E4610 may work but aren't fully tested.

### What it does

- **Speech-to-text**: press the dictate button and say what you want to type.
  Works with a headset's noise-cancelling mic.
- **MMS**: send and receive pictures and audio.
- **Group messages**, shown in their own list.
- **Translation** of incoming texts into English, from most languages.
- **Text-to-speech**, with a Bluetooth-only option.
- **Opens from the Right soft key** on the Home screen, in place of the stock app.
- **Archive** all conversations with one button.

### What the installer sets up

- Permissions for texting, contacts, calls, the microphone, camera and storage.
- Its **Accessibility** service and **Usage access**, which let the Right soft
  key open TurboText from the Home screen.
- Makes it your **default texting app**. The phone asks you to confirm; answer
  **Yes**.

### After installing: speech-to-text key

Speech-to-text uses Groq's Whisper service, so it needs a **Groq API key**.
Either:

- put the key in a text file in **Internal storage / Turbo key /**, or
- set a "provisioning phone number" in TurboText's settings, then text the key
  from that number, Base64-encoded and prefixed with `TURBOVOICE_SETUP:`. See the
  GitHub page for details.

[More on GitHub](https://github.com/Ben-Showalter/TurboText)
