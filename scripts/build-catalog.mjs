#!/usr/bin/env node
// Builds the site into _site/: copies the page, reads every apps/<id>/ folder,
// downloads each app's APK (latest GitHub release, a direct link, or a local
// app.apk) and writes catalog.json, which is all the page reads.
//
//   node scripts/build-catalog.mjs            # full build
//   node scripts/build-catalog.mjs --offline  # skip downloads (for quick previews and tests)
//
// Set GITHUB_TOKEN to avoid GitHub's 60-requests-an-hour limit (CI does).
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { parseCommands } from '../js/commands.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The page's code goes in a folder named after its contents (static/<hash>/),
// so a browser holding an old copy can never mix it with a new catalog.json.
const CODE_DIRS = ['css', 'js'];
const ICON_NAMES = ['icon.svg', 'icon.png', 'icon.webp', 'icon.jpg'];
// Files in an app folder that aren't copied to the site as-is.
const PRIVATE_FILES = new Set(['app.md', 'commands.txt', 'app.apk']);

/** Splits `---` front matter (simple `key: value` lines) from the Markdown body. */
export function parseAppMd(text) {
  const match = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error('app.md must start with a --- block (see apps/_example/app.md)');
  const fields = {};
  for (const raw of match[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) throw new Error(`app.md: can't read the line "${raw.trim()}" (expected "key: value")`);
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { fields, body: match[2] };
}

/** Points relative src/href attributes in rendered Markdown at the app's folder on the site. */
export function rebaseLinks(html, base) {
  return html.replace(/\b(src|href)="(?![a-z][a-z0-9+.-]*:|\/|#)([^"]+)"/gi, `$1="${base}$2"`);
}

async function githubJson(url) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'turboadb-installer-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'turboadb-installer-build' } });
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, bytes);
  return bytes;
}

// CPU types an APK can be built for, longest names first so "x86" doesn't match "x86_64".
const ABIS = ['arm64-v8a', 'armeabi-v7a', 'armeabi', 'x86_64', 'x86'];

/** The CPU type an APK's file name says it's for, or null for a single all-CPU APK. */
export function abiOf(fileName) {
  return ABIS.find((abi) => new RegExp(`(^|[^a-z0-9])${abi}($|[^a-z0-9_])`, 'i').test(fileName)) ?? null;
}

/**
 * Picks which release files to ship: one APK per CPU type when the release is
 * split that way (skipping the huge "universal" one), otherwise a single APK.
 */
export function pickAssets(assets, wantedName) {
  const apks = assets.filter((a) => /\.apk$/i.test(a.name));
  const candidates = wantedName
    ? apks.filter((a) => a.name.includes(wantedName))
    : apks.filter((a) => !/debug/i.test(a.name));
  const perAbi = new Map();
  for (const a of candidates) {
    const abi = abiOf(a.name);
    if (abi && !perAbi.has(abi)) perAbi.set(abi, a);
  }
  if (perAbi.size) return [...perAbi].map(([abi, asset]) => ({ abi, asset }));
  const single = candidates[0] ?? (wantedName ? null : apks[0]);
  return single ? [{ abi: null, asset: single }] : [];
}

/**
 * Finds and fetches the APK(s) for one app into apks/.
 * Returns { version, source, published, files: [{ abi, name, bytes }] } or { error }.
 */
async function resolveApks(id, dir, fields, apksDir, offline) {
  const local = join(dir, 'app.apk');
  if (existsSync(local)) {
    const bytes = await readFile(local);
    await writeFile(join(apksDir, `${id}.apk`), bytes);
    return { version: fields.version || '', files: [{ abi: null, name: `${id}.apk`, bytes }] };
  }
  if (offline) return { offline: true, version: fields.version || '', files: [] };

  if (fields.repo) {
    const release = await githubJson(`https://api.github.com/repos/${fields.repo}/releases/latest`);
    if (!release) return { error: `No published release in ${fields.repo} yet.`, files: [] };
    const picked = pickAssets(release.assets, fields.asset);
    if (!picked.length) {
      return { error: `Release ${release.tag_name} of ${fields.repo} has no matching .apk file attached.`, files: [] };
    }
    const files = [];
    for (const { abi, asset } of picked) {
      const name = abi ? `${id}-${abi}.apk` : `${id}.apk`;
      files.push({ abi, name, bytes: await download(asset.browser_download_url, join(apksDir, name)) });
    }
    return {
      version: fields.version || release.tag_name,
      source: release.html_url,
      published: release.published_at,
      files,
    };
  }
  if (fields.apk) {
    const name = `${id}.apk`;
    const bytes = await download(fields.apk, join(apksDir, name));
    return { version: fields.version || '', source: fields.apk, files: [{ abi: null, name, bytes }] };
  }
  return { error: 'app.md needs a "repo:" or "apk:" line, or an app.apk file in the folder.', files: [] };
}

