import fs from 'node:fs';
import path from 'node:path';
import { emi, summary, schedule, yearly, loanForEmi, maxEmiFor, balanceTransfer, inr, lakhLabel } from './math.js';
import { ROOT, readJson, loadData } from './data.js';

const OUT = path.join(ROOT, 'dist');
const cfg = readJson('config.json');
const { loans, banks, products } = loadData(cfg);
const today = new Date().toISOString().slice(0, 10);
const pages = [];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const href = (p) => cfg.basePath + p;
// Bank logos are the banks' own site icons, saved by scripts/fetch-logos.mjs and self-hosted.
const logoManifest = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'logos', 'manifest.json'), 'utf8'));
  } catch {
    return {};
  }
})();
const logoMap = Object.fromEntries(Object.entries(logoManifest).map(([slug, v]) => [slug, `${cfg.basePath}/logos/${v.file}`]));
const monthOf = (d) => new Date(d).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const amt = (a) => String(a).replace('.', '-');
const rate = (r) => `${Number(r.toFixed(2))}%`;
// Adds the brand to a title only when it still fits in a search result (about 65 characters).
const titled = (s) => (s.length + cfg.siteName.length + 3 <= 65 ? `${s} | ${cfg.siteName}` : s);
const history = (() => {
  try {
    return readJson('data/history.json');
  } catch {
    return [];
  }
})();

function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const CSS = fs.readFileSync(path.join(ROOT, 'src', 'style.css'), 'utf8');

function layout({ title, desc, url, body, crumbs = [], jsonld = [], extraScript = '', noindex = false }) {
  if (!noindex) pages.push(url);
  const trail = [{ name: 'Home', url: '/' }, ...crumbs];
  const ld = [
    ...jsonld,
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: cfg.siteUrl + c.url })),
    },
  ];
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(cfg.siteUrl + url)}">
${noindex ? '<meta name="robots" content="noindex,follow">' : ''}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<style>${CSS}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="${href('/')}"><span class="logo" aria-hidden="true">₹</span>${esc(cfg.siteName)}</a>
<nav aria-label="Main">${loans.map((l) => `<a href="${href(`/${l.slug}/`)}">${esc(l.name)}</a>`).join('')}<a href="${href('/calculators/')}">Calculators</a><a href="${href('/loan-interest-rates/')}">All rates</a></nav></div></header>
<main>
<p class="crumbs">${trail.map((c, i) => (i === trail.length - 1 ? esc(c.name) : `<a href="${href(c.url)}">${esc(c.name)}</a>`)).join(' › ')}</p>
${body}
</main>
<footer class="small">
<p>Rates are the starting rates published on each bank's own website on the date shown, and can change without notice. Your rate depends on your credit score, income and the bank's approval. This is not financial advice or a loan offer, and we are not a bank or lender.</p>
<p><a href="${href('/about/')}">About and how we get our data</a> · <a href="${href('/loan-interest-rates/')}">All loan rates</a> · <a href="${href('/calculators/')}">Calculators</a> · <a href="${href('/embed/')}">Free calculator for your website</a> · <a href="${href('/privacy/')}">Privacy</a></p>
</footer>
<script>window.CALC={worker:${JSON.stringify(cfg.workerUrl)}};window.LOGOS=${JSON.stringify(logoMap)};${extraScript}</script>
<script src="${href('/app.js')}" defer></script>
</body>
</html>
`;
}

let fieldId = 0;
const MONEY = new Set(['amount', 'extraM', 'extraY', 'lump', 'income', 'existing', 'outstanding', 'fees']);
const field = (label, name, value, step = 'any') => {
  const id = `${name}-${++fieldId}`;
  return `<div><label for="${id}">${label}</label><input type="number" inputmode="decimal" id="${id}" name="${name}" value="${value}" step="${step}" min="0"${MONEY.has(name) ? ' data-words' : ''}></div>`;
};

const calcWidget = (P, r, y, { open = false, extraM = 0, extraY = 0, lump = 0, lumpAt = 12, view = '' } = {}) => `<div class="card" data-calc="emi"${view ? ` data-view-default="${view}"` : ''}>
<div class="row">${field('Loan amount (₹)', 'amount', P)}${field('Interest rate (% p.a.)', 'rate', r, '0.05')}${field('Tenure (years)', 'years', y)}</div>
<details class="opts"${open ? ' open' : ''}><summary>Prepayment options (optional): pay extra to finish sooner</summary>
<div class="row">${field('Extra payment every month (₹)', 'extraM', extraM)}${field('Extra lump sum every year (₹)', 'extraY', extraY)}</div>
<div class="row">${field('One-time lump sum (₹)', 'lump', lump)}${field('Paid with instalment number', 'lumpAt', lumpAt, '1')}</div></details>
<div class="out" aria-live="polite"></div></div>`;

const verifiedNote = (p) =>
  `${p.effectiveFrom ? `Effective from ${esc(p.effectiveFrom)}. ` : ''}${p.conditions ? `${esc(p.conditions)}. ` : ''}${p.note ? esc(p.note) : ''}`;

// "How we checked" panel: the evidence behind every number on the page.
const trustBox = (list) => `<aside class="trust-box">
<b>How we checked ${list.length > 1 ? 'these rates' : 'this rate'}</b>
<ul>${list
  .map(
    (p) =>
      `<li>${esc(p.bankInfo.name)}: <a rel="nofollow noopener" href="${esc(p.sourceUrl)}">bank's official page</a>, checked ${esc(p.retrievedOn)}. ${verifiedNote(p)}</li>`,
  )
  .join('')}</ul>
<p class="small">We only publish rates we can trace to the bank's own website, and an automated check re-reads them every week. Always confirm with the bank before you apply. <a href="${href('/about/')}">Read our method</a>.</p>
</aside>`;

const leadForm = ({ loan = '', bank = '', amount = '', heading = 'Want a call back about this loan?' } = {}) => `<form class="card" data-lead data-loan="${esc(loan)}" data-bank="${esc(bank)}">
<h2 style="margin-top:0">${esc(heading)}</h2>
<p class="small">Share your details and a partner lender or loan advisor may call you. No fee from us.</p>
<div class="row">
<div><label for="lname">Name</label><input type="text" id="lname" name="name" autocomplete="name" maxlength="80"></div>
<div><label for="lphone">Mobile number</label><input type="tel" id="lphone" name="phone" autocomplete="tel" inputmode="tel" maxlength="16"></div>
<div><label for="lcity">City</label><input type="text" id="lcity" name="city" autocomplete="address-level2" maxlength="60"></div>
</div>
<div class="row"><div>${field('Loan amount needed (₹)', 'amount', amount)}</div></div>
<div class="hp"><label>Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<label style="display:flex;gap:8px;align-items:flex-start;color:var(--fg)"><input type="checkbox" name="consent" style="margin-top:4px">
<span class="small">I agree to be contacted by phone, SMS or WhatsApp by partner lenders or loan advisors about loans, and to my details being shared with them. See the <a href="${href('/privacy/')}">privacy policy</a>.</span></label>
<button type="submit">Request a call back</button>
<p class="msg small" aria-live="polite"></p>
</form>`;

const faqLd = (qa) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});
const faqHtml = (qa) => qa.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('\n');
const sourceLine = (p) => `Source: <a rel="nofollow noopener" href="${esc(p.sourceUrl)}">${esc(p.bankInfo.name)} official page</a>, checked on ${esc(monthOf(p.retrievedOn))} (${esc(p.retrievedOn)}).`;
const stdNote = '<p class="note">These figures use the bank\'s advertised <b>starting</b> rate. Most borrowers are offered a higher rate depending on credit score, income and loan size, so treat the result as a best case.</p>';

const ICONS = {
  'home-loan': '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  'personal-loan': '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  'car-loan': '<path d="M3 13l2-6h14l2 6"/><rect x="3" y="13" width="18" height="5" rx="1"/><circle cx="7.5" cy="18" r="1.5"/><circle cx="16.5" cy="18" r="1.5"/>',
  'education-loan': '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>',
  'loan-against-property': '<rect x="4" y="3" width="10" height="18"/><path d="M14 9h6v12h-6"/><path d="M8 7h2M8 11h2M8 15h2"/>',
};
const icon = (slug) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[slug] ?? ''}</svg>`;
const hueOf = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const initialsOf = (s) => s.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const avatar = (name, slug) =>
  logoMap[slug]
    ? `<span class="av has-logo"><img src="${esc(logoMap[slug])}" alt="" width="22" height="22" loading="lazy" decoding="async"></span>`
    : `<span class="av" style="--h:${hueOf(name)}">${esc(initialsOf(name))}</span>`;

