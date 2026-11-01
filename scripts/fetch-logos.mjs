// Downloads each bank's own site icon into assets/logos/ (self-hosted, never hotlinked).
// Run: node scripts/fetch-logos.mjs   Only image bytes are saved; nothing is executed.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'assets', 'logos');
fs.mkdirSync(OUT, { recursive: true });

const SITES = {
  sbi: ['https://sbi.bank.in/', 'https://sbi.co.in/'],
  'hdfc-bank': ['https://www.hdfc.bank.in/', 'https://www.hdfcbank.com/'],
  'icici-bank': ['https://www.icici.bank.in/', 'https://www.icicibank.com/'],
  'axis-bank': ['https://www.axis.bank.in/', 'https://www.axisbank.com/'],
  'kotak-mahindra-bank': ['https://www.kotak.bank.in/', 'https://www.kotak.com/'],
  'bank-of-baroda': ['https://www.bankofbaroda.bank.in/', 'https://www.bankofbaroda.in/'],
  'punjab-national-bank': ['https://pnb.bank.in/', 'https://www.pnbindia.in/'],
  'canara-bank': ['https://canarabank.bank.in/', 'https://canarabank.com/'],
  'union-bank-of-india': ['https://www.unionbankofindia.co.in/', 'https://unionbank.bank.in/'],
  'idfc-first-bank': ['https://www.idfcfirst.bank.in/', 'https://www.idfcfirstbank.com/'],
  'bank-of-india': ['https://bankofindia.bank.in/', 'https://www.bankofindia.co.in/'],
  'yes-bank': ['https://www.yes.bank.in/', 'https://www.yesbank.in/'],
};

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; MathMyLoanLogoFetch/0.1)' };
const attr = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];

function candidates(html, base) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    if (!rel.includes('icon')) continue;
    const href = attr(tag, 'href');
    if (!href) continue;
    const size = parseInt((attr(tag, 'sizes') ?? '0').split('x')[0], 10) || 0;
    const score = (rel.includes('apple-touch') ? 1000 : 0) + size + (/\.svg(\?|$)/i.test(href) ? 500 : 0) + (/\.ico(\?|$)/i.test(href) ? -200 : 0);
    try {
      out.push({ url: new URL(href, base).href, score });
    } catch {}
  }
  out.push({ url: new URL('/favicon.ico', base).href, score: -500 });
  return out.sort((a, b) => b.score - a.score);
}

const EXT = { 'image/png': 'png', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

async function download(url) {
  const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) throw new Error(`not an image (${type})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 || buf.length > 150_000) throw new Error(`size ${buf.length}`);
  return { buf, ext };
}

// Fallback only: sharp Wikimedia logos (scripts/fetch-logos-wiki.mjs) are never replaced by favicons.
const MANIFEST = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
for (const [slug, bases] of Object.entries(SITES)) {
  if (/wiki(media|pedia)/.test(manifest[slug]?.source ?? '')) {
    console.log(`keep ${slug}: Wikimedia logo already present`);
    continue;
  }
  let done = false;
  for (const base of bases) {
    try {
      const res = await fetch(base, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = (await res.text()).slice(0, 400_000);
      for (const c of candidates(html, res.url).slice(0, 5)) {
        try {
          const { buf, ext } = await download(c.url);
          const file = `${slug}.${ext}`;
          fs.writeFileSync(path.join(OUT, file), buf);
          manifest[slug] = { file, source: c.url, fetchedOn: new Date().toISOString().slice(0, 10) };
          console.log(`ok   ${slug}: ${file} (${buf.length} bytes) from ${c.url}`);
          done = true;
          break;
        } catch (e) {
          console.log(`  skip ${slug} ${c.url}: ${e.message}`);
        }
      }
      if (done) break;
    } catch (e) {
      console.log(`  site ${slug} ${base}: ${e.message}`);
    }
  }
  if (!done) console.log(`FAIL ${slug}: no icon found`);
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n${Object.keys(manifest).length}/${Object.keys(SITES).length} logos saved`);
