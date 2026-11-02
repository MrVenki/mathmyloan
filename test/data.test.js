import test from 'node:test';
import assert from 'node:assert/strict';
import { publishable } from '../src/data.js';
import { validate, relevantLines, stripHtml } from '../src/collect.js';
import { emi, schedule, yearly, maxEmiFor, balanceTransfer, flatEmi, flatToReducing, ltvFor, maxLoanForValue, stampDuty } from '../src/math.js';
import fs from 'node:fs';

const NOW = Date.parse('2026-11-10');
const good = { rateFrom: 8.5, sourceUrl: 'https://bank.example/x', retrievedOn: '2026-11-01' };

test('only sourced, fresh, numeric, unreviewed rates are published', () => {
  assert.ok(publishable(good, 90, NOW).ok);
  assert.ok(!publishable({ ...good, sourceUrl: 'http://bank.example' }, 90, NOW).ok);
  assert.ok(!publishable({ ...good, sourceUrl: undefined }, 90, NOW).ok);
  assert.ok(!publishable({ ...good, retrievedOn: '2026-05-01' }, 90, NOW).ok);
  assert.ok(!publishable({ ...good, retrievedOn: undefined }, 90, NOW).ok);
  assert.ok(!publishable({ ...good, rateFrom: 0 }, 90, NOW).ok);
  assert.ok(!publishable({ ...good, rateFrom: 85 }, 90, NOW).ok);
  assert.ok(!publishable({ ...good, review: true }, 90, NOW).ok);
});

const page = 'Home loan rate starts from 8.50% p.a.\nProcessing fee: up to 2% of the loan amount\nTenure up to 30 years';

test('extraction is accepted only when its quotes appear in the page', () => {
  const ok = validate({ rateFrom: 8.5, fee: 'up to 2%', maxTenureYears: 30, quotes: { rateFrom: 'starts from 8.50% p.a.', fee: 'Processing fee: up to 2% of the loan amount', maxTenureYears: 'Tenure up to 30 years' } }, page, null);
  assert.ok(ok.ok);
  assert.equal(ok.rec.maxTenureYears, 30);
  assert.equal(ok.rec.fee, 'up to 2%');
});

test('invented values are rejected or dropped', () => {
  assert.equal(validate({ rateFrom: 7.1, quotes: { rateFrom: 'starts from 7.10% p.a.' } }, page, null).ok, false);
  assert.equal(validate({ rateFrom: 9, quotes: { rateFrom: 'starts from 8.50% p.a.' } }, page, null).ok, false);
  const dropped = validate({ rateFrom: 8.5, fee: 'nil', quotes: { rateFrom: 'starts from 8.50% p.a.', fee: 'no fee at all' } }, page, null);
  assert.ok(dropped.ok);
  assert.equal(dropped.rec.fee, null);
});

test('a rate move over 0.5 points is held for review', () => {
  const ex = { rateFrom: 8.5, quotes: { rateFrom: 'starts from 8.50% p.a.' } };
  assert.equal(validate(ex, page, { rateFrom: 8.2 }).review, false);
  assert.equal(validate(ex, page, { rateFrom: 7.4 }).review, true);
});

test('page text is reduced to rate-related lines', () => {
  const t = stripHtml('<div>Nav menu</div><p>Interest rate starts from 8.50%</p><script>x=1</script><p>Contact us today</p>');
  assert.equal(relevantLines(t), 'Interest rate starts from 8.50%');
});

test('schedule repays the principal and its interest matches EMI x months', () => {
  const rows = schedule(5_000_000, 8.5, 20);
  assert.equal(rows.length, 240);
  assert.ok(Math.abs(rows.reduce((a, r) => a + r.principal, 0) - 5_000_000) < 1);
  const interest = rows.reduce((a, r) => a + r.interest, 0);
  assert.ok(Math.abs(interest - (emi(5_000_000, 8.5, 20) * 240 - 5_000_000)) < 5);
  assert.ok(rows.at(-1).balance < 1);
  const years = yearly(rows);
  assert.equal(years.length, 20);
  assert.ok(Math.abs(years[0].interest + years[0].principal - years[0].paid) < 1e-6);
});

test('extra payments finish the loan sooner and cost less interest', () => {
  const base = schedule(5_000_000, 8.5, 20);
  const extra = schedule(5_000_000, 8.5, 20, 5000, 100000);
  assert.ok(extra.length < base.length);
  const sum = (rows) => rows.reduce((a, r) => a + r.interest, 0);
  assert.ok(sum(extra) < sum(base));
  assert.ok(Math.abs(extra.reduce((a, r) => a + r.principal, 0) - 5_000_000) < 1);
});