const forLoan = (loan) => products.filter((p) => p.loan === loan.slug).sort((a, b) => a.rateFrom - b.rateFrom);
const bankUrl = (loan, p) => `/${loan.slug}/${p.bank}/`;
const vsUrl = (loan, a, b) => `/${loan.slug}/${a.bank}-vs-${b.bank}/`;
const emiUrl = (loan, p, a, y) => `/${loan.slug}/${p.bank}/emi-${amt(a)}-lakh-${y}-years/`;

// ---------- pages ----------

function loanHub(loan) {
  const list = forLoan(loan);
  const rows = list
    .map(
      (p, i) => `<tr><td><span class="title-row" style="gap:8px">${avatar(p.bankInfo.short, p.bank)}<a href="${href(bankUrl(loan, p))}">${esc(p.bankInfo.name)}</a></span>${i === 0 && list.length > 1 ? '<span class="badge">Lowest rate</span>' : ''}</td><td>${rate(p.rateFrom)}${p.conditions ? `<br><span class="small">${esc(p.conditions)}</span>` : ''}</td><td>${esc(p.fee ?? 'Not stated on page')}</td><td>${esc(p.prepayment ?? 'Not stated on page')}</td><td>${p.maxTenureYears ? `${p.maxTenureYears} yrs` : '-'}</td></tr>`,
    )
    .join('');
  const P = loan.defaultAmountLakh * 100000;
  const best = list[0];
  const qa = best
    ? [
        [`Which bank has the lowest ${loan.name.toLowerCase()} interest rate?`, `Among the banks we have checked, ${best.bankInfo.name} advertises the lowest starting rate at ${rate(best.rateFrom)} per annum (checked ${best.retrievedOn}). The rate you are offered can be higher.`],
        [`What is the EMI on a ${lakhLabel(loan.defaultAmountLakh)} ${loan.name.toLowerCase()} for ${loan.defaultTenure} years?`, `At ${rate(best.rateFrom)} it is about ${inr(emi(P, best.rateFrom, loan.defaultTenure))} a month, and at ${rate(loan.defaultRate)} it is about ${inr(emi(P, loan.defaultRate, loan.defaultTenure))}.`],
      ]
    : [];
  const compare = list.length
    ? `<h2>Compare banks side by side</h2>
<div class="card" data-compare>
<div class="row">${field('Loan amount (₹)', 'amount', P)}${field('Tenure (years)', 'years', loan.defaultTenure)}</div>
<div class="picks">${list.map((p) => `<label><input type="checkbox" value="${esc(p.bank)}" checked> ${esc(p.bankInfo.short)}</label>`).join('')}</div>
<div class="out" aria-live="polite"></div></div>
<h2>${esc(loan.name)} rates by bank</h2>
<div class="scroll"><table><thead><tr><th>Bank</th><th>Starting rate</th><th>Processing fee</th><th>Prepayment</th><th>Max tenure</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="small">Sorted from lowest to highest starting rate. Each bank page links to its official source and check date.</p>`
    : '<p class="note">We are still verifying bank rates for this loan type, so none are listed yet. The calculator below works for any rate.</p>';
  const vs = list.length > 1 ? `<h2>Head-to-head comparisons</h2><p class="chips">${pairs(list).map(([a, b]) => `<a href="${href(vsUrl(loan, a, b))}">${esc(a.bankInfo.short)} vs ${esc(b.bankInfo.short)}</a>`).join('')}</p>` : '';
  const month = best ? monthOf(list.map((p) => p.retrievedOn).sort().at(-1)) : '';
  return layout({
    title: best
      ? titled(`${loan.name} Interest Rates ${month}: Lowest ${rate(best.rateFrom)}, ${list.length} Bank${list.length > 1 ? 's' : ''}`)
      : titled(`${loan.name} Interest Rates in India`),
    desc: best
      ? `Best ${loan.name.toLowerCase()} interest rates for ${month}: lowest starting rate ${rate(best.rateFrom)} (${best.bankInfo.short}). Compare EMI, processing fees and prepayment across ${list.length} bank${list.length > 1 ? 's' : ''}, each with its source.`
      : `Compare ${loan.name.toLowerCase()} interest rates, processing fees and EMI across Indian banks.`,
    url: `/${loan.slug}/`,
    crumbs: [{ name: loan.name, url: `/${loan.slug}/` }],
    jsonld: qa.length ? [faqLd(qa)] : [],
    noindex: !best,
    extraScript: `window.PRODUCTS=${JSON.stringify(list.map((p) => ({ slug: p.bank, name: p.bankInfo.short, rate: p.rateFrom, url: href(bankUrl(loan, p)) }))).replace(/</g, '\\u003c')};`,
    body: `<div class="title-row"><span class="ico">${icon(loan.slug)}</span><h1 style="margin:0">${esc(loan.name)} Interest Rates${best ? ` ${esc(month)}` : ''}</h1></div>
<p class="lead">${best ? `The lowest ${esc(loan.name.toLowerCase())} interest rate we found this month is <b>${rate(best.rateFrom)}</b> from ${esc(best.bankInfo.name)}. Compare the best ${esc(loan.name.toLowerCase())} rates from ${list.length} bank${list.length > 1 ? 's' : ''} below, each linked to the bank's own page. ` : ''}${esc(loan.blurb)}</p>
${best ? `<div class="tiles">
<div class="tile"><span>Lowest starting rate</span><b>${rate(best.rateFrom)}</b><span>${esc(best.bankInfo.short)}</span></div>
<div class="tile"><span><abbr title="Equated Monthly Instalment: the fixed amount you pay the bank every month">EMI</abbr> at that rate</span><b>${inr(emi(P, best.rateFrom, loan.defaultTenure))}</b><span>${lakhLabel(loan.defaultAmountLakh)}, ${loan.defaultTenure} years</span></div>
<div class="tile"><span>Banks compared</span><b>${list.length}</b><span>each with its source</span></div>
<div class="tile"><span>Last checked</span><b>${esc(monthOf(list.map((p) => p.retrievedOn).sort().at(-1)))}</b><span>from bank websites</span></div>
</div>` : ''}
${compare}
${stdNote}
${calcWidget(P, loan.defaultRate, loan.defaultTenure)}
${leadForm({ loan: loan.slug, amount: P, heading: `Get help choosing a ${loan.name.toLowerCase()}` })}
${vs}
${loan.slug === 'home-loan' ? toolChips() : ''}
${qa.length ? `<h2>Frequently asked questions</h2>${faqHtml(qa)}` : ''}
${list.length ? trustBox(list) : ''}`,
  });
}

function pairs(list) {
  const sorted = [...list].sort((a, b) => a.bank.localeCompare(b.bank));
  const out = [];
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) out.push([sorted[i], sorted[j]]);
  return out;
}

function bankPage(loan, p) {
  const P = loan.defaultAmountLakh * 100000;
  const s = summary(P, p.rateFrom, loan.defaultTenure);
  const name = p.bankInfo.name;
  const qa = [
    [`What is the ${name} ${loan.name.toLowerCase()} interest rate?`, `${name}'s website advertises ${loan.name.toLowerCase()} rates starting from ${rate(p.rateFrom)} per annum (checked ${p.retrievedOn}). The rate you get depends on your credit score, income and loan amount.`],
    [`What is the EMI on a ${lakhLabel(loan.defaultAmountLakh)} ${loan.name.toLowerCase()} from ${name}?`, `At the starting rate of ${rate(p.rateFrom)} over ${loan.defaultTenure} years the EMI is about ${inr(s.emi)} a month, with total interest of about ${inr(s.interest)}. A higher personal rate would raise this.`],
    [`What is the processing fee for a ${name} ${loan.name.toLowerCase()}?`, p.fee ? `${name} states: ${p.fee}.` : `The ${name} page we checked did not state a processing fee. Please confirm it with the bank's fee schedule before applying.`],
    [`Does ${name} charge prepayment charges on a ${loan.name.toLowerCase()}?`, p.prepayment ? `${p.prepayment}. Terms can differ between floating and fixed rates, so confirm with the bank.` : `The page we checked did not state prepayment terms. Please confirm with the bank.`],
  ];
  const specs = [
    ['Starting interest rate', `${rate(p.rateFrom)} per annum`],
    ...(p.conditions ? [['Applies to', p.conditions]] : []),
    ...(p.effectiveFrom ? [['Effective from', p.effectiveFrom]] : []),
    ['Processing fee', p.fee ?? 'Not stated on the page we checked'],
    ['Prepayment', p.prepayment ?? 'Not stated on the page we checked'],
    ['Maximum tenure', p.maxTenureYears ? `${p.maxTenureYears} years` : 'Not stated on the page we checked'],
  ];
  const emiLinks = loan.pageAmountsLakh.flatMap((a) => loan.pageTenures.map((y) => `<a href="${href(emiUrl(loan, p, a, y))}">${lakhLabel(a)} for ${y} years</a>`)).join('');
  const rivals = forLoan(loan).filter((q) => q.bank !== p.bank);
  return layout({
    title: titled(`${p.bankInfo.short} ${loan.name} Interest Rate ${monthOf(p.retrievedOn)}: ${rate(p.rateFrom)} Onwards`),
    desc: `${name} ${loan.name.toLowerCase()} interest rate for ${monthOf(p.retrievedOn)} starts at ${rate(p.rateFrom)} p.a. See EMI for ${lakhLabel(loan.defaultAmountLakh)}, processing fee, prepayment rules and how it compares with other banks.`,
    url: bankUrl(loan, p),
    crumbs: [{ name: loan.name, url: `/${loan.slug}/` }, { name: name, url: bankUrl(loan, p) }],
    jsonld: [faqLd(qa)],
    body: `<div class="title-row">${avatar(p.bankInfo.short, p.bank)}<h1 style="margin:0">${esc(name)} ${esc(loan.name)} Interest Rate ${esc(monthOf(p.retrievedOn))}</h1></div>
<p>${esc(name)} advertises ${esc(loan.name.toLowerCase())} rates starting from <b>${rate(p.rateFrom)}</b> per annum. For ${lakhLabel(loan.defaultAmountLakh)} over ${loan.defaultTenure} years that is an EMI of about <b>${inr(s.emi)}</b> a month.</p>
<div class="tiles">
<div class="tile"><span>Starting rate</span><b>${rate(p.rateFrom)}</b><span>per annum</span></div>
<div class="tile"><span><abbr title="Equated Monthly Instalment: the fixed amount you pay the bank every month">EMI</abbr> per month</span><b>${inr(s.emi)}</b><span>${lakhLabel(loan.defaultAmountLakh)}, ${loan.defaultTenure} years</span></div>
<div class="tile"><span>Total interest</span><b>${inr(s.interest)}</b><span>over the full term</span></div>
<div class="tile"><span>Max tenure</span><b>${p.maxTenureYears ? `${p.maxTenureYears} yrs` : 'n/a'}</b><span>as stated by the bank</span></div>
</div>
<p class="small">${sourceLine(p)}</p>
<div class="scroll"><table><tbody>${specs.map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:left">${esc(v)}</td></tr>`).join('')}</tbody></table></div>
${stdNote}
${calcWidget(P, p.rateFrom, loan.defaultTenure)}
${leadForm({ loan: loan.slug, bank: p.bank, amount: P, heading: `Apply or get a call back for a ${name} ${loan.name.toLowerCase()}` })}
<h2>EMI for popular amounts</h2><p class="chips">${emiLinks}</p>
${rivals.length ? `<h2>Compare ${esc(name)} with other banks</h2><p class="chips">${rivals.map((q) => { const [a, b] = [p, q].sort((x, y) => x.bank.localeCompare(y.bank)); return `<a href="${href(vsUrl(loan, a, b))}">${esc(p.bankInfo.short)} vs ${esc(q.bankInfo.short)}</a>`; }).join('')}</p>` : ''}
${loan.slug === 'home-loan' ? toolChips() : ''}
<h2>Frequently asked questions</h2>
${faqHtml(qa)}
${trustBox([p])}`,
  });
}

function emiPage(loan, p, lakh, years) {
  const P = lakh * 100000;
  const name = p.bankInfo.name;
  const s = summary(P, p.rateFrom, years);
  const steps = [0, 0.5, 1, 1.5, 2].map((d) => {
    const r = p.rateFrom + d;
    const x = summary(P, r, years);
    return `<tr><td>${rate(r)}${d === 0 ? ' (starting)' : ''}</td><td>${inr(x.emi)}</td><td>${inr(x.interest)}</td><td>${inr(x.total)}</td></tr>`;
  }).join('');
  const yearRows = yearly(schedule(P, p.rateFrom, years))
    .map((y) => `<tr><td>Year ${y.year}</td><td>${inr(y.principal)}</td><td>${inr(y.interest)}</td><td>${inr(y.paid)}</td><td>${inr(y.balance)}</td></tr>`)
    .join('');
  const qa = [
    [`What is the EMI for a ${lakhLabel(lakh)} ${name} ${loan.name.toLowerCase()} for ${years} years?`, `At ${name}'s starting rate of ${rate(p.rateFrom)} the EMI is about ${inr(s.emi)} a month. If your offered rate is ${rate(p.rateFrom + 1)} it would be about ${inr(emi(P, p.rateFrom + 1, years))}.`],
    [`How much total interest will I pay?`, `At ${rate(p.rateFrom)} the total interest over ${years} years is about ${inr(s.interest)}, so you repay about ${inr(s.total)} in all.`],
  ];
  return layout({
    title: `${name} ${lakhLabel(lakh)} ${loan.name} EMI for ${years} Years: ${inr(s.emi)}/month | ${cfg.siteName}`,
    desc: `EMI on a ${lakhLabel(lakh)} ${name} ${loan.name.toLowerCase()} over ${years} years is about ${inr(s.emi)} a month at the ${rate(p.rateFrom)} starting rate, with EMI at higher rates too.`,
    url: emiUrl(loan, p, lakh, years),
    crumbs: [{ name: loan.name, url: `/${loan.slug}/` }, { name, url: bankUrl(loan, p) }, { name: `${lakhLabel(lakh)} for ${years} years`, url: emiUrl(loan, p, lakh, years) }],
    jsonld: [faqLd(qa)],
    body: `<h1>${esc(name)} ${esc(lakhLabel(lakh))} ${esc(loan.name)} EMI for ${years} Years</h1>
<p>At the advertised starting rate of <b>${rate(p.rateFrom)}</b>, the EMI is about <b>${inr(s.emi)}</b> a month, with total interest of about ${inr(s.interest)}.</p>
<p class="small">${sourceLine(p)}</p>
${stdNote}
${calcWidget(P, p.rateFrom, years)}
<h2>EMI at higher rates</h2>
<div class="scroll"><table><thead><tr><th>Rate</th><th>EMI</th><th>Total interest</th><th>Total payment</th></tr></thead><tbody>${steps}</tbody></table></div>
<h2>Year-by-year repayment schedule at ${rate(p.rateFrom)}</h2>
<p class="small">How much of each year's payments goes to principal and to interest, and what you still owe at the end of the year. Use the calculator above for a month-by-month view and prepayment options.</p>
<div class="scroll"><table><thead><tr><th>Year</th><th>Principal</th><th>Interest</th><th>Paid</th><th>Balance left</th></tr></thead><tbody>${yearRows}</tbody></table></div>
${leadForm({ loan: loan.slug, bank: p.bank, amount: P })}
<h2>Frequently asked questions</h2>${faqHtml(qa)}
<p><a href="${href(bankUrl(loan, p))}">All ${esc(name)} ${esc(loan.name.toLowerCase())} details</a></p>`,
  });
}

