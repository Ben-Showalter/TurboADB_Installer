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
const SITE_FILES = ['index.html', 'css', 'js', 'favicon.svg'];
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

/** Finds and fetches the APK for one app. Returns { version, source, bytes } or { error }. */
async function resolveApk(id, dir, fields, apkDest, offline) {
  const local = join(dir, 'app.apk');
  if (existsSync(local)) {
    const bytes = await readFile(local);
    await writeFile(apkDest, bytes);
    return { version: fields.version || '', bytes };
  }
  if (offline) return { offline: true, version: fields.version || '' };

  if (fields.repo) {
    const release = await githubJson(`https://api.github.com/repos/${fields.repo}/releases/latest`);
    if (!release) return { error: `No published release in ${fields.repo} yet.` };
    const apks = release.assets.filter((a) => /\.apk$/i.test(a.name));
    const wanted = fields.asset
      ? apks.filter((a) => a.name.includes(fields.asset))
      : apks.filter((a) => !/debug/i.test(a.name));
    const asset = wanted[0] ?? apks[0];
    if (!asset) return { error: `Release ${release.tag_name} of ${fields.repo} has no .apk file attached.` };
    const bytes = await download(asset.browser_download_url, apkDest);
    return {
      version: fields.version || release.tag_name,
      source: release.html_url,
      published: release.published_at,
      bytes,
    };
  }
  if (fields.apk) {
    const bytes = await download(fields.apk, apkDest);
    return { version: fields.version || '', source: fields.apk, bytes };
  }
  return { error: 'app.md needs a "repo:" or "apk:" line, or an app.apk file in the folder.' };
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

  const apkName = `${id}.apk`;
  const apk = await resolveApk(id, dir, fields, join(outDir, 'apks', apkName), offline);

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
    apk: apk.bytes ? {
      path: `apks/${apkName}`,
      size: apk.bytes.length,
      sha256: createHash('sha256').update(apk.bytes).digest('hex'),
    } : null,
    unavailable: apk.error || (apk.offline ? 'Built offline: no APK downloaded.' : null),
  };
}

export async function build({ root = ROOT, outDir = join(ROOT, '_site'), offline = false, log = console } = {}) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'apks'), { recursive: true });
  for (const name of SITE_FILES) {
    if (existsSync(join(root, name))) await cp(join(root, name), join(outDir, name), { recursive: true });
  }

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
    JSON.stringify({ built: new Date().toISOString(), apps }, null, 2),
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

