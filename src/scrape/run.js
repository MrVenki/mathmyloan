// Rate scraper: reads every official source page, finds each loan's rate without AI, and writes
// the results to data/drafts.json for an admin to review. Nothing here changes the live rates.
//   node src/scrape/run.js            scrape all sources, email a summary when there is news
//   --bank <slug>                     only one bank
//   --no-email | --email              never / always email
//   --push                            commit and push the drafts (used by the GitHub Action)
//   --cache <dir>                     reuse page text saved in <dir> (for testing rule changes)
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, readJson } from '../data.js';
import { pageText, closeBrowser } from './fetch.js';
import { findRate, LOAN_RULES } from './extract.js';
import { sendMail } from './mail.js';

// Local runs can keep SMTP settings in a git-ignored .env file.
export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const readOr = (rel, fallback) => (fs.existsSync(path.join(ROOT, rel)) ? readJson(rel) : fallback);
const writeJson = (rel, v) => fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(v, null, 2) + '\n');
const idOf = (bank, loan) => `${bank}|${loan}`;

// How a found rate compares with the live one.
export function statusOf(found, live, method) {
  if (found == null) return 'failed';
  if (live == null) return 'new';
  if (Math.abs(found - live) < 0.0005) return 'same';
  if (Math.abs(found - live) > 1 || method === 'keywords') return 'suspect';
  return 'changed';
}

// Keeps an admin's edits and decisions on an item when the scraper finds the same thing again.
export function mergeItem(next, old) {
  if (!old || old.found !== next.found || old.status === 'failed') return next;
  return { ...next, review: old.review, proposed: old.proposed ?? next.proposed, reviewedOn: old.reviewedOn };
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// Page text, optionally kept in a local folder so rule changes can be tested without refetching.
async function readPage(url, render, cacheDir) {
  const file = cacheDir && path.join(cacheDir, crypto.createHash('md5').update(url).digest('hex').slice(0, 10) + '.txt');
  if (file && fs.existsSync(file)) return { text: fs.readFileSync(file, 'utf8'), via: 'cache' };
  const page = await pageText(url, { render });
  if (file) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, page.text);
  }
  return page;
}

