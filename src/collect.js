// Collector agent: reads each bank's official page, asks Claude to extract the loan terms,
// and publishes a value only if its quoted evidence literally appears in the page text.
// Big rate moves are held for human review. Needs ANTHROPIC_API_KEY; without it nothing changes.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readJson } from './data.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[ \s]+/g, ' ').trim();

export function stripHtml(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h\d|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, '\n');
}

// Keeps only lines that talk about rates, fees, prepayment or tenure.
export function relevantLines(text, cap = 12000) {
  const seen = new Set();
  const out = [];
  for (const line of text.split('\n').map((l) => l.trim())) {
    if (line.length < 8 || line.length > 600 || seen.has(line)) continue;
    if (/interest|rate|processing|prepay|foreclos|tenure|tenor|%/i.test(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out.join('\n').slice(0, cap);
}

const quoted = (quote, pageText) => Boolean(quote) && norm(pageText).includes(norm(quote));

// Turns an extraction into a product record. Any value whose quote is not found verbatim
// in the page is dropped; a rate without valid evidence rejects the whole extraction.
export function validate(ex, pageText, existing) {
  const reasons = [];
  const q = ex?.quotes ?? {};
  const rate = Number(ex?.rateFrom);
  const rateQuoteNums = [...String(q.rateFrom ?? '').matchAll(/(\d{1,2}(?:\.\d{1,2})?)\s*%/g)].map((m) => Number(m[1]));
  if (!Number.isFinite(rate) || rate <= 0 || rate > 40) return { ok: false, reasons: ['no valid rate'] };
  if (!quoted(q.rateFrom, pageText)) return { ok: false, reasons: ['rate quote not found in page'] };
  if (!rateQuoteNums.some((n) => Math.abs(n - rate) < 0.001)) return { ok: false, reasons: ['rate not in its quote'] };

  const rec = {
    rateFrom: rate,
    fee: quoted(q.fee, pageText) && ex.fee ? String(ex.fee).slice(0, 200) : null,
    prepayment: quoted(q.prepayment, pageText) && ex.prepayment ? String(ex.prepayment).slice(0, 200) : null,
    maxTenureYears:
      quoted(q.maxTenureYears, pageText) && Number(ex.maxTenureYears) > 0 && Number(ex.maxTenureYears) <= 40
        ? Number(ex.maxTenureYears)
        : null,
  };
  let review = false;
  if (existing && Math.abs(existing.rateFrom - rate) > 0.5) {
    review = true;
    reasons.push(`rate moved ${existing.rateFrom}% to ${rate}%`);
  }
  return { ok: true, rec, review, reasons };
}

async function extract(excerpt, bank, loan) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 700,
      system:
        'You extract loan terms from text of a bank web page. Reply with ONLY a JSON object. Use null for anything not explicitly stated; never guess, calculate or infer. ' +
        'Fields: rateFrom (number, the lowest advertised annual interest rate in percent), fee (short text), prepayment (short text), maxTenureYears (number). ' +
        'Also "quotes": for each of rateFrom, fee, prepayment, maxTenureYears, the exact snippet (max 200 chars) copied from the text that supports it.',
      messages: [{ role: 'user', content: `Bank: ${bank}\nLoan type: ${loan}\n\nPage text:\n${excerpt}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
  const data = await res.json();
  const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

async function alert(lines) {
  const { TELEGRAM_BOT_TOKEN: t, TELEGRAM_CHAT_ID: c } = process.env;
  if (!t || !c || !lines.length) return;
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: c, text: `Loan Compare rate check\n${lines.join('\n')}` }),
  });
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) return console.log('[collect] ANTHROPIC_API_KEY not set, nothing changed');
  const sources = readJson('data/sources.json');
  const file = path.join(ROOT, 'data/products.json');
  const products = readJson('data/products.json');
  const today = new Date().toISOString().slice(0, 10);
  const notes = [];

  for (const s of sources) {
    try {
      const res = await fetch(s.url, { headers: { 'user-agent': 'LoanCompareBot/0.1 (rate comparison; contact via site)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = stripHtml(await res.text());
      const ex = await extract(relevantLines(text), s.bank, s.loan);
      const existing = products.find((p) => p.bank === s.bank && p.loan === s.loan);
      const v = validate(ex, text, existing);
      if (!v.ok) {
        notes.push(`${s.bank} ${s.loan}: skipped (${v.reasons.join(', ')})`);
        continue;
      }
      const next = { bank: s.bank, loan: s.loan, ...v.rec, sourceUrl: s.url, retrievedOn: today };
      if (v.review) {
        next.review = true;
        next.note = v.reasons.join('; ');
        notes.push(`${s.bank} ${s.loan}: HELD FOR REVIEW (${v.reasons.join(', ')})`);
      } else if (existing && existing.rateFrom !== next.rateFrom) {
        notes.push(`${s.bank} ${s.loan}: ${existing.rateFrom}% -> ${next.rateFrom}%`);
      }
      const i = products.findIndex((p) => p.bank === s.bank && p.loan === s.loan);
      if (i >= 0) products[i] = next;
      else products.push(next);
    } catch (err) {
      notes.push(`${s.bank} ${s.loan}: failed (${err.message})`);
    }
  }
  fs.writeFileSync(file, JSON.stringify(products, null, 2) + '\n');
  console.log(notes.join('\n') || '[collect] no changes');
  await alert(notes);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
