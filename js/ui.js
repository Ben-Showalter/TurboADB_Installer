// The page: app cards, the Read more dialog and the connect bar.
import { installApp } from './install.js';

const $ = (id) => document.getElementById(id);
const els = {
  unsupported: $('unsupported'),
  dot: $('status-dot'),
  title: $('status-title'),
  detail: $('status-detail'),
  connect: $('connect-btn'),
  list: $('app-list'),
  dialog: $('details-dialog'),
};

let Phone = null; // the adb.js class, loaded on demand
let phone = null;
let busy = false;
const cards = new Map(); // app id -> { app, el, installed }

// --- connect bar -----------------------------------------------------------

function setStatus(state, title, detail = '') {
  els.dot.className = `dot dot-${state}`;
  els.title.textContent = title;
  els.detail.textContent = detail;
}

function showConnected() {
  const { manufacturer, model, release } = phone.info;
  const name = [manufacturer, model].filter(Boolean).join(' ');
  setStatus('ok', `Connected: ${name || 'Android phone'}`, `Android ${release}`);
  els.connect.textContent = 'Disconnect';
  els.connect.className = 'btn btn-ghost';
}

function showDisconnected(detail = 'Plug the phone in and click Connect phone.') {
  setStatus('off', 'No phone connected', detail);
  els.connect.textContent = 'Connect phone';
  els.connect.className = 'btn btn-primary';
  for (const card of cards.values()) {
    card.installed = undefined;
    renderCard(card);
  }
}

async function loadAdb() {
  if (Phone) return Phone;
  try {
    ({ Phone } = await import('./adb.js'));
  } catch (e) {
    console.error(e);
    throw new Error('Couldn’t load the USB library. Check your internet connection and reload the page.');
  }
  return Phone;
}

/** Connects to the phone; on failure shows why in the status line and throws. */
async function connect() {
  els.connect.disabled = true;
  setStatus('wait', 'Connecting…');
  try {
    const PhoneClass = await loadAdb();
    if (!PhoneClass.isSupported()) throw new Error('This browser can’t connect to phones. Use Chrome or Edge.');
    phone = new PhoneClass();
    phone.onDisconnect = () => {
      phone = null;
      showDisconnected('The phone was unplugged or the connection dropped.');
    };
    await phone.connect((text) => setStatus('wait', 'Connecting…', text));
  } catch (e) {
    phone = null;
    showDisconnected();
    setStatus('error', 'Couldn’t connect', e.message);
    throw e;
  } finally {
    els.connect.disabled = false;
  }
  showConnected();
  await refreshInstalled();
}

async function disconnect() {
  const p = phone;
  phone = null;
  await p?.disconnect();
  showDisconnected();
}

async function refreshInstalled() {
  for (const card of cards.values()) {
    try {
      card.installed = await phone.installedVersion(card.app.package);
    } catch {
      card.installed = undefined;
    }
    renderCard(card);
  }
}

els.connect.addEventListener('click', async () => {
  if (busy) return;
  if (phone?.connected) return disconnect();
  try { await connect(); } catch { /* status line already shows the error */ }
});

// --- app cards ---------------------------------------------------------------

