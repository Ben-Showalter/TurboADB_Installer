import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseApk } from '../js/install.js';

const split = [
  { abi: 'arm64-v8a', path: 'a64' },
  { abi: 'armeabi-v7a', path: 'v7a' },
];

test('a single all-CPU APK is always used', () => {
  assert.equal(chooseApk([{ abi: null, path: 'one' }], []).path, 'one');
});

test('picks the phone’s most preferred CPU type', () => {
  assert.equal(chooseApk(split, ['arm64-v8a', 'armeabi-v7a', 'armeabi']).path, 'a64');
});

test('a 32-bit phone gets the 32-bit APK', () => {
  assert.equal(chooseApk(split, ['armeabi-v7a', 'armeabi']).path, 'v7a');
});

test('no matching CPU type gives a clear error', () => {
  assert.throws(() => chooseApk(split, ['x86_64', 'x86']), /processor \(x86_64, x86\)/);
});
