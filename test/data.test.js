import test from 'node:test';
import assert from 'node:assert/strict';
import { publishable } from '../src/data.js';
import { emi, schedule, yearly, maxEmiFor, balanceTransfer, flatEmi, flatToReducing, ltvFor, maxLoanForValue, stampDuty, calendarYearly, monthLabel } from '../src/math.js';
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

test('core loan types compare at least 10 banks, newer types at least 4', () => {
  const products = JSON.parse(fs.readFileSync(new URL('../data/products.json', import.meta.url), 'utf8'));
  const loans = JSON.parse(fs.readFileSync(new URL('../data/loans.json', import.meta.url), 'utf8'));
  for (const loan of loans) {
    const banks = new Set(products.filter((p) => p.loan === loan.slug && !p.review).map((p) => p.bank));
    const min = loan.core ? 10 : 4;
    assert.ok(banks.size >= min, `${loan.slug} has only ${banks.size} banks (needs ${min})`);
  }
});

test('schedules use calendar dates from the first EMI month', () => {
  const rows = schedule(5e6, 8.5, 20);
  assert.equal(monthLabel(1, '2026-11-03'), '2026-Nov');
  assert.equal(monthLabel(3, '2026-11-03'), '2027-Jan');
  const ys = calendarYearly(rows, '2026-11-03');
  assert.deepEqual([ys[0].year, ys[0].months, ys[1].year, ys[1].months], [2026, 2, 2027, 12]);
  assert.equal(ys.at(-1).year, 2046);
  assert.equal(ys.reduce((a, y) => a + y.months, 0), rows.length);
  assert.ok(Math.abs(ys.reduce((a, y) => a + y.principal, 0) - 5e6) < 1);
});

test('loan against FD lists margins from official pages', () => {
  const fd = JSON.parse(fs.readFileSync(new URL('../data/fdloans.json', import.meta.url), 'utf8')).banks;
  assert.ok(fd.length >= 4);
  for (const b of fd) {
    assert.ok(b.sourceUrl.startsWith('https://'), `${b.bank} needs an https source`);
    assert.ok(Number.isFinite(b.margin) && b.margin > 0 && b.margin < 5, `${b.bank} margin`);
  }
});
