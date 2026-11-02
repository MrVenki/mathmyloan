import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(ROOT, 'dist', p);

test('build produces the keyword-target pages with no broken values', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'src', 'build.js')], { cwd: ROOT, stdio: 'pipe' });
  const required = [
    'index.html',
    'home-loan/index.html',
    'home-loan/sbi/index.html',
    'home-loan-emi-calculator/index.html',
    'home-loan-eligibility-calculator/index.html',
    'home-loan-prepayment-calculator/index.html',
    'home-loan-balance-transfer-calculator/index.html',
    'home-loan-amortization-schedule/index.html',
    'calculators/index.html',
    'loan-interest-rates/index.html',
    'embed/index.html',
    'embed/emi/index.html',
    'stamp-duty-calculator/index.html',
    'stamp-duty-in-maharashtra/index.html',
  ];
  for (const f of required) assert.ok(fs.existsSync(dist(f)), `missing ${f}`);

  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(dist('')).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8');
    assert.ok(!/NaN|undefined|\[object Object\]|Infinity/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), `bad value in ${file}`);
    assert.ok(/<title>[^<]{10,}<\/title>/.test(html), `missing title in ${file}`);
  }

  const sitemap = fs.readFileSync(dist('sitemap.xml'), 'utf8');
  assert.ok(sitemap.includes('/home-loan-eligibility-calculator/'));
  assert.ok(!sitemap.includes('/embed/emi/'), 'embed frame must not be in the sitemap');
  // A loan hub is in the sitemap only when it has at least one bank rate to show.
  const products = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'products.json'), 'utf8'));
  for (const loan of JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'loans.json'), 'utf8'))) {
    const listed = sitemap.includes(`/${loan.slug}/<`);
    assert.equal(listed, products.some((p) => p.loan === loan.slug && !p.review), `${loan.slug} hub sitemap entry`);
  }
  assert.ok(fs.readFileSync(dist('embed/emi/index.html'), 'utf8').includes('noindex'));
});