export async function scrape({ onlyBank, cacheDir } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const loans = readJson('data/loans.json').map((l) => l.slug).filter((s) => LOAN_RULES[s]);
  const banks = new Map(readJson('data/banks.json').map((b) => [b.slug, b]));
  const products = readJson('data/products.json');
  const sources = readJson('data/sources.json').filter((s) => !onlyBank || s.bank === onlyBank);
  const rules = readOr('data/scrape-rules.json', {});
  const old = readOr('data/drafts.json', { items: [] });
  const oldById = new Map(old.items.map((i) => [i.id, i]));

  // One fetch per page, however many loans it lists.
  const pages = new Map();
  await pool([...new Set(sources.filter((s) => !s.manual).map((s) => s.url))], 4, async (url) => {
    const render = sources.some((s) => s.url === url && s.render);
    try {
      pages.set(url, await readPage(url, render, cacheDir));
    } catch (err) {
      pages.set(url, { error: err.message });
    }
    console.log(`[scrape] ${pages.get(url).error ? 'FAILED ' : ''}${url} (${pages.get(url).via ?? pages.get(url).error})`);
  });
  await closeBrowser();

  const specific = new Set(sources.filter((s) => s.loan !== '*').map((s) => idOf(s.bank, s.loan)));
  const items = [];
  for (const s of sources) {
    if (!banks.has(s.bank)) {
      console.warn(`[scrape] unknown bank ${s.bank}, add it to data/banks.json`);
      continue;
    }
    const wildcard = s.loan === '*';
    for (const loan of wildcard ? loans : [s.loan]) {
      const id = idOf(s.bank, loan);
      if (wildcard && specific.has(id)) continue;
      if (items.some((i) => i.id === id)) continue;
      const live = products.find((p) => p.bank === s.bank && p.loan === loan);
      const base = { id, bank: s.bank, loan, url: s.url, live: live?.rateFrom ?? null, liveHeld: Boolean(live?.review), checkedOn: today };
      const proposedFrom = (rate) => ({
        rateFrom: rate,
        conditions: live?.conditions ?? '',
        effectiveFrom: live?.effectiveFrom ?? null,
        fee: live?.fee ?? null,
        prepayment: live?.prepayment ?? null,
        maxTenureYears: live?.maxTenureYears ?? null,
      });
      let item;
      if (s.manual) {
        item = { ...base, found: null, status: 'manual', error: s.note || 'This source is checked by hand', proposed: proposedFrom(live?.rateFrom ?? null) };
      } else if (s.base) {
        // The base rate is read from this source's own page, where the bank states the margin.
        const page = pages.get(s.url);
        const baseProduct = products.find((p) => p.bank === s.bank && p.loan === s.base);
        const baseLive = baseProduct?.review ? undefined : baseProduct?.rateFrom;
        const from = page.error ? null : findRate(page.text, s.base, { rule: rules[`${id}#base`], live: baseLive });
        if (from?.rule) rules[`${id}#base`] = { ...from.rule, learnedOn: today };
        const found = from ? Math.round((from.value + Number(s.plus)) * 1000) / 1000 : null;
        item = {
          ...base,
          found,
          method: 'margin',
          via: page.via ?? null,
          evidence: from ? `${from.evidence}\n=> ${s.base} rate ${from.value}% + ${s.plus}% margin stated by the bank (check the margin is unchanged)` : null,
          status: statusOf(found, base.live, 'margin'),
          error: page.error ?? (from ? undefined : `The ${s.base} rate this margin is added to was not found on the page`),
          proposed: proposedFrom(found ?? live?.rateFrom ?? null),
        };
      } else {
        const page = pages.get(s.url);
        // A rate held back for review is not trusted to anchor anything.
        const hit = page.error ? null : findRate(page.text, loan, { rule: rules[id], live: live?.review ? undefined : live?.rateFrom });
        // A page that lists every loan only produces drafts for the loans it actually mentions.
        if (wildcard && !hit && !live) continue;
        if (hit?.rule) rules[id] = { ...hit.rule, learnedOn: today };
        const found = hit?.value ?? null;
        item = {
          ...base,
          found,
          method: hit?.method ?? null,
          via: page.via ?? null,
          evidence: hit?.evidence ?? null,
          alternatives: hit?.alternatives?.length ? hit.alternatives : undefined,
          status: statusOf(found, base.live, hit?.method),
          error: page.error ?? (hit ? undefined : 'No rate for this loan found on the page'),
          proposed: proposedFrom(found ?? live?.rateFrom ?? null),
        };
      }
      items.push(mergeItem({ ...item, review: 'pending' }, oldById.get(id)));
    }
  }
  // A run for one bank keeps every other bank's drafts as they were.
  if (onlyBank) items.push(...old.items.filter((i) => i.bank !== onlyBank));
  // Admin decisions on items no longer scraped are dropped; their sources were removed.
  const order = { suspect: 0, changed: 1, new: 2, failed: 3, manual: 4, same: 5 };
  items.sort((a, b) => order[a.status] - order[b.status] || a.loan.localeCompare(b.loan) || a.bank.localeCompare(b.bank));
  const summary = Object.fromEntries(Object.keys(order).map((k) => [k, items.filter((i) => i.status === k).length]));
  const drafts = { updatedAt: new Date().toISOString(), lastEmailDigest: old.lastEmailDigest ?? null, summary, items };
  writeJson('data/drafts.json', drafts);
  writeJson('data/scrape-rules.json', Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b))));
  return { drafts, banks };
}

// ---------- email ----------

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (v) => (v == null ? '-' : `${v}%`);

