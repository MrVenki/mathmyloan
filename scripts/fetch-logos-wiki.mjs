// Downloads sharp bank logos from Wikimedia (rendered as 256px-wide PNGs) into assets/logos/,
// replacing the low-resolution favicons where a logo is found. Self-hosted, never hotlinked.
// Run: node scripts/fetch-logos-wiki.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'assets', 'logos');
const MANIFEST = path.join(OUT, 'manifest.json');
const UA = { 'user-agent': 'MathMyLoanBot/0.1 (https://mrvenki.github.io/mathmyloan/; logo download)' };

// [wiki host, file title] for each bank; titles found via the Commons / Wikipedia file search.
const LOGOS = {
  sbi: ['commons.wikimedia.org', 'SBI-logo.svg'],
  'hdfc-bank': ['commons.wikimedia.org', 'HDFC Bank Logo.svg'],
  'icici-bank': ['commons.wikimedia.org', 'ICICI Bank Logo.svg'],
  'axis-bank': ['commons.wikimedia.org', 'Axis Bank logo.svg'],
  'kotak-mahindra-bank': ['en.wikipedia.org', 'Kotak Mahindra Bank logo.svg'],
  'bank-of-baroda': ['en.wikipedia.org', 'BankOfBarodaLogo.svg'],
  'punjab-national-bank': ['commons.wikimedia.org', 'Punjab National Bank new logo.svg'],
  'canara-bank': ['commons.wikimedia.org', 'Canara Bank Logo.svg'],
  'union-bank-of-india': ['commons.wikimedia.org', 'Union Bank of India Logo.svg'],
  'idfc-first-bank': ['commons.wikimedia.org', 'Logo of IDFC First Bank.svg'],
  'yes-bank': ['commons.wikimedia.org', 'Yes Bank SVG Logo.svg'],
  'federal-bank': ['commons.wikimedia.org', 'Federal-Bank-Logo SVG.svg'],
  'indian-bank': ['en.wikipedia.org', 'Indian Bank logo 2023.png'],
  'central-bank-of-india': ['en.wikipedia.org', 'Central Bank of India.svg'],
  'bank-of-maharashtra': ['commons.wikimedia.org', 'Bank of Maharashtra logo.svg'],
};

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};

for (const [slug, [host, title]] of Object.entries(LOGOS)) {
  try {
    const api = `https://${host}/w/api.php?action=query&titles=${encodeURIComponent(`File:${title}`)}&prop=imageinfo&iiprop=url|size&iiurlwidth=256&format=json`;
    const info = Object.values((await (await fetch(api, { headers: UA })).json()).query.pages)[0]?.imageinfo?.[0];
    if (!info?.thumburl) throw new Error('no image info');
    const res = await fetch(info.thumburl, { headers: UA });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/png')) throw new Error(`HTTP ${res.status} ${type}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 200_000) throw new Error(`too large (${buf.length})`);
    const file = `${slug}.png`;
    for (const old of fs.readdirSync(OUT).filter((f) => f.startsWith(`${slug}.`) && f !== file)) fs.rmSync(path.join(OUT, old));
    fs.writeFileSync(path.join(OUT, file), buf);
    manifest[slug] = {
      file,
      source: info.descriptionurl,
      width: info.thumbwidth,
      height: info.thumbheight,
      fetchedOn: new Date().toISOString().slice(0, 10),
      note: 'Bank trademark, shown only to identify the bank.',
    };
    console.log(`ok   ${slug}: ${info.thumbwidth}x${info.thumbheight} (${buf.length} bytes)`);
  } catch (e) {
    console.log(`keep ${slug}: ${e.message} (existing icon left in place)`);
  }
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