function formatSize(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

/** "5.8 MB", or "50–75 MB" when there's one APK per CPU type. */
function sizeLabel(apks) {
  const sizes = apks.map((a) => a.size);
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  const [low, high] = [formatSize(min), formatSize(max)];
  if (low === high) return low;
  const [lowNum, lowUnit] = low.split(' ');
  return lowUnit === high.split(' ')[1] ? `${lowNum}–${high}` : `${low}–${high}`;
}

function sameVersion(installed, latest) {
  const clean = (v) => String(v ?? '').toLowerCase().replace(/^[^\d]*/, '');
  return Boolean(installed) && clean(latest).includes(clean(installed));
}

function renderCard(card) {
  const { app, el, installed } = card;
  const button = el.querySelector('.install-btn');
  const version = el.querySelector('.app-version');
  const parts = [];
  if (app.version) parts.push(`Latest: ${app.version}`);
  if (app.apks.length) parts.push(sizeLabel(app.apks));
  if (installed === '' || installed) parts.push(`On phone: ${installed || 'installed'}`);
  version.textContent = parts.join(' · ');

  if (!app.apks.length) {
    button.textContent = 'Unavailable';
    button.disabled = true;
    button.title = app.unavailable || '';
    return;
  }
  button.disabled = busy;
  button.title = '';
  if (installed === null || installed === undefined) button.textContent = 'Install';
  else button.textContent = sameVersion(installed, app.version) ? 'Reinstall' : 'Update';
}

function setAllBusy(value) {
  busy = value;
  els.connect.disabled = value;
  for (const card of cards.values()) renderCard(card);
}

function logResult(list, result) {
  const li = document.createElement('li');
  const kind = !result.ok ? 'bad' : result.warning ? 'warn' : result.skipped ? 'skip' : 'good';
  const mark = { bad: '✗', warn: '⚠', skip: '–', good: '✓' }[kind];
  li.className = kind;
  const head = document.createElement('div');
  head.innerHTML = `<span class="mark">${mark}</span> <code></code>`;
  head.querySelector('code').textContent = result.line;
  li.append(head);
  for (const text of [result.error, result.warning, result.note]) {
    if (!text) continue;
    const p = document.createElement('div');
    p.className = 'log-note';
    p.textContent = text;
    li.append(p);
  }
  const shown = result.steps.filter((s) => s.output || s.command !== result.line);
  if (shown.length) {
    const pre = document.createElement('pre');
    pre.textContent = shown.map((s) => `$ ${s.command}${s.output ? `\n${s.output}` : ''}`).join('\n');
    li.append(pre);
  }
  list.append(li);
}

async function install(card) {
  if (busy) return;
  if (!phone?.connected) {
    try { await connect(); } catch { return; }
  }
  const { app, el } = card;
  const progress = el.querySelector('.app-progress');
  const text = progress.querySelector('.progress-text');
  const bar = progress.querySelector('.progress-bar > div');
  const log = progress.querySelector('.app-log');
  const list = log.querySelector('ul');
  list.replaceChildren();
  log.open = false;
  progress.hidden = false;
  progress.className = 'app-progress';
  setAllBusy(true);

  try {
    const results = await installApp(app, phone, {
      report: ({ progress: p, text: t }) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        text.textContent = t;
      },
      onCommand: (r) => logResult(list, r),
    });
    bar.style.width = '100%';
    const failed = results.filter((r) => !r.ok);
    const warned = results.filter((r) => r.ok && r.warning);
    if (failed.length) {
      progress.classList.add('is-warn');
      text.textContent = `Installed, but ${failed.length} setup step${failed.length > 1 ? 's' : ''} failed. See details.`;
      log.open = true;
    } else if (warned.length) {
      progress.classList.add('is-warn');
      text.textContent = `Installed. ${warned[0].warning}`;
    } else {
      progress.classList.add('is-ok');
      text.textContent = 'Done. Installed and set up.';
    }
  } catch (e) {
    progress.classList.add('is-error');
    text.textContent = `Install failed: ${e.message}`;
  } finally {
    setAllBusy(false);
    if (phone?.connected) {
      try { card.installed = await phone.installedVersion(app.package); } catch {}
      renderCard(card);
    }
  }
}

function openDetails(app) {
  const icon = $('details-icon');
  icon.src = app.icon || 'favicon.svg';
  $('details-title').textContent = app.name;
  const meta = [];
  if (app.version) meta.push(`Version ${app.version}`);
  meta.push(app.package);
  $('details-meta').textContent = meta.join(' · ');
  $('details-body').innerHTML = app.details;
  const commands = $('details-commands');
  commands.hidden = !app.commands.length;
  commands.open = false;
  $('details-commands-list').textContent = app.commands.join('\n');
  if (app.source?.startsWith('https://')) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.innerHTML = 'Downloads from <a target="_blank" rel="noopener"></a>';
    const a = p.querySelector('a');
    a.href = app.source;
    a.textContent = app.source.replace(/^https:\/\//, '');
    $('details-body').append(p);
  }
  els.dialog.showModal();
}

// Clicking the dimmed backdrop closes the dialog.
els.dialog.addEventListener('click', (e) => {
  if (e.target === els.dialog) els.dialog.close();
});

async function loadCatalog() {
  let catalog;
  try {
    const res = await fetch('catalog.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    catalog = await res.json();
  } catch {
    els.list.innerHTML = '<p class="muted">Couldn’t load the app list. Reload the page to try again.</p>';
    return;
  }
  // A cached old copy of this page is running against a newer build: reload once.
  if (catalog.code && !import.meta.url.includes(`/${catalog.code}/`)) {
    let tried = null;
    try { tried = sessionStorage.getItem('turboadb-reload'); } catch {}
    if (tried !== catalog.code) {
      try { sessionStorage.setItem('turboadb-reload', catalog.code); } catch {}
      location.replace(`${location.pathname}?v=${encodeURIComponent(catalog.code.split('/').pop())}`);
      return;
    }
  }
  const template = $('app-card');
  els.list.replaceChildren();
  if (!catalog.apps.length) {
    els.list.innerHTML = '<p class="muted">No apps yet.</p>';
    return;
  }
  for (const app of catalog.apps) {
    const el = template.content.firstElementChild.cloneNode(true);
    el.querySelector('.app-icon').src = app.icon || 'favicon.svg';
    el.querySelector('.app-name').textContent = app.name;
    el.querySelector('.app-summary').textContent = app.summary;
    const card = { app, el, installed: undefined };
    el.querySelector('.install-btn').addEventListener('click', () => install(card));
    el.querySelector('.more-btn').addEventListener('click', () => openDetails(app));
    cards.set(app.id, card);
    renderCard(card);
    els.list.append(el);
  }
}

if (!navigator.usb) {
  els.unsupported.hidden = false;
  els.connect.disabled = true;
  setStatus('error', 'This browser can’t connect to phones', 'Use Chrome or Edge on a computer.');
}
loadCatalog();