function vsPage(loan, a, b) {
  const P = loan.defaultAmountLakh * 100000;
  const y = loan.defaultTenure;
  const sa = summary(P, a.rateFrom, y);
  const sb = summary(P, b.rateFrom, y);
  const [lo, hi, sLo, sHi] = sa.interest <= sb.interest ? [a, b, sa, sb] : [b, a, sb, sa];
  const same = Math.abs(sa.interest - sb.interest) < 1;
  const verdict = same
    ? `${a.bankInfo.name} and ${b.bankInfo.name} advertise the same starting rate.`
    : `${lo.bankInfo.name} advertises the lower starting rate (${rate(lo.rateFrom)} vs ${rate(hi.rateFrom)}). On ${lakhLabel(loan.defaultAmountLakh)} over ${y} years that is about ${inr(sHi.interest - sLo.interest)} less interest, or ${inr(sHi.emi - sLo.emi)} less per month, at the starting rates.`;
  const rowsData = [
    ['Starting interest rate', rate(a.rateFrom), rate(b.rateFrom)],
    [`EMI for ${lakhLabel(loan.defaultAmountLakh)}, ${y} years`, inr(sa.emi), inr(sb.emi)],
    ['Total interest', inr(sa.interest), inr(sb.interest)],
    ['Processing fee', a.fee ?? 'Not stated', b.fee ?? 'Not stated'],
    ['Prepayment', a.prepayment ?? 'Not stated', b.prepayment ?? 'Not stated'],
    ['Maximum tenure', a.maxTenureYears ? `${a.maxTenureYears} years` : '-', b.maxTenureYears ? `${b.maxTenureYears} years` : '-'],
  ];
  const qa = [
    [`Which is cheaper, ${a.bankInfo.short} or ${b.bankInfo.short} ${loan.name.toLowerCase()}?`, verdict + ' Your actual rate may differ from the starting rate.'],
  ];
  const title = titled(`${a.bankInfo.short} vs ${b.bankInfo.short} ${loan.name} (${monthOf([a.retrievedOn, b.retrievedOn].sort().at(-1))}): Rate, EMI, Fees`);
  return layout({
    title,
    desc: `${a.bankInfo.name} vs ${b.bankInfo.name} ${loan.name.toLowerCase()}: starting rates ${rate(a.rateFrom)} and ${rate(b.rateFrom)}, EMI, fees and prepayment side by side.`,
    url: vsUrl(loan, a, b),
    crumbs: [{ name: loan.name, url: `/${loan.slug}/` }, { name: `${a.bankInfo.short} vs ${b.bankInfo.short}`, url: vsUrl(loan, a, b) }],
    jsonld: [faqLd(qa)],
    body: `<h1>${esc(a.bankInfo.name)} vs ${esc(b.bankInfo.name)} ${esc(loan.name)}</h1>
<p>${esc(verdict)}</p>
<div class="scroll"><table><thead><tr><th></th><th>${esc(a.bankInfo.short)}</th><th>${esc(b.bankInfo.short)}</th></tr></thead><tbody>
${rowsData.map(([k, x, z]) => `<tr><td>${esc(k)}</td><td>${esc(x)}</td><td>${esc(z)}</td></tr>`).join('\n')}
</tbody></table></div>
<p class="small">${sourceLine(a)}<br>${sourceLine(b)}</p>
${stdNote}
${leadForm({ loan: loan.slug, amount: P, heading: `Get help choosing between ${a.bankInfo.short} and ${b.bankInfo.short}` })}
<h2>Frequently asked questions</h2>${faqHtml(qa)}
<p><a href="${href(bankUrl(loan, a))}">${esc(a.bankInfo.name)} details</a> · <a href="${href(bankUrl(loan, b))}">${esc(b.bankInfo.name)} details</a></p>
${trustBox([a, b])}`,
  });
}

