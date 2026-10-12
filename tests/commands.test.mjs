import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommands, runLine, runAll, commandFailed, expandComponent } from '../js/commands.js';

/** A fake phone: `responses` maps a command (or regex) to its result; records every call. */
function fakeShell(responses = []) {
  const calls = [];
  const settings = {};
  const shell = async (command) => {
    calls.push(command);
    for (const [match, result] of responses) {
      if (typeof match === 'string' ? command === match : match.test(command)) {
        return typeof result === 'function' ? result(command) : { output: '', exitCode: 0, ...result };
      }
    }
    let m;
    if ((m = command.match(/^settings get secure (\S+)$/))) return { output: settings[m[1]] ?? 'null', exitCode: 0 };
    if ((m = command.match(/^settings put secure (\S+) '?(.*?)'?$/))) { settings[m[1]] = m[2]; return { output: '', exitCode: 0 }; }
    return { output: '', exitCode: 0 };
  };
  return { shell, calls, settings };
}

test('parseCommands drops notes and blank lines and fills in {package}', () => {
  const text = '# note\n\n  pm grant {package} android.permission.READ_CONTACTS  \r\n# another\nset-home {package}/.Main\n';
  assert.deepEqual(parseCommands(text, { package: 'com.x' }), [
    'pm grant com.x android.permission.READ_CONTACTS',
    'set-home com.x/.Main',
  ]);
});

test('commandFailed spots non-zero exits and error output with exit 0', () => {
  assert.equal(commandFailed({ output: '', exitCode: 0 }), false);
  assert.equal(commandFailed({ output: 'Success', exitCode: 0 }), false);
  assert.equal(commandFailed({ output: '', exitCode: 1 }), true);
  assert.equal(commandFailed({ output: 'Exception occurred while executing:\njava.lang.SecurityException: nope', exitCode: 0 }), true);
  assert.equal(commandFailed({ output: "Error: Unknown permission: foo", exitCode: 0 }), true);
  assert.equal(commandFailed({ output: 'Unknown command: set-home-activity', exitCode: 0 }), true);
  assert.equal(commandFailed({ output: '/system/bin/sh: cmd: not found', exitCode: 0 }), true);
});

test('expandComponent fills in the package for short class names', () => {
  assert.equal(expandComponent('com.a/.svc.S'), 'com.a/com.a.svc.S');
  assert.equal(expandComponent('com.a/com.b.S'), 'com.a/com.b.S');
});

test('plain commands run exactly as written', async () => {
  const { shell, calls } = fakeShell();
  const r = await runLine('pm grant com.x android.permission.CALL_PHONE', { shell, sdk: 25 });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ['pm grant com.x android.permission.CALL_PHONE']);
});

test('a failing plain command is reported, not thrown', async () => {
  const { shell } = fakeShell([[/^pm grant/, { output: 'Exception occurred', exitCode: 255 }]]);
  const r = await runLine('pm grant com.x bad', { shell, sdk: 25 });
  assert.equal(r.ok, false);
});

test('enable-accessibility keeps services that are already on', async () => {
  const fake = fakeShell();
  fake.settings.enabled_accessibility_services = 'com.other/.Svc';
  const r = await runLine('enable-accessibility com.x/.A11y', { shell: fake.shell, sdk: 28 });
  assert.equal(r.ok, true);
  assert.equal(fake.settings.enabled_accessibility_services, 'com.other/.Svc:com.x/.A11y');
  assert.ok(fake.calls.includes('settings put secure accessibility_enabled 1'));
});

test('enable-accessibility does not add a duplicate, even spelled differently', async () => {
  const fake = fakeShell();
  fake.settings.enabled_accessibility_services = 'com.x/com.x.A11y';
  const r = await runLine('enable-accessibility com.x/.A11y', { shell: fake.shell, sdk: 28 });
  assert.equal(r.ok, true);
  assert.equal(r.note, 'Already on.');
  assert.ok(!fake.calls.some((c) => c.startsWith('settings put secure enabled_accessibility_services')));
});

