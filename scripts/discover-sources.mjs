// Finds a bank's official loan-rate pages, starting from its homepage, without AI:
// homepage links about rates -> those pages (and the rate sheets they link to) -> which loans each lists.
//   node scripts/discover-sources.mjs <bank-slug> <homepage-url> [--add]
//   node scripts/discover-sources.mjs --file banks-to-find.json [--add]   ([{ "slug", "home" }, ...])
// --add appends the best pages to data/sources.json as "all loans on the page" sources.
import fs from 'node:fs';
import path from 'node:path';
import { pageText, renderPage, closeBrowser } from '../src/scrape/fetch.js';
import { findRate, LOAN_RULES } from '../src/scrape/extract.js';
import { ROOT, readJson } from '../src/data.js';

const RATE_LINK = /interest[\s_-]*rates?|rates?[\s_-]*of[\s_-]*interest|\broi\b|lending[\s_-]*rates?|retail[\s_-]*(loan|advance|lending|credit)|loan[\s_-]*rates?|rllr|eblr|rblr|repo[\s_-]*linked|service[\s_-]*charges/i;
const SKIP = /deposit|\bfd\b|fixed-deposit|savings|forex|remittance|career|recruit|blog|news|press|tender|auction|annual-report|csr|investor|locker|card/i;

const root = (host) => host.replace(/^www\./, '').split('.').slice(/\.(bank|co|org|net)\.in$/.test(host) ? -3 : -2).join('.');
const sameSite = (a, b) => {
  try {
    return root(new URL(a).hostname) === root(new URL(b).hostname);
  } catch {
    return false;
  }
};

async function linksOf(url) {
  try {
    return (await renderPage(url, { waitMs: 9000, minPct: 0 })).links;
  } catch {
    return [];
  }
}

function pick(links, base) {
  const seen = new Set();
  return links
    .map(([href, text]) => ({ href: href.split('#')[0], text }))
    .filter((l) => /^https:/.test(l.href) && sameSite(l.href, base) && (RATE_LINK.test(l.text) || RATE_LINK.test(l.href)) && !SKIP.test(l.href + ' ' + l.text))
    .filter((l) => !seen.has(l.href) && seen.add(l.href));
}

const loansIn = (text) => Object.keys(LOAN_RULES).map((l) => [l, findRate(text, l)]).filter(([, r]) => r).map(([l, r]) => ({ loan: l, rate: r.value }));

export async function discover(slug, home) {
  const first = pick(await linksOf(home), home).slice(0, 15);
  const pages = [];
  const tried = new Set();
  const visit = async (href, text, depth) => {
    if (tried.has(href) || tried.size >= 30) return;
    tried.add(href);
    try {
      const p = await pageText(href);
      const loans = loansIn(p.text);
      pages.push({ url: href, label: text, via: p.via, loans });
      // A hub page that links on to the actual rate sheets (often PDFs): follow those too.
      if (depth === 0 && loans.length < 3 && p.via !== 'pdf') {
        for (const l of pick(await linksOf(href), home).slice(0, 10)) await visit(l.href, l.text, 1);
      }
    } catch (err) {
      pages.push({ url: href, label: text, error: err.message, loans: [] });
    }
  };
  for (const l of first) await visit(l.href, l.text, 0);
  // Fewest pages that together list the most loan types.
  const chosen = [];
  const covered = new Set();
  for (;;) {
    const best = pages.map((p) => ({ p, gain: p.loans.filter((x) => !covered.has(x.loan)).length })).sort((a, b) => b.gain - a.gain)[0];
    if (!best || best.gain === 0) break;
    chosen.push(best.p);
    best.p.loans.forEach((x) => covered.add(x.loan));
  }
  return { slug, home, pages, chosen };
}

async function main() {
  const argv = process.argv.slice(2);
  const list = argv[0] === '--file' ? JSON.parse(fs.readFileSync(argv[1], 'utf8')) : [{ slug: argv[0], home: argv[1] }];
  const sources = readJson('data/sources.json');
  const added = [];
  for (const b of list) {
    const r = await discover(b.slug, b.home);
    console.log(`\n## ${b.slug} (${r.pages.length} pages checked)`);
    for (const p of r.chosen) {
      console.log(`  ${p.url}\n    ${p.loans.map((x) => `${x.loan} ${x.rate}%`).join(', ')}`);
      if (!sources.some((s) => s.bank === b.slug && s.url === p.url)) added.push({ bank: b.slug, loan: '*', url: p.url });
    }
    if (!r.chosen.length) console.log('  nothing found; add its rate pages by hand in the admin Sources tab');
  }
  await closeBrowser();
  if (argv.includes('--add') && added.length) {
    const all = [...sources, ...added];
    const line = (o) => `  { ${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
    fs.writeFileSync(path.join(ROOT, 'data/sources.json'), `[\n${all.map(line).join(',\n')}\n]\n`);
    console.log(`\nadded ${added.length} sources to data/sources.json`);
  }
  process.exit(0);
}

await main();
