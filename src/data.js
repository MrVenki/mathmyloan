import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const DAY = 86_400_000;

// A rate is published only when it has an official https source, a real check date that is
// not stale, a numeric starting rate, and has not been held back for human review.
export function publishable(p, maxAgeDays, now = Date.now()) {
  const reasons = [];
  if (!/^https:\/\//.test(p.sourceUrl ?? '')) reasons.push('no https source');
  const t = Date.parse(p.retrievedOn ?? '');
  if (Number.isNaN(t)) reasons.push('no check date');
  else if (now - t > maxAgeDays * DAY) reasons.push(`older than ${maxAgeDays} days`);
  if (!Number.isFinite(p.rateFrom) || p.rateFrom <= 0 || p.rateFrom > 40) reasons.push('bad rate');
  if (p.review) reasons.push('held for review');
  return { ok: reasons.length === 0, reasons };
}

export function loadData(cfg, now = Date.now()) {
  const loans = readJson('data/loans.json');
  const banks = readJson('data/banks.json');
  const bankBySlug = new Map(banks.map((b) => [b.slug, b]));
  const loanBySlug = new Map(loans.map((l) => [l.slug, l]));
  const products = [];
  for (const p of readJson('data/products.json')) {
    const bank = bankBySlug.get(p.bank);
    const loan = loanBySlug.get(p.loan);
    if (!bank || !loan) {
      console.warn(`[data] skipping unknown bank/loan: ${p.bank} / ${p.loan}`);
      continue;
    }
    const v = publishable(p, cfg.maxAgeDays, now);
    if (!v.ok) {
      console.warn(`[data] hidden ${p.bank} ${p.loan}: ${v.reasons.join(', ')}`);
      continue;
    }
    products.push({ ...p, bankInfo: bank, loanInfo: loan });
  }
  return { loans, banks, products };
}