function calcPage(loan) {
  const P = loan.defaultAmountLakh * 100000;
  const amountRows = loan.amountsLakh
    .map((a) => `<tr><td>${lakhLabel(a)}</td>${loan.tenures.map((y) => `<td>${inr(emi(a * 100000, loan.defaultRate, y))}</td>`).join('')}</tr>`)
    .join('');
  const isHome = loan.slug === 'home-loan';
  return layout({
    title: isHome
      ? 'Home Loan EMI Calculator with Amortization Schedule & Prepayment'
      : titled(`${loan.name} EMI Calculator: EMI, Interest & Schedule`),
    desc: `Free ${loan.name.toLowerCase()} EMI calculator for India. See your monthly EMI, total interest, a year-by-year and month-by-month repayment schedule, and how much prepayment saves.`,
    url: `/${loan.slug}-emi-calculator/`,
    crumbs: [{ name: loan.name, url: `/${loan.slug}/` }, { name: 'EMI calculator', url: `/${loan.slug}-emi-calculator/` }],
    body: `<h1>${esc(loan.name)} EMI Calculator</h1>
<p>Enter the amount, interest rate and tenure to see your monthly EMI. To use a real bank's rate, see <a href="${href(`/${loan.slug}/`)}">${esc(loan.name.toLowerCase())} rates by bank</a>.</p>
${calcWidget(P, loan.defaultRate, loan.defaultTenure)}
<h2>EMI at ${rate(loan.defaultRate)} for common amounts</h2>
<div class="scroll"><table><thead><tr><th>Amount</th>${loan.tenures.map((y) => `<th>${y} yrs</th>`).join('')}</tr></thead><tbody>${amountRows}</tbody></table></div>
<p class="small">Illustrative rate for the table only; change it in the calculator above.</p>
${leadForm({ loan: loan.slug, amount: P })}
${isHome ? toolChips() : ''}`,
  });
}

