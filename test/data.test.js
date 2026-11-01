import test from 'node:test';
import assert from 'node:assert/strict';
import { publishable } from '../src/data.js';
import { validate, relevantLines, stripHtml } from '../src/collect.js';
import { emi } from '../src/math.js';

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

test('EMI helper is correct', () => {
  assert.ok(Math.abs(emi(5_000_000, 8.5, 20) - 43391) < 1);
});
