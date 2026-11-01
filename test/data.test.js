import test from 'node:test';
import assert from 'node:assert/strict';
import { publishable } from '../src/data.js';
import { validate, relevantLines, stripHtml } from '../src/collect.js';
import { emi, schedule, yearly } from '../src/math.js';

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

test('zero-rate loans split evenly', () => {
  const rows = schedule(1_200_000, 0, 10);
  assert.equal(rows.length, 120);
  assert.ok(Math.abs(rows[0].principal - 10000) < 1e-9);
});

test('EMI helper is correct', () => {
  assert.ok(Math.abs(emi(5_000_000, 8.5, 20) - 43391) < 1);
});