function homePage() {
  const verified = loans.filter((l) => forLoan(l).length);
  const upcoming = loans.filter((l) => !forLoan(l).length);
  const latest = products.map((p) => p.retrievedOn).sort().at(-1);
  const bankCount = new Set(products.map((p) => p.bank)).size;
  return layout({
    title: `${cfg.siteName}: Compare Loan Interest Rates & EMI in India`,
    desc: 'Compare home, personal, car and education loan interest rates across Indian banks, with the source and check date for every rate. Free EMI, eligibility, prepayment and balance transfer calculators.',
    url: '/',
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'Organization', name: cfg.siteName, url: `${cfg.siteUrl}/` },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.siteName, url: `${cfg.siteUrl}/` },
    ],
    extraScript: `window.QUICK=${JSON.stringify(
      Object.fromEntries(
        verified.map((l) => [
          l.slug,
          {
            name: l.name,
            amount: l.defaultAmountLakh * 100000,
            years: l.defaultTenure,
            banks: forLoan(l).map((p) => ({ slug: p.bank, name: p.bankInfo.short, rate: p.rateFrom, url: href(bankUrl(l, p)) })),
          },
        ]),
      ),
    ).replace(/</g, '\\u003c')};`,
    body: `<section class="hero"><div class="hero-grid">
<div>
<h1>Compare loan rates across <span class="grad">Indian banks</span></h1>
<p class="lead">See which bank costs you less, in seconds. Every rate links to the bank's own page and shows the date we checked it.</p>
<div class="pills"><span>Source on every rate</span><span>Always dated</span><span>Free, no sign-up</span></div>
</div>
<div class="card" data-quick>
<div class="row">
<div><label for="qloan">Loan type</label><select id="qloan" name="loan">${verified.map((l) => `<option value="${l.slug}">${esc(l.name)}</option>`).join('')}</select></div>
${field('Loan amount (₹)', 'amount', verified[0] ? verified[0].defaultAmountLakh * 100000 : 5000000)}
${field('Tenure (years)', 'years', verified[0] ? verified[0].defaultTenure : 20)}
</div>
<div class="out" aria-live="polite"></div>
</div>
</div></section>
<div class="stats">
<div><b>${bankCount}</b><span>banks verified</span></div>
<div><b>${verified.length}</b><span>${verified.length === 1 ? 'loan type' : 'loan types'} with rates</span></div>
<div><b>${products.length}</b><span>rates with sources</span></div>
<div><b>${latest ? esc(monthOf(latest)) : '-'}</b><span>last checked</span></div>
</div>
<h2>Compare by loan type</h2>
<div class="grid">
${verified.map((l) => {
  const list = forLoan(l);
  return `<a class="lcard" href="${href(`/${l.slug}/`)}"><span class="ico">${icon(l.slug)}</span><span><b>${esc(l.name)} rates</b><span>${list.length} bank${list.length > 1 ? 's' : ''} compared, from ${rate(list[0].rateFrom)}</span></span></a>`;
}).join('\n')}
${upcoming.map((l) => `<a class="lcard" href="${href(`/${l.slug}-emi-calculator/`)}"><span class="ico">${icon(l.slug)}</span><span><b>${esc(l.name)} EMI calculator</b><span>Bank rates coming soon</span></span></a>`).join('\n')}
</div>
<h2>Home loan calculators</h2>
<div class="grid">${TOOLS.map((t) => `<a class="lcard" href="${href(t.url)}"><span class="ico">${icon(t.icon)}</span><span><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></span></a>`).join('\n')}</div>
<p><a href="${href('/loan-interest-rates/')}">See every bank loan interest rate we track →</a></p>
<h2>How it works</h2>
<div class="steps">
<div class="step"><em>1</em><b>Pick your loan</b><span>Choose the loan type, amount and tenure you need.</span></div>
<div class="step"><em>2</em><b>See banks ranked</b><span>We rank banks by the interest you would pay, with each rate's source.</span></div>
<div class="step"><em>3</em><b>Ask for a call back</b><span>Optional: share your number and a lender or advisor may call you. No fee from us.</span></div>
</div>
${verified.flatMap((l) => (forLoan(l).length > 1 ? [`<h2>Popular ${esc(l.name.toLowerCase())} comparisons</h2><p class="chips">${pairs(forLoan(l)).map(([a, b]) => `<a href="${href(vsUrl(l, a, b))}">${esc(a.bankInfo.short)} vs ${esc(b.bankInfo.short)}</a>`).join('')}</p>`] : [])).join('\n')}
<h2>Free EMI calculators</h2>
<p class="chips">${loans.map((l) => `<a href="${href(`/${l.slug}-emi-calculator/`)}">${esc(l.name)} EMI</a>`).join('')}</p>
<h2>How we get our data</h2>
<p>We read each bank's official loan page, record the starting rate and charges it states, and show the date. See the <a href="${href('/about/')}">about page</a> for details and limits.</p>`,
  });
}

function aboutPage() {
  return layout({
    title: `About and How We Get Our Data | ${cfg.siteName}`,
    desc: `How ${cfg.siteName} collects, checks and publishes bank loan rates.`,
    url: '/about/',
    crumbs: [{ name: 'About', url: '/about/' }],
    body: `<h1>About and how we get our data</h1>
<p>${esc(cfg.siteName)} compares loan rates, fees and EMI across Indian banks. We are not a bank or a lender.</p>
<h2>Where the numbers come from</h2>
<p>Each rate is taken from the bank's own website. We show the source link and the date we checked it. A rate is published only if it has an official source and was checked within the last ${cfg.maxAgeDays} days.</p>
<p>When a bank publishes a rate table or rate chart, we use it, and we note any marketing text on the same page that disagrees. If a page's headline figures contradict each other and there is no rate table, we hold the rate back until it is confirmed.</p>
<p>An automated check re-reads each bank page every week. A value is updated only if the exact wording it came from can be found on the bank's page, and a large rate change is held for a human to confirm before it is shown.</p>
<h2>What the rates mean</h2>
<p>Banks usually advertise a starting rate for the best borrowers. Your rate depends on your credit score, income, loan size and the bank's approval, and is often higher. EMI figures use the standard reducing-balance formula.</p>
<h2>How we earn</h2>
<p>If you request a call back, your details may be shared with partner lenders or loan advisors, who may pay us a referral fee. This does not increase what you pay and does not change the rates we show.</p>`,
  });
}

function privacyPage() {
  return layout({
    title: `Privacy Policy | ${cfg.siteName}`,
    desc: 'How we handle personal information.',
    url: '/privacy/',
    crumbs: [{ name: 'Privacy', url: '/privacy/' }],
    body: `<h1>Privacy Policy</h1>
<p>The calculators run in your browser and the numbers you type into them are not sent anywhere.</p>
<p>If you submit a call-back form we collect your name, mobile number, city, loan amount, the loan type or bank you were viewing, and the page you used. We use it to connect you with partner lenders or loan advisors and to run this site. By ticking the consent box you agree that they may contact you by phone, SMS or WhatsApp.</p>
<p>You can ask us to correct or delete your details at any time${cfg.contactEmail ? ` by emailing <a href="mailto:${esc(cfg.contactEmail)}">${esc(cfg.contactEmail)}</a>` : ''}. We do not sell your details to anyone other than the lenders or advisors described above.</p>`,
  });
}

// ---------- home loan tools (targets from keyword research) ----------

const homeLoan = loans.find((l) => l.slug === 'home-loan');
const homeList = homeLoan ? forLoan(homeLoan) : [];
const productsScript = (list, loan) =>
  `window.PRODUCTS=${JSON.stringify(list.map((p) => ({ slug: p.bank, name: p.bankInfo.short, rate: p.rateFrom, url: href(bankUrl(loan, p)) }))).replace(/</g, '\\u003c')};`;

