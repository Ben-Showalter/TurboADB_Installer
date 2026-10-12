// One app's full install: download the APK, copy it to the phone, install it,
// then run its commands.txt lines.
import { runAll } from './commands.js';

/**
 * Picks the APK for this phone. `apks` is the catalog list (one entry, or one
 * per CPU type); `abis` is the phone's supported CPU types, most preferred first.
 */
export function chooseApk(apks, abis) {
  if (apks.length === 1 && !apks[0].abi) return apks[0];
  for (const abi of abis) {
    const match = apks.find((a) => a.abi === abi);
    if (match) return match;
  }
  const universal = apks.find((a) => !a.abi);
  if (universal) return universal;
  throw new Error(
    `There’s no version of this app for this phone’s processor (${abis.join(', ') || 'unknown'}). `
    + `Available: ${apks.map((a) => a.abi).join(', ')}.`,
  );
}

/** Downloads a file from this site with progress, returning a Blob. */
async function downloadApk(path, expectedSize, onProgress) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Couldn’t download the app (${res.status}).`);
  const total = Number(res.headers.get('Content-Length')) || expectedSize || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total) onProgress(Math.min(received / total, 1));
  }
  return new Blob(chunks, { type: 'application/vnd.android.package-archive' });
}

async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `report({ stage, progress, text })` drives the card's progress bar.
 * `onCommand(result)` is called after each commands.txt line.
 * Resolves to the list of command results; throws if the install itself fails.
 */
export async function installApp(app, phone, { report, onCommand }) {
  const apk = chooseApk(app.apks, phone.info.abis);
  report({ stage: 'download', progress: 0, text: 'Downloading…' });
  const blob = await downloadApk(apk.path, apk.size, (p) =>
    report({ stage: 'download', progress: p * 0.4, text: 'Downloading…' }));
  if (apk.sha256 && (await sha256Hex(blob)) !== apk.sha256) {
    throw new Error('The downloaded file was damaged (checksum mismatch). Try again.');
  }

  report({ stage: 'copy', progress: 0.4, text: 'Copying to the phone…' });
  await phone.installApk(blob, (p) =>
    report({ stage: 'copy', progress: 0.4 + p * 0.4, text: p < 1 ? 'Copying to the phone…' : 'Installing…' }));

  if (!app.commands.length) return [];
  report({ stage: 'setup', progress: 0.8, text: 'Setting permissions…' });
  let done = 0;
  return runAll(app.commands, { shell: (c) => phone.run(c), sdk: phone.info.sdk }, (result) => {
    done += 1;
    report({ stage: 'setup', progress: 0.8 + (done / app.commands.length) * 0.2, text: 'Setting permissions…' });
    onCommand(result);
  });
}

/** The order to install a selection in: every regular app (in page order), then MDMs. */
export function planBatch(apps) {
  return [...apps.filter((a) => a.type !== 'mdm'), ...apps.filter((a) => a.type === 'mdm')];
}
