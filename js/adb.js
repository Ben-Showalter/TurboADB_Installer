// Talks to the phone over USB using Tango (ya-webadb), loaded from jsDelivr.
// Connection and push/install flow adapted from JTech's MDM installer
// (https://github.com/JTech-Forums/mdminstaller, MIT, (c) 2025 Edwin Zimmerman
// and Usher Weiss). Tango is pinned to the same version that installer ships.
import { Adb, AdbDaemonTransport } from 'https://cdn.jsdelivr.net/npm/@yume-chan/adb@2.1.0/+esm';
import {
  AdbDaemonWebUsbDevice,
  AdbDaemonWebUsbDeviceManager,
} from 'https://cdn.jsdelivr.net/npm/@yume-chan/adb-daemon-webusb@2.1.0/+esm';
import AdbWebCredentialStore from 'https://cdn.jsdelivr.net/npm/@yume-chan/adb-credential-web@2.1.0/+esm';

// Printed after every command so we can read its exit code from the output.
const RC_MARKER = '__TURBOADB_RC=';

export class Phone {
  constructor() {
    this.manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    // The key the phone remembers when you tick "Always allow from this computer".
    this.credentials = new AdbWebCredentialStore('TurboADB Installer');
    this.adb = null;
    this.info = null;
    this.onDisconnect = () => {};
  }

  static isSupported() {
    return Boolean(globalThis.navigator?.usb && AdbDaemonWebUsbDeviceManager.BROWSER);
  }

  get connected() {
    return this.adb !== null;
  }

  /**
   * Asks the browser for the phone, then asks the phone to allow this computer.
   * `onStatus(text)` reports progress for the UI.
   */
  async connect(onStatus = () => {}) {
    onStatus('Choose your phone in the browser’s pop-up…');
    let device;
    try {
      device = await this.manager.requestDevice();
    } catch (e) {
      throw friendlyError(e);
    }
    if (!device) throw new Error('No phone was selected.');

    let connection;
    try {
      connection = await device.connect();
    } catch (e) {
      throw friendlyError(e);
    }

    onStatus('Check your phone: tap “Allow” on the USB debugging prompt.');
    let transport;
    try {
      transport = await AdbDaemonTransport.authenticate({
        serial: device.serial,
        connection,
        credentialStore: this.credentials,
      });
    } catch (e) {
      throw friendlyError(e);
    }

    this.adb = new Adb(transport);
    this.adb.disconnected.then(() => this.#dropped());

    onStatus('Connected. Reading phone details…');
    const [manufacturer, model, release, sdk, abilist, abi] = await Promise.all([
      this.getprop('ro.product.manufacturer'),
      this.getprop('ro.product.model'),
      this.getprop('ro.build.version.release'),
      this.getprop('ro.build.version.sdk'),
      this.getprop('ro.product.cpu.abilist'),
      this.getprop('ro.product.cpu.abi'),
    ]);
    // CPU types the phone can run, most preferred first (for split APKs).
    const abis = (abilist || abi).split(',').map((a) => a.trim()).filter(Boolean);
    this.info = { manufacturer, model, release, sdk: parseInt(sdk, 10) || 0, abis };
    return this.info;
  }

  async disconnect() {
    const adb = this.adb;
    this.adb = null;
    this.info = null;
    if (adb) {
      try { await adb.close(); } catch {}
    }
  }

  #dropped() {
    if (!this.adb) return;
    this.adb = null;
    this.info = null;
    this.onDisconnect();
  }

  #requireAdb() {
    if (!this.adb) throw new Error('The phone is not connected.');
    return this.adb;
  }

  /** Runs a shell command; returns its combined stdout/stderr and exit code. */
  async run(command) {
    const adb = this.#requireAdb();
    const raw = await adb.subprocess.noneProtocol.spawnWaitText(
      `(${command}\n) 2>&1; echo "${RC_MARKER}$?"`,
    );
    const at = raw.lastIndexOf(RC_MARKER);
    if (at === -1) return { output: raw.trim(), exitCode: null };
    return {
      output: raw.slice(0, at).trim(),
      exitCode: parseInt(raw.slice(at + RC_MARKER.length), 10),
    };
  }

  async getprop(name) {
    return (await this.run(`getprop ${name}`)).output.trim();
  }

  /** Installed versionName of a package, or null if it isn't installed. */
  async installedVersion(pkg) {
    const listed = await this.run(`pm list packages ${pkg}`);
    if (!listed.output.split('\n').some((l) => l.trim() === `package:${pkg}`)) return null;
    const { output } = await this.run(`dumpsys package ${pkg}`);
    return output.match(/versionName=(\S+)/)?.[1] ?? '';
  }

  /** Copies an APK Blob to the phone and installs it with `pm install -r`. */
  async installApk(blob, onProgress = () => {}) {
    const adb = this.#requireAdb();
    const remote = `/data/local/tmp/turboadb_${Date.now()}.apk`;
    const total = blob.size;
    let sent = 0;
    const counted = blob.stream().pipeThrough(new TransformStream({
      transform(chunk, controller) {
        sent += chunk.byteLength;
        onProgress(sent / total);
        controller.enqueue(chunk);
      },
    }));

    const sync = await adb.sync();
    try {
      await sync.write({ filename: remote, file: counted, permission: 0o644 });
    } finally {
      await sync.dispose();
    }

    const result = await this.run(`pm install -r "${remote}"`);
    await this.run(`rm -f "${remote}"`);
    if (!/\bSuccess\b/.test(result.output)) {
      throw new Error(explainInstallError(result.output));
    }
  }
}

function friendlyError(e) {
  if (e instanceof AdbDaemonWebUsbDevice.DeviceBusyError) {
    return new Error(
      'Another program is using the phone’s USB connection. Close it and try again. '
      + 'If adb is installed on this computer, run “adb kill-server” first. '
      + 'Other browser tabs using USB can also hold it.',
    );
  }
  if (e?.name === 'NotFoundError') return new Error('No phone was selected.');
  if (e?.name === 'SecurityError') {
    return new Error('The browser blocked USB access. This page must be opened over https.');
  }
  if (e?.name === 'NetworkError') {
    return new Error('The USB connection dropped. Unplug the phone, plug it back in, and try again.');
  }
  return e instanceof Error ? e : new Error(String(e));
}

const INSTALL_ERRORS = {
  INSTALL_FAILED_UPDATE_INCOMPATIBLE:
    'A different copy of this app is already installed (signed with another key). Uninstall it from the phone first, then try again.',
  INSTALL_FAILED_VERSION_DOWNGRADE:
    'The phone already has a newer version of this app.',
  INSTALL_FAILED_INSUFFICIENT_STORAGE: 'The phone is out of storage space.',
  INSTALL_FAILED_OLDER_SDK: 'This app needs a newer version of Android than the phone has.',
  INSTALL_FAILED_NO_MATCHING_ABIS: 'This app isn’t built for this phone’s processor.',
  INSTALL_FAILED_TEST_ONLY: 'This APK is a test build and can’t be installed this way.',
  INSTALL_FAILED_USER_RESTRICTED:
    'The phone blocked the install. Some phones need “Install via USB” turned on in Developer options.',
  INSTALL_PARSE_FAILED_NOT_APK: 'The downloaded file isn’t a valid APK.',
};

function explainInstallError(output) {
  for (const [code, text] of Object.entries(INSTALL_ERRORS)) {
    if (output.includes(code)) return `${text} (${code})`;
  }
  return output || 'The install failed without an error message.';
}
