import test from 'node:test';
import assert from 'node:assert/strict';
import { findRate, rateTokens, learn, byRule, linesOf, loanContext } from '../src/scrape/extract.js';
import { htmlToText } from '../src/scrape/fetch.js';
import { statusOf, mergeItem, report } from '../src/scrape/run.js';
import { buildMessage } from '../src/scrape/mail.js';

const page = htmlToText(`<h2>Home Loan</h2>
<table><tr><th>Scheme</th><th>Rate of interest</th></tr>
<tr><td><p>Salaried</p></td><td><p>RLLR + 0.50%</p><p>(presently 7.75% p.a.)</p></td></tr>
<tr><td>Women borrowers</td><td>7.70% p.a.</td></tr></table>
<h2>Personal Loan</h2><p>Interest rate from 10.50% p.a. Processing fee 1% of the loan.</p>
<h2>Car Loan</h2><p>Rate of interest: 8.40% onwards</p><p>Penal interest: 2% p.a. on overdue amount</p>`);

test('table rows read as one line with their cells', () => {
  assert.ok(linesOf(page).includes('Salaried | RLLR + 0.50% (presently 7.75% p.a.)'));
});

test('benchmark spreads, fees and penal rates are not loan rates', () => {
  const t = rateTokens('RLLR + 0.50% (presently 7.75% p.a.)');
  assert.deepEqual(t.map((x) => [x.value, x.skip]), [[0.5, true], [7.75, false]]);
  assert.equal(rateTokens('Penal Charges | Default: 8% p.a. on overdue')[0].skip, true);
  assert.equal(rateTokens('EBLR - 0.85% = 7.40%')[1].skip, false);
});

test('keyword rules find the lowest rate under each loan heading', () => {
  assert.equal(findRate(page, 'home-loan').value, 7.7);
  assert.equal(findRate(page, 'personal-loan').value, 10.5);
  assert.equal(findRate(page, 'car-loan').value, 8.4);
  assert.equal(findRate(page, 'gold-loan'), null);
});

test('loan words decide the section: top-up and used car are not home and car loans', () => {
  const ctx = loanContext(['Home Loan Top-up | 8.20%', 'Used Car Loan | 9.50%', 'Car Loan | 8.00%']);
  assert.deepEqual([...ctx], [['top-up-home-loan'], ['used-car-loan'], ['car-loan']]);
});

test('an approved rate teaches a rule that reads the new rate next time', () => {
  const lines = linesOf(page);
  const l = learn(lines, 'home-loan', 7.75);
  assert.equal(l.method, 'learned');
  const moved = linesOf(page.replace('7.75%', '7.90%'));
  assert.equal(byRule(moved, 'home-loan', l.rule).value, 7.9);
  // The rule wins over keywords, which would have picked the lower women's rate.
  assert.equal(findRate(page.replace('7.75%', '7.90%'), 'home-loan', { rule: l.rule }).value, 7.9);
});

test('draft status compares the found rate with the live one', () => {
  assert.equal(statusOf(null, 8), 'failed');
  assert.equal(statusOf(8, null), 'new');
  assert.equal(statusOf(8, 8), 'same');
  assert.equal(statusOf(8.1, 8, 'rule'), 'changed');
  assert.equal(statusOf(9.5, 8, 'rule'), 'suspect');
  assert.equal(statusOf(8.1, 8, 'keywords'), 'suspect');
});

test('admin edits survive a rescrape that finds the same rate', () => {
  const next = { id: 'a|b', found: 8, review: 'pending', proposed: { rateFrom: 8 } };
  const old = { id: 'a|b', found: 8, review: 'pending', proposed: { rateFrom: 8, conditions: 'edited' }, status: 'changed' };
  assert.equal(mergeItem(next, old).proposed.conditions, 'edited');
  assert.equal(mergeItem({ ...next, found: 8.2 }, old).proposed.rateFrom, 8);
});

test('email lists what needs review and links to the admin page', () => {
  const drafts = { summary: { changed: 1, suspect: 0, new: 1, failed: 0, manual: 0, same: 5 }, items: [
    { id: 'x|home-loan', bank: 'x', loan: 'home-loan', status: 'changed', review: 'pending', live: 8, found: 8.1, url: 'https://x.bank.in' },
    { id: 'y|car-loan', bank: 'y', loan: 'car-loan', status: 'same', review: 'pending', live: 9, found: 9, url: 'https://y.bank.in' },
  ] };
  const r = report(drafts, new Map([['x', { name: 'X Bank' }]]), 'https://mathmyloan.com/admin/');
  assert.equal(r.count, 1);
  assert.match(r.html, /X Bank/);
  assert.match(r.text, /mathmyloan\.com\/admin/);
  const msg = buildMessage({ from: 'a@b.c', to: ['d@e.f'], subject: 'Rate check ₹', html: r.html, text: r.text });
  assert.match(msg, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(msg, /multipart\/alternative/);
});
