/**
 * Captures Play Store phone screenshots (390x844 @3x = 1170x2532) from a running
 * DarJam server. Requires Chrome/Chromium and the app already running.
 *
 *   npm start                       # in another terminal
 *   node scripts/capture-store-screenshots.mjs --seed
 *
 * Options:
 *   --url <base>     default http://localhost:3100
 *   --out <dir>      default docs/store/screenshots
 *   --seed           post three demo reports first (so the Reports tab is populated)
 *   --chrome <path>  or set CHROME_PATH
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const base = (arg('url', 'http://localhost:3100')).replace(/\/$/, '');
const outDir = path.resolve(ROOT, arg('out', 'docs/store/screenshots'));
const chrome =
  arg('chrome', process.env.CHROME_PATH) ||
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
// Optional: freeze the browser clock (ISO string) so screenshots match a
// server started with DARJAM_NOW.
const fakeDate = arg('fake-date', '');

const jobs = [
  ['01-live', '#/live'],
  ['02-roads', '#/roads'],
  ['03-forecast', '#/forecast'],
  ['04-reports', '#/reports'],
  ['05-road-detail', '#/road/nyerere-road'],
];

if (process.argv.includes('--seed')) {
  const demo = [
    { type: 'jam', severity: 3, corridorId: 'morogoro-road', note: 'Heavy near Ubungo, moving slowly' },
    { type: 'police', severity: 2, corridorId: 'nyerere-road', note: 'Check near the airport junction' },
    { type: 'accident', severity: 3, corridorId: 'ali-hassan-mwinyi', note: 'Two cars, right lane blocked' },
  ];
  for (const report of demo) {
    const res = await fetch(`${base}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    if (!res.ok) console.warn('seed failed', res.status, await res.text());
  }
  console.log('seeded demo reports');
}

await mkdir(outDir, { recursive: true });

const port = 9833;
const profile = await mkdtemp(path.join(tmpdir(), 'darjam-shots-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const child = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--no-first-run', '--disable-extensions', '--hide-scrollbars',
  '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });

let target;
for (let i = 0; i < 80; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) break;
  } catch {
    /* Chrome is still starting. */
  }
  await sleep(250);
}
if (!target) throw new Error('Chrome debugger did not start');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
  setTimeout(() => reject(new Error('WebSocket timeout')), 8000);
});

let id = 0;
const pending = new Map();
const events = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  } else if (message.method) {
    (events.get(message.method) || []).forEach((fn) => fn(message.params));
  }
};
const send = (method, params = {}, timeout = 25000) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(mid);
      reject(new Error(`timeout ${method}`));
    }, timeout);
    pending.set(mid, { resolve, reject, timer });
  });
};
const once = (method, timeout = 25000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`event timeout ${method}`)), timeout);
    const fn = (params) => {
      clearTimeout(timer);
      events.set(method, (events.get(method) || []).filter((entry) => entry !== fn));
      resolve(params);
    };
    events.set(method, [...(events.get(method) || []), fn]);
  });

try {
  await send('Page.enable');
  if (fakeDate) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const base = new Date(${JSON.stringify(fakeDate)}).getTime();
        const realBase = Date.now();
        const RealDate = Date;
        class FakeDate extends RealDate {
          constructor(...args) {
            if (args.length) super(...args);
            else super(base + (RealDate.now() - realBase));
          }
          static now() { return base + (RealDate.now() - realBase); }
        }
        window.Date = FakeDate;
      })();`,
    });
  }
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844,
  });

  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: `${base}/#/live` });
  await loaded;
  await sleep(5000);

  for (const [name, route] of jobs) {
    await send('Runtime.evaluate', { expression: `location.hash = ${JSON.stringify(route)}` });
    await sleep(3200);
    const shot = await send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    });
    const file = path.join(outDir, `${name}.png`);
    await writeFile(file, Buffer.from(shot.data, 'base64'));
    console.log('saved', file);
  }
} finally {
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  setTimeout(() => process.exit(0), 300);
}