const TOOLS = [
  { url: '/home-loan-emi-calculator/', name: 'Home loan EMI calculator', desc: 'Monthly EMI, total interest and a year-by-year schedule.', icon: 'home-loan' },
  { url: '/home-loan-eligibility-calculator/', name: 'Home loan eligibility calculator', desc: 'How much loan your salary can support, bank by bank.', icon: 'personal-loan' },
  { url: '/home-loan-prepayment-calculator/', name: 'Home loan prepayment calculator', desc: 'How much interest and time extra payments save.', icon: 'education-loan' },
  { url: '/home-loan-balance-transfer-calculator/', name: 'Home loan balance transfer calculator', desc: 'Whether moving your loan to another bank pays off after fees.', icon: 'loan-against-property' },
  { url: '/home-loan-amortization-schedule/', name: 'Home loan amortization schedule', desc: 'Month-by-month and year-by-year repayment schedule.', icon: 'home-loan' },
];
const toolChips = () =>
  `<h2>Home loan calculators</h2><p class="chips">${TOOLS.map((t) => `<a href="${href(t.url)}">${esc(t.name)}</a>`).join('')}</p>`;

function eligibilityPage() {
  const L = homeLoan;
  const r = L.defaultRate;
  const y = L.defaultTenure;
  const forIncome = (inc) => loanForEmi(maxEmiFor(inc, 0, 50), r, y);
  const rows = [25000, 40000, 50000, 75000, 100000, 150000, 200000]
    .map((inc) => `<tr><td>${inr(inc)}</td><td>${inr(maxEmiFor(inc, 0, 50))}</td><td>${inr(forIncome(inc))}</td></tr>`)
    .join('');
  const qa = [
    [`How much home loan can I get on a ₹50,000 salary?`, `With no other EMIs, lenders often allow total EMIs of up to about half your net monthly income, so about ${inr(maxEmiFor(50000, 0, 50))} a month. At ${rate(r)} for ${y} years that supports a home loan of about ${inr(forIncome(50000))}. Lenders' limits vary, commonly between 40% and 60% of income.`],
    [`How much home loan can I get on a ₹1 lakh salary?`, `About ${inr(forIncome(100000))} at ${rate(r)} over ${y} years, assuming no other EMIs and a 50% limit. A longer tenure or a lower rate raises the amount; existing EMIs reduce it.`],
    [`How much down payment do I need?`, `RBI limits how much of a home's value a bank can lend: up to 90% for loans up to ₹30 lakh, 80% for ₹30 to ₹75 lakh, and 75% above ₹75 lakh. You pay the rest, plus stamp duty and registration, yourself.`],
    [`Does my credit score change my eligibility?`, `Yes. A higher score usually gets a lower rate, and a lower rate supports a larger loan for the same EMI. Some banks advertise their lowest rate only for scores of 750 or 800 and above.`],
  ];
  return layout({
    title: 'Home Loan Eligibility Calculator: How Much Loan Can I Get?',
    desc: 'Check how much home loan you can get on your salary. Enter income and existing EMIs to see your eligible loan amount, home budget and the amount at each bank\'s starting rate.',
    url: '/home-loan-eligibility-calculator/',
    crumbs: [{ name: 'Calculators', url: '/calculators/' }, { name: 'Eligibility calculator', url: '/home-loan-eligibility-calculator/' }],
    jsonld: [faqLd(qa)],
    extraScript: productsScript(homeList, L),
    body: `<h1>Home Loan Eligibility Calculator</h1>
<p class="lead">Find out how much home loan your salary can support, and what that means for the home you can buy.</p>
<div class="card" data-elig>
<div class="row">${field('Net monthly income (₹)', 'income', 100000)}${field('Existing EMIs per month (₹)', 'existing', 0)}${field('Interest rate (% p.a.)', 'rate', r, '0.05')}</div>
<div class="row">${field('Tenure (years)', 'years', y)}${field('EMI limit (% of income)', 'foir', 50, '5')}</div>
<div class="out" aria-live="polite"></div></div>
<p class="note">Banks also look at your age, job, credit score and the property. Treat this as an estimate, not an approval.</p>
<h2>Home loan eligibility by salary</h2>
<p class="small">At ${rate(r)} for ${y} years, with no other EMIs and EMIs capped at 50% of net income.</p>
<div class="scroll"><table><thead><tr><th>Net monthly income</th><th>Maximum EMI</th><th>Eligible loan</th></tr></thead><tbody>${rows}</tbody></table></div>
${leadForm({ loan: 'home-loan', heading: 'Want a lender to confirm your eligibility?' })}
${toolChips()}
<h2>Frequently asked questions</h2>${faqHtml(qa)}`,
  });
}

function prepaymentPage() {
  const P = 5000000;
  const r = 8.5;
  const y = 20;
  const base = schedule(P, r, y);
  const baseInterest = base.reduce((a, x) => a + x.interest, 0);
  const span = (m) => `${Math.floor(m / 12)} yrs ${m % 12} mo`;
  const scenarios = [
    ['₹2,000 extra every month', [2000, 0, 0, 0]],
    ['₹5,000 extra every month', [5000, 0, 0, 0]],
    ['₹10,000 extra every month', [10000, 0, 0, 0]],
    ['₹50,000 extra every year', [0, 50000, 0, 0]],
    ['₹1,00,000 extra every year', [0, 100000, 0, 0]],
    ['₹5,00,000 once, after 2 years', [0, 0, 500000, 24]],
  ];
  const rows = scenarios
    .map(([label, args]) => {
      const s = schedule(P, r, y, ...args);
      const interest = s.reduce((a, x) => a + x.interest, 0);
      return `<tr><td>${label}</td><td>${span(s.length)}</td><td>${span(base.length - s.length)}</td><td>${inr(baseInterest - interest)}</td></tr>`;
    })
    .join('');
  const s5 = schedule(P, r, y, 5000);
  const qa = [
    ['Is it better to reduce the EMI or the tenure after a prepayment?', 'Keeping the same EMI and shortening the tenure usually saves more interest, because the loan is cleared sooner. Reducing the EMI eases your monthly budget but saves less.'],
    ['Do banks charge for prepaying a home loan?', 'Under RBI rules, banks generally cannot charge prepayment or foreclosure penalties on floating-rate home loans taken by individuals. Fixed-rate loans can carry a charge, so check your loan agreement.'],
    ['When does prepayment save the most?', 'In the early years, when most of each EMI is interest. The same extra payment made in year 2 saves far more than one made in year 15.'],
    [`How much does ₹5,000 extra a month save on a ₹50 lakh loan?`, `At ${rate(r)} over ${y} years, paying ₹5,000 more each month clears the loan ${span(base.length - s5.length)} early and saves about ${inr(baseInterest - s5.reduce((a, x) => a + x.interest, 0))} in interest.`],
  ];
  return layout({
    title: 'Home Loan Prepayment Calculator: Interest and Time Saved',
    desc: 'See how much interest and how many years you save by paying extra on your home loan, monthly, yearly or as a one-time lump sum. Includes a full repayment schedule.',
    url: '/home-loan-prepayment-calculator/',
    crumbs: [{ name: 'Calculators', url: '/calculators/' }, { name: 'Prepayment calculator', url: '/home-loan-prepayment-calculator/' }],
    jsonld: [faqLd(qa)],
    body: `<h1>Home Loan Prepayment Calculator</h1>
<p class="lead">Paying a little extra can take years off your home loan. Try a monthly top-up, a yearly bonus or a one-time lump sum and see the interest you save.</p>
${calcWidget(P, r, y, { open: true, extraM: 5000 })}
<h2>How much prepayment saves on a ₹50 lakh loan</h2>
<p class="small">₹50 lakh at ${rate(r)} for ${y} years, keeping the same EMI. Without prepayment you pay ${inr(baseInterest)} in interest.</p>
<div class="scroll"><table><thead><tr><th>Prepayment</th><th>Loan ends after</th><th>Time saved</th><th>Interest saved</th></tr></thead><tbody>${rows}</tbody></table></div>
${leadForm({ loan: 'home-loan', amount: P, heading: 'Thinking of moving to a cheaper loan instead?' })}
${toolChips()}
<h2>Frequently asked questions</h2>${faqHtml(qa)}`,
  });
}