test('enable-accessibility starts a fresh list when the setting is null', async () => {
  const fake = fakeShell();
  await runLine('enable-accessibility com.x/.A11y', { shell: fake.shell, sdk: 24 });
  assert.equal(fake.settings.enabled_accessibility_services, 'com.x/.A11y');
});

test('enable-notification-listener uses cmd on Android 8+', async () => {
  const fake = fakeShell();
  const r = await runLine('enable-notification-listener com.x/.L', { shell: fake.shell, sdk: 28 });
  assert.equal(r.ok, true);
  assert.deepEqual(fake.calls, ['cmd notification allow_listener com.x/.L']);
});

test('enable-notification-listener falls back to settings on Android 7', async () => {
  const fake = fakeShell();
  fake.settings.enabled_notification_listeners = 'com.other/.L';
  const r = await runLine('enable-notification-listener com.x/.L', { shell: fake.shell, sdk: 25 });
  assert.equal(r.ok, true);
  assert.ok(!fake.calls.some((c) => c.startsWith('cmd ')));
  assert.equal(fake.settings.enabled_notification_listeners, 'com.other/.L:com.x/.L');
});

test('enable-notification-listener falls back when cmd fails, and still counts as ok', async () => {
  const fake = fakeShell([[/^cmd notification/, { output: 'Unknown command: allow_listener', exitCode: 0 }]]);
  const r = await runLine('enable-notification-listener com.x/.L', { shell: fake.shell, sdk: 26 });
  assert.equal(r.ok, true);
  assert.equal(fake.settings.enabled_notification_listeners, 'com.x/.L');
});

test('set-home succeeds quietly when cmd works', async () => {
  const fake = fakeShell();
  const r = await runLine('set-home com.x/.Main', { shell: fake.shell, sdk: 25 });
  assert.equal(r.ok, true);
  assert.equal(r.warning, undefined);
});

test('set-home opens the Home chooser with a warning when cmd fails', async () => {
  const fake = fakeShell([[/^cmd package set-home-activity/, { output: 'Error: Unknown command', exitCode: 1 }]]);
  const r = await runLine('set-home com.x/.Main', { shell: fake.shell, sdk: 23 });
  assert.equal(r.ok, true);
  assert.match(r.warning, /Always/);
  assert.ok(fake.calls.some((c) => c.startsWith('am start')));
});

test('device-owner refuses while accounts are signed in', async () => {
  const fake = fakeShell([['dumpsys account', { output: 'User UserInfo{0:Owner:13}:\n  Accounts: 1\n    Account {name=a@b.c, type=com.google}' }]]);
  const r = await runLine('device-owner com.x/.Admin', { shell: fake.shell, sdk: 28 });
  assert.equal(r.ok, false);
  assert.match(r.error, /1 account/);
  assert.ok(!fake.calls.some((c) => c.startsWith('dpm')));
});

test('device-owner runs dpm when there are no accounts', async () => {
  const fake = fakeShell([
    ['dumpsys account', { output: 'Accounts: 0' }],
    [/^dpm/, { output: 'Success: Device owner set to package com.x' }],
  ]);
  const r = await runLine('device-owner com.x/.Admin', { shell: fake.shell, sdk: 28 });
  assert.equal(r.ok, true);
  assert.ok(fake.calls.includes("dpm set-device-owner 'com.x/.Admin'"));
});

test('a shortcut without a component explains what it needs', async () => {
  const { shell } = fakeShell();
  const r = await runLine('set-home', { shell, sdk: 28 });
  assert.equal(r.ok, false);
  assert.match(r.error, /needs a component/);
});

test('runAll keeps going after a failure', async () => {
  const { shell, calls } = fakeShell([[/^false/, { exitCode: 1 }]]);
  const seen = [];
  const results = await runAll(['false', 'echo hi'], { shell, sdk: 28 }, (r) => seen.push(r.ok));
  assert.deepEqual(seen, [false, true]);
  assert.equal(results.length, 2);
  assert.deepEqual(calls, ['false', 'echo hi']);
});