async function buildApp(id, dir, outDir, offline) {
  const { fields, body } = parseAppMd(await readFile(join(dir, 'app.md'), 'utf8'));
  for (const key of ['name', 'summary', 'package']) {
    if (!fields[key]) throw new Error(`app.md is missing "${key}:"`);
  }

  const appOut = join(outDir, 'apps', id);
  await mkdir(appOut, { recursive: true });
  for (const name of await readdir(dir)) {
    if (!PRIVATE_FILES.has(name)) await cp(join(dir, name), join(appOut, name), { recursive: true });
  }
  const icon = ICON_NAMES.find((n) => existsSync(join(dir, n)));

  const commandsFile = join(dir, 'commands.txt');
  const commands = existsSync(commandsFile)
    ? parseCommands(await readFile(commandsFile, 'utf8'), { package: fields.package })
    : [];

  const apk = await resolveApks(id, dir, fields, join(outDir, 'apks'), offline);

  return {
    id,
    name: fields.name,
    summary: fields.summary,
    package: fields.package,
    order: Number(fields.order ?? 1000),
    icon: icon ? `apps/${id}/${icon}` : null,
    details: rebaseLinks(marked.parse(body), `apps/${id}/`),
    commands,
    version: apk.version || null,
    source: apk.source || (fields.repo ? `https://github.com/${fields.repo}` : null),
    published: apk.published || null,
    // One entry, or one per CPU type (abi) for split releases.
    apks: apk.files.map(({ abi, name, bytes }) => ({
      abi,
      path: `apks/${name}`,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })),
    unavailable: apk.error || (apk.offline ? 'Built offline: no APK downloaded.' : null),
  };
}

/** Points index.html's css/ and js/ links at the versioned code folder. */
export function rewriteCodePaths(html, codeDir) {
  return html.replace(/\b(href|src)="(css|js)\//g, `$1="${codeDir}/$2/`);
}

/** Copies css/ and js/ into static/<content hash>/ and returns that folder's path. */
async function copyCode(root, outDir) {
  const hash = createHash('sha256');
  const files = [];
  const dirs = CODE_DIRS.filter((dir) => existsSync(join(root, dir)));
  for (const dir of dirs) {
    for (const name of (await readdir(join(root, dir))).sort()) files.push(join(dir, name));
  }
  for (const file of files) hash.update(file).update(await readFile(join(root, file)));
  const codeDir = `static/${hash.digest('hex').slice(0, 10)}`;
  for (const dir of dirs) await cp(join(root, dir), join(outDir, codeDir, dir), { recursive: true });
  return codeDir;
}

export async function build({ root = ROOT, outDir = join(ROOT, '_site'), offline = false, log = console } = {}) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'apks'), { recursive: true });
  const codeDir = await copyCode(root, outDir);
  const index = await readFile(join(root, 'index.html'), 'utf8');
  await writeFile(join(outDir, 'index.html'), rewriteCodePaths(index, codeDir));
  if (existsSync(join(root, 'favicon.svg'))) await cp(join(root, 'favicon.svg'), join(outDir, 'favicon.svg'));

  const appsDir = join(root, 'apps');
  const apps = [];
  const warnings = []; // shown in CI, site still publishes (e.g. no release yet)
  const errors = [];   // fail the build, so the last good site stays live
  for (const id of (await readdir(appsDir)).sort()) {
    const dir = join(appsDir, id);
    if (id.startsWith('_') || id.startsWith('.') || !(await stat(dir)).isDirectory()) continue;
    try {
      const app = await buildApp(id, dir, outDir, offline);
      if (app.unavailable && !offline) warnings.push(`${id}: ${app.unavailable}`);
      apps.push(app);
      log.log(`✓ ${id}${app.version ? ` ${app.version}` : ''}${app.unavailable ? ` (${app.unavailable})` : ''}`);
    } catch (e) {
      errors.push(`${id}: ${e.message}`);
      log.error(`✗ ${id}: ${e.message}`);
    }
  }
  apps.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  await writeFile(
    join(outDir, 'catalog.json'),
    JSON.stringify({ built: new Date().toISOString(), code: codeDir, apps }, null, 2),
  );
  return { apps, warnings, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const offline = process.argv.includes('--offline');
  const { apps, warnings, errors } = await build({ offline });
  for (const w of warnings) console.log(`::warning::${w}`);
  for (const e of errors) console.log(`::error::${e}`);
  console.log(`Built ${apps.length} app(s) into _site/`);
  if (errors.length) process.exit(1);
}