function balanceTransferPage() {
  const O = 4000000;
  const oldRate = 9.5;
  const y = 15;
  const fees = 10000;
  const rows = homeList
    .map((p) => ({ p, bt: balanceTransfer(O, oldRate, p.rateFrom, y, fees) }))
    .filter((x) => x.bt.monthly > 0)
    .sort((a, b) => b.bt.net - a.bt.net)
    .map(({ p, bt }) => `<tr><td><span class="title-row" style="gap:8px">${avatar(p.bankInfo.short, p.bank)}<a href="${href(bankUrl(homeLoan, p))}">${esc(p.bankInfo.name)}</a></span></td><td>${rate(p.rateFrom)}</td><td>${inr(bt.monthly)}</td><td>${inr(bt.net)}</td><td>${bt.breakEvenMonths} mo</td></tr>`)
    .join('');
  const best = homeList[0];
  const qa = [
    ['When is a home loan balance transfer worth it?', 'As a rough guide, when the new rate is at least 0.5 percentage points lower and many years of the loan remain. Count every fee (processing, legal, valuation, stamp duty on the new agreement) and check how many months it takes to earn them back.'],
    ['Should I ask my current bank to lower my rate first?', 'Yes. Many banks will reprice an existing loan to a lower rate for a fee, which can be cheaper and quicker than moving to a new bank.'],
    ['Does a balance transfer affect my credit score?', 'The new lender will check your credit, which can cause a small, temporary dip. Paying the new loan on time matters far more.'],
  ];
  if (best) qa.unshift([`How much can I save by moving a ₹40 lakh loan at 9.5% to ${best.bankInfo.short}?`, `At ${best.bankInfo.short}'s starting rate of ${rate(best.rateFrom)}, with ${y} years left and ₹10,000 in fees, you would save about ${inr(balanceTransfer(O, oldRate, best.rateFrom, y, fees).monthly)} a month and about ${inr(balanceTransfer(O, oldRate, best.rateFrom, y, fees).net)} overall. Your actual offer may be higher than the starting rate.`]);
  return layout({
    title: 'Home Loan Balance Transfer Calculator: Savings After Fees',
    desc: 'Check if moving your home loan to another bank saves money. Enter your outstanding loan, current rate and fees to see monthly savings, total savings and the break-even point.',
    url: '/home-loan-balance-transfer-calculator/',
    crumbs: [{ name: 'Calculators', url: '/calculators/' }, { name: 'Balance transfer calculator', url: '/home-loan-balance-transfer-calculator/' }],
    jsonld: [faqLd(qa)],
    extraScript: productsScript(homeList, homeLoan),
    body: `<h1>Home Loan Balance Transfer Calculator</h1>
<p class="lead">Moving your home loan to a bank with a lower rate can cut your EMI. This shows what you would really save after fees, and how long it takes to earn the fees back.</p>
<div class="card" data-bt>
<div class="row">${field('Outstanding loan (₹)', 'outstanding', O)}${field('Your current rate (% p.a.)', 'oldRate', oldRate, '0.05')}${field('Years left', 'years', y)}</div>
<div class="row">${field('New rate (% p.a.)', 'newRate', best ? best.rateFrom : 8.5, '0.05')}${field('Total switching fees (₹)', 'fees', fees)}</div>
<div class="out" aria-live="polite"></div></div>
${rows ? `<h2>Savings at each bank's starting rate</h2>
<p class="small">Example: ₹40 lakh outstanding at ${rate(oldRate)} with ${y} years left and ₹10,000 in fees. Uses each bank's advertised starting rate, which is a best case.</p>
<div class="scroll"><table><thead><tr><th>Bank</th><th>Starting rate</th><th>Saving per month</th><th>Net saving</th><th>Fees earned back in</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
${leadForm({ loan: 'home-loan', amount: O, heading: 'Want help switching your home loan?' })}
${toolChips()}
<h2>Frequently asked questions</h2>${faqHtml(qa)}
${homeList.length ? trustBox(homeList) : ''}`,
  });
}

function amortizationPage() {
  const P = 5000000;
  const r = 8.5;
  const y = 20;
  const rowsAll = schedule(P, r, y);
  const ys = yearly(rowsAll);
  const share = (yr) => Math.round((ys[yr - 1].interest / ys[yr - 1].paid) * 100);
  const yearRows = ys.map((x) => `<tr><td>Year ${x.year}</td><td>${inr(x.principal)}</td><td>${inr(x.interest)}</td><td>${inr(x.paid)}</td><td>${inr(x.balance)}</td></tr>`).join('');
  const monthRows = rowsAll.slice(0, 12).map((x) => `<tr><td>Month ${x.m}</td><td>${inr(x.paid)}</td><td>${inr(x.principal)}</td><td>${inr(x.interest)}</td><td>${inr(x.balance)}</td></tr>`).join('');
  const qa = [
    ['What is a home loan amortization schedule?', 'It is the full list of your loan payments, showing how much of each EMI pays interest, how much repays principal, and the balance left after each payment.'],
    ['Why is most of my early EMI interest?', `Interest is charged on what you still owe, which is highest at the start. On ₹50 lakh at ${rate(r)} for ${y} years, about ${share(1)}% of what you pay in year 1 is interest, falling to about ${share(15)}% in year 15.`],
    ['How can I pay less interest?', 'Prepay when you can, especially in the early years, choose a shorter tenure if the EMI is affordable, or move to a lower rate.'],
  ];
  return layout({
    title: 'Home Loan Amortization Schedule: Month-by-Month Repayment',
    desc: 'Free home loan amortization schedule. See how each EMI splits into principal and interest, month by month and year by year, and what you still owe.',
    url: '/home-loan-amortization-schedule/',
    crumbs: [{ name: 'Calculators', url: '/calculators/' }, { name: 'Amortization schedule', url: '/home-loan-amortization-schedule/' }],
    jsonld: [faqLd(qa)],
    body: `<h1>Home Loan Amortization Schedule</h1>
<p class="lead">See exactly where every EMI goes. Change the amount, rate and tenure, then switch between a year-by-year and a month-by-month repayment schedule.</p>
${calcWidget(P, r, y)}
<h2>Repayment schedule for ₹50 lakh at ${rate(r)} over ${y} years</h2>
<div class="scroll"><table><thead><tr><th>Year</th><th>Principal</th><th>Interest</th><th>Paid</th><th>Balance left</th></tr></thead><tbody>${yearRows}</tbody></table></div>
<h2>First 12 months, month by month</h2>
<div class="scroll"><table><thead><tr><th>Month</th><th>EMI paid</th><th>Principal</th><th>Interest</th><th>Balance left</th></tr></thead><tbody>${monthRows}</tbody></table></div>
${leadForm({ loan: 'home-loan', amount: P })}
${toolChips()}
<h2>Frequently asked questions</h2>${faqHtml(qa)}`,
  });
}

function calculatorsPage() {
  return layout({
    title: titled('Loan Calculators: EMI, Eligibility, Prepayment, Transfer'),
    desc: 'Free loan calculators for India: home loan EMI, eligibility, prepayment, balance transfer and amortization schedule, plus EMI calculators for personal, car and education loans.',
    url: '/calculators/',
    crumbs: [{ name: 'Calculators', url: '/calculators/' }],
    body: `<h1>Loan calculators</h1>
<p class="lead">Free, no sign-up. Every calculator runs in your browser.</p>
<div class="grid">${TOOLS.map((t) => `<a class="lcard" href="${href(t.url)}"><span class="ico">${icon(t.icon)}</span><span><b>${esc(t.name)}</b><span>${esc(t.desc)}</span></span></a>`).join('\n')}
${loans.filter((l) => l.slug !== 'home-loan').map((l) => `<a class="lcard" href="${href(`/${l.slug}-emi-calculator/`)}"><span class="ico">${icon(l.slug)}</span><span><b>${esc(l.name)} EMI calculator</b><span>Monthly EMI, interest and repayment schedule.</span></span></a>`).join('\n')}</div>
<p>Want one of these on your own website? <a href="${href('/embed/')}">Embed our EMI calculator for free</a>.</p>`,
  });
}

function ratesPage() {
  const latest = products.map((p) => p.retrievedOn).sort().at(-1);
  const month = latest ? monthOf(latest) : '';
  const sections = loans
    .map((l) => {
      const list = forLoan(l);
      if (!list.length) return '';
      return `<h2>${esc(l.name)} interest rates</h2>
<div class="scroll"><table><thead><tr><th>Bank</th><th>Starting rate</th><th>Applies to</th><th>Checked</th></tr></thead><tbody>${list
        .map((p) => `<tr><td><span class="title-row" style="gap:8px">${avatar(p.bankInfo.short, p.bank)}<a href="${href(bankUrl(l, p))}">${esc(p.bankInfo.name)}</a></span></td><td>${rate(p.rateFrom)}</td><td style="text-align:left">${esc(p.conditions ?? 'Starting rate for eligible borrowers')}</td><td>${esc(p.retrievedOn)}</td></tr>`)
        .join('')}</tbody></table></div>`;
    })
    .join('\n');
  const changes = [...history].reverse().slice(0, 50);
  const bankName = (slug) => banks.find((b) => b.slug === slug)?.name ?? slug;
  const loanName = (slug) => loans.find((l) => l.slug === slug)?.name ?? slug;
  return layout({
    title: titled(`Bank Loan Interest Rates ${month}: All Banks`),
    desc: `All bank loan interest rates we track for ${month}: home, personal, car and education loans, with each bank's starting rate, conditions, check date and recent rate changes.`,
    url: '/loan-interest-rates/',
    crumbs: [{ name: 'All loan rates', url: '/loan-interest-rates/' }],
    body: `<h1>Bank loan interest rates ${esc(month)}</h1>
<p class="lead">Every rate we track, in one place. Each is the starting rate published on the bank's own website on the date shown.</p>
${sections}
<h2>Recent rate changes</h2>
${changes.length
  ? `<ul>${changes.map((c) => `<li>${esc(c.date)}: ${esc(bankName(c.bank))} ${esc(loanName(c.loan).toLowerCase())} rate changed from ${rate(c.from)} to ${rate(c.to)}.</li>`).join('')}</ul>`
  : '<p>No changes recorded yet. Our automated check re-reads bank websites every Monday and lists any change here.</p>'}
<p class="small">Journalists and bloggers are welcome to cite this page. Please link to it as the source.</p>
${trustBox(products)}`,
  });
}