test('a one-time lump sum shortens the loan and is applied in its month', () => {
  const base = schedule(5_000_000, 8.5, 20);
  const lump = schedule(5_000_000, 8.5, 20, 0, 0, 500_000, 24);
  assert.ok(lump.length < base.length);
  assert.ok(lump[23].principal > 500_000);
  assert.ok(Math.abs(lump[22].principal - base[22].principal) < 1e-6);
});

test('eligibility and balance transfer helpers', () => {
  assert.equal(maxEmiFor(100_000, 10_000, 50), 40_000);
  assert.equal(maxEmiFor(20_000, 15_000, 50), 0);
  const bt = balanceTransfer(4_000_000, 9.5, 8.5, 15, 10_000);
  assert.ok(bt.monthly > 0 && bt.net > 0);
  assert.equal(bt.breakEvenMonths, Math.ceil(10_000 / bt.monthly));
  assert.ok(Math.abs(bt.net - (bt.monthly * 180 - 10_000)) < 1e-6);
  assert.equal(balanceTransfer(4_000_000, 8.5, 9, 15, 0).breakEvenMonths, null);
});

test('flat rate converts to a higher reducing rate with the same EMI', () => {
  // ₹1 lakh at 10% flat for 1 year: EMI 9,166.67, equivalent to about 17.97% reducing.
  assert.ok(Math.abs(flatEmi(100000, 10, 1) - 9166.67) < 0.01);
  const r = flatToReducing(10, 1);
  assert.ok(Math.abs(emi(100000, r, 1) - flatEmi(100000, 10, 1)) < 0.01);
  assert.ok(r > 17.8 && r < 18.1);
  assert.equal(flatToReducing(0, 3), 0);
});

test('loan-to-value slabs', () => {
  assert.equal(ltvFor(2_500_000), 0.9);
  assert.equal(ltvFor(5_000_000), 0.8);
  assert.equal(ltvFor(9_000_000), 0.75);
});

test('zero-rate loans split evenly', () => {
  const rows = schedule(1_200_000, 0, 10);
  assert.equal(rows.length, 120);
  assert.ok(Math.abs(rows[0].principal - 10000) < 1e-9);
});

test('EMI helper is correct', () => {
  assert.ok(Math.abs(emi(5_000_000, 8.5, 20) - 43391) < 1);
});

test('stamp duty: official rates give the expected totals', () => {
  const sd = JSON.parse(fs.readFileSync(new URL('../data/stampduty.json', import.meta.url), 'utf8')).states;
  const st = (slug) => sd.find((s) => s.slug === slug);
  // Delhi, ₹50 lakh: man 6% + 1% + ₹100; woman 4% + 1% + ₹100
  const dl = st('delhi').areas[0];
  assert.equal(stampDuty(dl, 5e6, 'man').total, 300000 + 50000 + 100);
  assert.equal(stampDuty(dl, 5e6, 'woman').total, 200000 + 50000 + 100);
  // Maharashtra corporation, ₹50 lakh: 5% duty, registration capped at ₹30,000; women 4%
  const mh = st('maharashtra').areas.find((a) => a.id === 'corporation');
  assert.equal(stampDuty(mh, 5e6).duty, 250000);
  assert.equal(stampDuty(mh, 5e6).registration, 30000);
  assert.equal(stampDuty(mh, 5e6, 'woman').duty, 200000);
  // Registration below the cap: ₹100 + ₹10 per ₹1,000 above ₹10,000, part-thousands rounded up
  assert.equal(stampDuty(mh, 1500500).registration, 15010);
  assert.equal(stampDuty(mh, 5000).registration, 100);
  // Telangana: 7.5% in both kinds of area, no women's concession
  for (const a of st('telangana').areas) {
    assert.equal(stampDuty(a, 4e6).total, 300000);
    assert.equal(stampDuty(a, 4e6, 'woman').total, 300000);
  }
  for (const s of sd) {
    assert.ok(s.sources.length && s.sources.every((x) => x.url.startsWith('https://')), `${s.slug} needs https sources`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s.retrievedOn), `${s.slug} needs a check date`);
  }
});

test('LTV slabs cap the loan on a property value', () => {
  assert.equal(maxLoanForValue(3e6), 2.7e6);
  assert.equal(maxLoanForValue(3.5e6), 3e6);
  assert.equal(maxLoanForValue(5e6), 4e6);
  assert.equal(maxLoanForValue(1e7), 7.5e6);
  assert.equal(maxLoanForValue(2e7), 1.5e7);
});