export function report(drafts, banks, adminUrl) {
  const todo = drafts.items.filter((i) => i.review === 'pending' && i.status !== 'same');
  const name = (slug) => banks.get(slug)?.name ?? slug;
  const label = { suspect: 'Check carefully', changed: 'Rate changed', new: 'New bank rate', failed: 'Could not read', manual: 'Check by hand' };
  const s = drafts.summary;
  const head = `${s.changed + s.suspect} changed, ${s.new} new, ${s.failed} failed, ${s.same} unchanged`;
  const rows = todo
    .map((i) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${esc(label[i.status])}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb"><b>${esc(name(i.bank))}</b><br>${esc(i.loan)}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${esc(pct(i.live))}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right"><b>${esc(pct(i.found))}</b></td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb"><a href="${esc(i.url)}">source</a></td></tr>`)
    .join('');
  const html = `<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:720px">
<h2 style="color:#112551;margin:0 0 6px">MathMyLoan rate check</h2>
<p style="margin:0 0 14px">${esc(head)}. Nothing is published until you approve it.</p>
<p><a href="${esc(adminUrl)}" style="display:inline-block;background:#112551;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Review and approve</a></p>
${rows ? `<table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="background:#eef1f7"><th style="padding:6px 8px;text-align:left">What</th><th style="padding:6px 8px;text-align:left">Bank and loan</th><th style="padding:6px 8px;text-align:right">Live</th><th style="padding:6px 8px;text-align:right">Found</th><th></th></tr>${rows}</table>` : '<p>No changes to review.</p>'}
</div>`;
  const text = `MathMyLoan rate check: ${head}.\n\n${todo.map((i) => `${label[i.status]}: ${name(i.bank)} ${i.loan}: ${pct(i.live)} -> ${pct(i.found)}`).join('\n')}\n\nReview: ${adminUrl}`;
  const digest = todo.map((i) => `${i.id}:${i.found}`).sort().join(',');
  return { subject: `Rate check: ${head}`, html, text, digest, count: todo.length };
}

async function main() {
  loadEnv();
  const argv = process.argv.slice(2);
  const onlyBank = argv.includes('--bank') ? argv[argv.indexOf('--bank') + 1] : undefined;
  const cacheDir = argv.includes('--cache') ? argv[argv.indexOf('--cache') + 1] : undefined;
  const { drafts, banks } = await scrape({ onlyBank, cacheDir });
  const s = drafts.summary;
  console.log(`[scrape] ${s.changed} changed, ${s.suspect} to check, ${s.new} new, ${s.failed} failed, ${s.manual} by hand, ${s.same} unchanged`);

  const cfg = readJson('config.json');
  const r = report(drafts, banks, `${cfg.siteUrl}/admin/`);
  const want = argv.includes('--email') || (!argv.includes('--no-email') && r.count > 0 && r.digest !== drafts.lastEmailDigest);
  // Unset GitHub secrets arrive as empty strings, so defaults use ||.
  const { SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM } = process.env;
  if (want && SMTP_USER && SMTP_PASS && MAIL_TO) {
    try {
      await sendMail({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port: process.env.SMTP_PORT || 465, user: SMTP_USER, pass: SMTP_PASS, from: MAIL_FROM || `MathMyLoan <${SMTP_USER}>`, to: MAIL_TO.split(',').map((x) => x.trim()), subject: r.subject, html: r.html, text: r.text });
      drafts.lastEmailDigest = r.digest;
      writeJson('data/drafts.json', drafts);
      console.log(`[scrape] emailed ${MAIL_TO}`);
    } catch (err) {
      console.error(`[scrape] email failed: ${err.message}`);
    }
  } else if (want) {
    console.log('[scrape] email skipped: set SMTP_USER, SMTP_PASS and MAIL_TO');
  }

  if (argv.includes('--push')) {
    const git = (...a) => execFileSync('git', a, { cwd: ROOT, stdio: 'inherit' });
    git('add', 'data/drafts.json', 'data/scrape-rules.json');
    try {
      execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT });
      console.log('[scrape] drafts unchanged');
    } catch {
      git('commit', '-m', `data: scraped rates ${new Date().toISOString().slice(0, 10)}`);
      git('pull', '--rebase', '--quiet');
      git('push');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
  process.exit(0);
}
