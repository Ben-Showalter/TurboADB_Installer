import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, parseAppMd, rebaseLinks, abiOf, pickAssets, rewriteCodePaths } from '../scripts/build-catalog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { log() {}, error() {} };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

async function makeSite(apps) {
  const root = await mkdtemp(join(tmpdir(), 'turboadb-'));
  await writeFile(join(root, 'index.html'), '<!doctype html>');
  for (const [id, files] of Object.entries(apps)) {
    await mkdir(join(root, 'apps', id), { recursive: true });
    for (const [name, content] of Object.entries(files)) await writeFile(join(root, 'apps', id, name), content);
  }
  return root;
}

function mockFetch(routes) {
  globalThis.fetch = async (url) => {
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    if (route instanceof Uint8Array) return new Response(route);
    return new Response(JSON.stringify(route), { headers: { 'Content-Type': 'application/json' } });
  };
}

test('parseAppMd reads fields, ignores comments, keeps the body', () => {
  const { fields, body } = parseAppMd('---\n# note\nname: My App\nrepo: a/b   # trailing note\nsummary: "Quoted"\n---\nHello **there**\n');
  assert.deepEqual(fields, { name: 'My App', repo: 'a/b', summary: 'Quoted' });
  assert.equal(body, 'Hello **there**\n');
});

test('parseAppMd explains a missing front matter block', () => {
  assert.throws(() => parseAppMd('no dashes here'), /must start with a ---/);
});

test('rebaseLinks points relative images and links at the app folder only', () => {
  const html = '<img src="shot.png"><a href="https://x.y">x</a><a href="#top">t</a><img src="/abs.png">';
  assert.equal(
    rebaseLinks(html, 'apps/a/'),
    '<img src="apps/a/shot.png"><a href="https://x.y">x</a><a href="#top">t</a><img src="/abs.png">',
  );
});

test('the real apps/ folder builds offline', async () => {
  const out = await mkdtemp(join(tmpdir(), 'turboadb-out-'));
  const { apps, errors } = await build({ root: ROOT, outDir: out, offline: true, log: quiet });
  assert.deepEqual(errors, []);
  const flip = apps.find((a) => a.id === 'flip-launcher');
  assert.ok(flip, 'flip-launcher is in the catalog');
  assert.ok(!apps.some((a) => a.id.startsWith('_')), '_example is skipped');
  assert.ok(flip.commands.includes('set-home com.flipos.launcher/.activities.MainActivity'));
  assert.ok(!flip.commands.some((c) => c.includes('{package}')));
  assert.match(flip.details, /src="apps\/flip-launcher\/home\.png"/);
  assert.ok(existsSync(join(out, 'apps/flip-launcher/home.png')));
  assert.ok(!existsSync(join(out, 'apps/flip-launcher/commands.txt')));
});

test('downloads the latest GitHub release APK and records its checksum', async () => {
  const apk = new TextEncoder().encode('fake apk bytes');
  mockFetch({
    'https://api.github.com/repos/me/app/releases/latest': {
      tag_name: 'v1.2.3',
      html_url: 'https://github.com/me/app/releases/tag/v1.2.3',
      published_at: '2026-01-01T00:00:00Z',
      assets: [
        { name: 'app-debug.apk', browser_download_url: 'https://dl/debug.apk' },
        { name: 'app-release.apk', browser_download_url: 'https://dl/release.apk' },
      ],
    },
    'https://dl/release.apk': apk,
  });
  const root = await makeSite({ app: { 'app.md': '---\nname: A\nsummary: S\npackage: com.a\nrepo: me/app\n---\n' } });
  const out = join(root, '_site');
  const { apps, errors, warnings } = await build({ root, outDir: out, log: quiet });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  const [a] = apps;
  assert.equal(a.version, 'v1.2.3');
  assert.equal(a.apks.length, 1);
  assert.equal(a.apks[0].abi, null);
  assert.equal(a.apks[0].path, 'apks/app.apk');
  assert.equal(a.apks[0].size, apk.length);
  assert.equal(a.apks[0].sha256, createHash('sha256').update(apk).digest('hex'));
  assert.deepEqual(new Uint8Array(await readFile(join(out, 'apks/app.apk'))), apk);
  const catalog = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8'));
  assert.equal(catalog.apps[0].id, 'app');
});

test('a repo with no release yet is a warning, and the card shows as unavailable', async () => {
  mockFetch({});
  const root = await makeSite({ app: { 'app.md': '---\nname: A\nsummary: S\npackage: com.a\nrepo: me/none\n---\n' } });
  const { apps, errors, warnings } = await build({ root, outDir: join(root, '_site'), log: quiet });
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.deepEqual(apps[0].apks, []);
  assert.match(apps[0].unavailable, /No published release/);
});

test('a local app.apk is used without any network', async () => {
  globalThis.fetch = () => { throw new Error('no network expected'); };
  const root = await makeSite({ app: { 'app.md': '---\nname: A\nsummary: S\npackage: com.a\nversion: 2.0\n---\n', 'app.apk': 'bytes' } });
  const { apps } = await build({ root, outDir: join(root, '_site'), log: quiet });
  assert.equal(apps[0].version, '2.0');
  assert.equal(apps[0].apks[0].size, 5);
});