const EMBED_SNIPPET = `<iframe src="${cfg.siteUrl}/embed/emi/" title="Home loan EMI calculator" width="100%" height="760" style="border:0;max-width:760px" loading="lazy"></iframe>
<p>Home loan EMI calculator by <a href="${cfg.siteUrl}/home-loan-emi-calculator/">${cfg.siteName}</a></p>`;

function embedInfoPage() {
  return layout({
    title: titled('Free EMI Calculator Widget for Your Website'),
    desc: 'Add a free home loan EMI calculator with repayment schedule and prepayment options to your website or blog. Copy one snippet, no sign-up.',
    url: '/embed/',
    crumbs: [{ name: 'Embed', url: '/embed/' }],
    body: `<h1>Free EMI calculator for your website</h1>
<p class="lead">Add our home loan EMI calculator, with repayment schedule and prepayment options, to your site or blog. Free, no sign-up, no tracking.</p>
<h2>Copy this code</h2>
<pre class="code"><code>${esc(EMBED_SNIPPET)}</code></pre>
<button type="button" data-copy="${esc(EMBED_SNIPPET)}">Copy code</button>
<h2>Preview</h2>
<iframe src="${href('/embed/emi/')}" title="Home loan EMI calculator preview" width="100%" height="760" style="border:1px solid var(--line);border-radius:12px;max-width:760px" loading="lazy"></iframe>
<p class="small">Please keep the credit line under the calculator. Questions or a different size? Use the contact details on the <a href="${href('/about/')}">about page</a>.</p>`,
  });
}

function embedEmiPage() {
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Home Loan EMI Calculator</title>
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="${esc(cfg.siteUrl)}/home-loan-emi-calculator/">
<style>${CSS} main{padding:4px 8px} body{background:var(--bg)}</style>
</head>
<body><main>
${calcWidget(5000000, 8.5, 20)}
<p class="small">EMI calculator by <a href="${esc(cfg.siteUrl)}/home-loan-emi-calculator/" target="_blank" rel="noopener">${esc(cfg.siteName)}</a>. Compare bank rates at <a href="${esc(cfg.siteUrl)}/home-loan/" target="_blank" rel="noopener">${esc(cfg.siteName)}</a>.</p>
</main>
<script>window.CALC={worker:${JSON.stringify(cfg.workerUrl)}};window.LOGOS={};</script>
<script src="${href('/app.js')}" defer></script>
</body></html>
`;
}

// ---------- build ----------

fs.rmSync(OUT, { recursive: true, force: true });
write('index.html', homePage());
write('about/index.html', aboutPage());
write('privacy/index.html', privacyPage());
write('calculators/index.html', calculatorsPage());
write('loan-interest-rates/index.html', ratesPage());
write('embed/index.html', embedInfoPage());
write('embed/emi/index.html', embedEmiPage());
if (homeLoan) {
  write('home-loan-eligibility-calculator/index.html', eligibilityPage());
  write('home-loan-prepayment-calculator/index.html', prepaymentPage());
  write('home-loan-balance-transfer-calculator/index.html', balanceTransferPage());
  write('home-loan-amortization-schedule/index.html', amortizationPage());
}
for (const loan of loans) {
  write(`${loan.slug}/index.html`, loanHub(loan));
  write(`${loan.slug}-emi-calculator/index.html`, calcPage(loan));
  const list = forLoan(loan);
  for (const p of list) {
    write(`${loan.slug}/${p.bank}/index.html`, bankPage(loan, p));
    for (const a of loan.pageAmountsLakh) for (const y of loan.pageTenures) write(`${emiUrl(loan, p, a, y).slice(1)}index.html`, emiPage(loan, p, a, y));
  }
  for (const [a, b] of pairs(list)) write(`${vsUrl(loan, a, b).slice(1)}index.html`, vsPage(loan, a, b));
}
write('404.html', `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Page not found | ${esc(cfg.siteName)}</title><p>Page not found. <a href="${href('/')}">Compare loan rates</a> or try the <a href="${href('/calculators/')}">calculators</a>.</p>`);
for (const v of Object.values(logoManifest)) {
  fs.mkdirSync(path.join(OUT, 'logos'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'assets', 'logos', v.file), path.join(OUT, 'logos', v.file));
}
write('app.js', fs.readFileSync(path.join(ROOT, 'src', 'client.js'), 'utf8'));
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`);
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((p) => `<url><loc>${cfg.siteUrl}${p}</loc><lastmod>${today}</lastmod></url>`)
    .join('\n')}\n</urlset>\n`,
);
write(`${cfg.indexNowKey}.txt`, cfg.indexNowKey);
write('urls.json', JSON.stringify(pages.map((p) => `${cfg.siteUrl}${p}`), null, 1));
console.log(`Built ${pages.length} pages into dist/ (${products.length} verified products, ${banks.length} banks known)`);
