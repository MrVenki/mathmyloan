import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/pdf.js';

const { build, clean } = globalThis.MMLPdf;
const text = (bytes) => Buffer.from(bytes).toString('latin1');

test('PDF reports are well-formed, paginated and watermarked', () => {
  const rows = Array.from({ length: 240 }, (_, i) => [`2026-${i}`, String(i + 1), '₹43,391', '₹8,000', '₹35,391', '₹49,92,000']);
  const pdf = text(build({
    title: 'Loan EMI and repayment schedule',
    inputs: [['Loan amount', '₹50,00,000'], ['Where is the property', 'Municipal corporation or cantonment area, a long value that must wrap']],
    results: [['Monthly EMI', '₹43,391', true]],
    sections: [{ title: 'Month-by-month schedule', head: ['Month', 'EMI no.', 'Paid', 'Principal', 'Interest', 'Balance left'], rows }],
    notes: ['A note (with brackets) and a backslash \\ that must be escaped.'],
  }, new Date('2026-11-03')));

  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  // Every cross-reference offset must point at the start of its object.
  const xrefAt = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(xrefAt, xrefAt + 4), 'xref');
  const offsets = pdf.slice(xrefAt).match(/^(\d{10}) 00000 n $/gm).map((l) => Number(l.slice(0, 10)));
  offsets.forEach((o, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj`, o), `object ${i + 1} offset`));
  // 240 schedule rows need several pages; each page carries the watermark and its page number.
  const pages = Number(pdf.match(/\/Type \/Pages \/Count (\d+)/)[1]);
  assert.ok(pages >= 5, `expected at least 5 pages, got ${pages}`);
  assert.equal((pdf.match(/\(MathMyLoan\.com\) Tj/g) || []).length, pages);
  assert.ok(pdf.includes(`(Page ${pages} of ${pages}) Tj`));
  assert.ok(pdf.includes('(Rs. 50,00,000) Tj'), 'rupee sign becomes Rs.');
  assert.ok(pdf.includes('\\(with brackets\\)'), 'brackets are escaped');
  assert.ok(!/[^\x00-\xff]/.test(pdf), 'only single-byte characters');
});

test('text is mapped to the standard-font character set', () => {
  assert.equal(clean('₹5,000 – ₹6,000 “ok” …'), 'Rs. 5,000 - Rs. 6,000 "ok" ...');
});
