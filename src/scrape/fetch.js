// Gets the readable text of a bank page: plain HTTP first, headless Chrome when the page only
// shows its rates after its own scripts run, and PDF text for rate sheets published as PDFs.
// The scraper says who it is and respects refusals: a page that denies automated access or
// asks for a bot check is reported as unreadable, so that rate is checked by hand.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const UA = 'Mozilla/5.0 (compatible; MathMyLoanBot/1.0; +https://mathmyloan.com/about/)';
const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '-', mdash: '-', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', percnt: '%', hellip: '…', rupee: '₹' };

export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Each table row becomes one line, cells joined by " | ", whatever markup the cells hold.
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => `\n${row.split(/<\/t[dh]>/i).map((c) => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ')}\n`)
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d|section|article|table|ul|ol|dt|dd|header|footer|caption)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t\r]+/g, ' ')
    .replace(/\n\s*/g, '\n');
}

const pctCount = (t) => (t.match(/\d\s*%/g) ?? []).length;
const refused = (html) => /bobcmn|Request Rejected|Access Denied|captcha|cf-chl|Just a moment|think that you are a bot/i.test(html.slice(0, 4000));
const REFUSED = "the bank's site refused automated access; check this page by hand";
// Text from the browser, unless the site answered with a refusal or a bot check.
const checked = (text) => {
  if (refused(text)) throw new Error(REFUSED);
  return text;
};

// PDF text, one line per row of text on the page, wide gaps shown as cell breaks.
export async function pdfToText(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    const rows = new Map();
    for (const it of items) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], w: it.width, s: it.str });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const cells = rows.get(y).sort((a, b) => a.x - b.x);
      let line = '';
      let end = null;
      for (const c of cells) {
        if (end != null) line += c.x - end > 12 ? ' | ' : c.x - end > 1 ? ' ' : '';
        line += c.s;
        end = c.x + c.w;
      }
      out.push(line);
    }
    out.push('');
  }
  await task.destroy();
  return out.join('\n');
}

// ---------- headless Chrome over the DevTools protocol (no extra packages) ----------

const CHROMES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

let browser = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startBrowser() {
  const exe = CHROMES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('Chrome not found (set CHROME_PATH)');
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mml-scrape-'));
  const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      return { proc, port, profile, ws: v.webSocketDebuggerUrl };
    } catch {}
  }
  proc.kill();
  throw new Error('Chrome did not start');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const ready = new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  // Every call gives up after 30 seconds so one stuck page cannot stall the run.
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      const timer = setTimeout(() => {
        pending.delete(i);
        reject(new Error(`Chrome ${method} timed out`));
      }, 30000);
      pending.set(i, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { ready, send, close: () => ws.close() };
}

// Pages are read in parallel, so they share one browser started on first use.
function getBrowser() {
  browser ??= startBrowser().then(async (b) => {
    const c = cdp(b.ws);
    await c.ready;
    return { ...b, c };
  });
  return browser;
}

export async function renderText(url, opts) {
  return (await renderPage(url, opts)).text;
}

// Page text after scripts have run, plus the page's links (used to discover rate pages).
export async function renderPage(url, { waitMs = 25000, minPct = 3 } = {}) {
  const { c } = await getBrowser();
  const { result } = await c.send('Target.createTarget', { url: 'about:blank' });
  const targetId = result.targetId;
  const { result: att } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  const s = att.sessionId;
  try {
    await c.send('Page.enable', {}, s);
    await c.send('Page.navigate', { url }, s);
    const until = Date.now() + waitMs;
    let text = '';
    // Waits for rates to appear on pages that load them by script.
    while (Date.now() < until) {
      await sleep(1500);
      const r = await c.send('Runtime.evaluate', { expression: 'document.body ? document.body.innerText : ""', returnByValue: true }, s);
      text = r.result?.result?.value ?? '';
      if (pctCount(text) >= minPct) {
        await sleep(1500);
        const again = await c.send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true }, s);
        text = again.result?.result?.value ?? text;
        break;
      }
    }
    const l = await c.send('Runtime.evaluate', { expression: 'Array.from(document.links).map((a) => [a.href, (a.innerText || a.title || "").trim().slice(0, 120)])', returnByValue: true }, s);
    return { text: text.replace(/\t/g, ' | '), links: l.result?.result?.value ?? [] };
  } finally {
    await c.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

export async function closeBrowser() {
  if (!browser) return;
  const b = await browser.catch(() => null);
  browser = null;
  if (!b) return;
  b.c.close();
  b.proc.kill();
  await sleep(500);
  try {
    fs.rmSync(b.profile, { recursive: true, force: true });
  } catch {}
}

// Text of a source page, and how it was read.
export async function pageText(url, { render = false } = {}) {
  if (render) return { text: checked(await renderText(url)), via: 'chrome' };
  let res;
  try {
    res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8', 'accept-language': 'en-IN,en;q=0.9' }, signal: AbortSignal.timeout(45000), redirect: 'follow' });
  } catch (err) {
    throw new Error(`could not load the page (${err.message})`);
  }
  const type = res.headers.get('content-type') ?? '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.ok && (/pdf/i.test(type) || buf.subarray(0, 5).toString() === '%PDF-')) return { text: await pdfToText(buf), via: 'pdf' };
  const html = buf.toString('utf8');
  if (!res.ok || refused(html)) throw new Error(`${REFUSED} (HTTP ${res.status})`);
  const text = htmlToText(html);
  if (pctCount(text) < 3) {
    const rendered = checked(await renderText(url));
    if (pctCount(rendered) >= pctCount(text)) return { text: rendered, via: 'chrome' };
  }
  return { text, via: 'http' };
}
