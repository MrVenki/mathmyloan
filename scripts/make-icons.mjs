// Renders the site icons from assets/brand/*.svg with headless Chrome, so they match the on-page logo.
// Run: node scripts/make-icons.mjs && node scripts/make-ico.mjs
// Small sizes use favicon.svg (the same ₹ with thicker lines so it stays clear); larger ones use logo.svg.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '..', 'assets', 'brand');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const small = fs.readFileSync(path.join(DIR, 'favicon.svg'), 'utf8');
const full = fs.readFileSync(path.join(DIR, 'logo.svg'), 'utf8');
// iOS rounds home-screen icons itself and shows transparency as black, so that one is a full, square tile.
const square = full.replace('rx="11"', 'rx="0"');
const icons = [
  ['icon-32.png', 32, small],
  ['icon-48.png', 48, small],
  ['apple-touch-icon.png', 180, square],
  ['icon-192.png', 192, full],
  ['icon-512.png', 512, full],
];

const port = 9500 + Math.floor(Math.random() * 400);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
for (const [name, size, svg] of icons) {
  await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;
  await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
  fs.writeFileSync(path.join(DIR, name), Buffer.from(shot.result.data, 'base64'));
  console.log(`wrote ${name}`);
}
ws.close();
chrome.kill();
