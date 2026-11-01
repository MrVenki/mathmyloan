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
  assert.ok(!sitemap.includes('/loan-against-property/<'), 'empty hubs must not be in the sitemap');
  assert.ok(fs.readFileSync(dist('embed/emi/index.html'), 'utf8').includes('noindex'));
});