test('a broken app.md fails the build but the other apps still build', async () => {
  const root = await makeSite({
    bad: { 'app.md': '---\nname: Missing fields\n---\n' },
    good: { 'app.md': '---\nname: G\nsummary: S\npackage: com.g\n---\n', 'app.apk': 'x' },
  });
  const { apps, errors } = await build({ root, outDir: join(root, '_site'), log: quiet });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^bad: .*summary/);
  assert.deepEqual(apps.map((a) => a.id), ['good']);
});

test('apps sort by order, then name', async () => {
  const root = await makeSite({
    b: { 'app.md': '---\nname: B\nsummary: S\npackage: b\n---\n', 'app.apk': 'x' },
    a: { 'app.md': '---\nname: A\nsummary: S\npackage: a\n---\n', 'app.apk': 'x' },
    z: { 'app.md': '---\nname: Z\nsummary: S\npackage: z\norder: 1\n---\n', 'app.apk': 'x' },
  });
  const { apps } = await build({ root, outDir: join(root, '_site'), log: quiet });
  assert.deepEqual(apps.map((a) => a.id), ['z', 'a', 'b']);
});


test('abiOf reads the CPU type from a file name', () => {
  assert.equal(abiOf('app-arm64-v8a-release.apk'), 'arm64-v8a');
  assert.equal(abiOf('app-armeabi-v7a-release.apk'), 'armeabi-v7a');
  assert.equal(abiOf('app-x86_64-release.apk'), 'x86_64');
  assert.equal(abiOf('app-x86-release.apk'), 'x86');
  assert.equal(abiOf('app-universal-release.apk'), null);
  assert.equal(abiOf('TurboText_v1.0.4.apk'), null);
});

test('pickAssets keeps one APK per CPU type and skips universal and source archives', () => {
  const asset = (name) => ({ name, browser_download_url: `https://dl/${name}` });
  const picked = pickAssets([
    asset('app-arm64-v8a-release.apk'),
    asset('app-armeabi-v7a-release.apk'),
    asset('app-universal-release.apk'),
    asset('source.zip'),
  ]);
  assert.deepEqual(picked.map((p) => [p.abi, p.asset.name]), [
    ['arm64-v8a', 'app-arm64-v8a-release.apk'],
    ['armeabi-v7a', 'app-armeabi-v7a-release.apk'],
  ]);
  assert.deepEqual(pickAssets([asset('FlipWeather_v1.0-release.apk')]).map((p) => p.abi), [null]);
  assert.deepEqual(pickAssets([asset('app-universal-release.apk'), asset('app-arm64-v8a-release.apk')], 'universal')
    .map((p) => p.asset.name), ['app-universal-release.apk']);
});

test('a split release downloads each CPU type into its own file', async () => {
  const arm64 = new TextEncoder().encode('arm64 bytes');
  const v7a = new TextEncoder().encode('v7a');
  mockFetch({
    'https://api.github.com/repos/me/split/releases/latest': {
      tag_name: 'v0.1.8', html_url: 'https://github.com/me/split/releases/tag/v0.1.8', published_at: null,
      assets: [
        { name: 'app-arm64-v8a-release.apk', browser_download_url: 'https://dl/arm64.apk' },
        { name: 'app-armeabi-v7a-release.apk', browser_download_url: 'https://dl/v7a.apk' },
        { name: 'app-universal-release.apk', browser_download_url: 'https://dl/universal.apk' },
      ],
    },
    'https://dl/arm64.apk': arm64,
    'https://dl/v7a.apk': v7a,
  });
  const root = await makeSite({ chat: { 'app.md': '---\nname: C\nsummary: S\npackage: c\nrepo: me/split\n---\n' } });
  const out = join(root, '_site');
  const { apps, errors } = await build({ root, outDir: out, log: quiet });
  assert.deepEqual(errors, []);
  assert.deepEqual(apps[0].apks.map((a) => [a.abi, a.path, a.size]), [
    ['arm64-v8a', 'apks/chat-arm64-v8a.apk', arm64.length],
    ['armeabi-v7a', 'apks/chat-armeabi-v7a.apk', v7a.length],
  ]);
  assert.ok(!existsSync(join(out, 'apks/chat.apk')));
});

test('the page loads its code from a folder named after the code, so old copies never mix', async () => {
  assert.equal(
    rewriteCodePaths('<link href="css/style.css"><script src="js/ui.js"></script><img src="favicon.svg">', 'static/abc'),
    '<link href="static/abc/css/style.css"><script src="static/abc/js/ui.js"></script><img src="favicon.svg">',
  );
  const out = await mkdtemp(join(tmpdir(), 'turboadb-out-'));
  await build({ root: ROOT, outDir: out, offline: true, log: quiet });
  const html = await readFile(join(out, 'index.html'), 'utf8');
  const dir = html.match(/src="(static\/[0-9a-f]{10})\/js\/ui\.js"/)?.[1];
  assert.ok(dir, 'index.html points at static/<hash>/js/ui.js');
  assert.match(html, new RegExp(`href="${dir}/css/style\\.css"`));
  for (const f of ['js/ui.js', 'js/adb.js', 'js/install.js', 'js/commands.js', 'css/style.css']) {
    assert.ok(existsSync(join(out, dir, f)), `${f} is in ${dir}`);
  }
  assert.ok(!existsSync(join(out, 'js')), 'no unversioned js/ folder');
});
