import fs from 'node:fs';
import path from 'node:path';
import { emi, summary, inr, lakhLabel } from './math.js';
import { ROOT, readJson, loadData } from './data.js';

const OUT = path.join(ROOT, 'dist');
const cfg = readJson('config.json');
const { loans, banks, products } = loadData(cfg);
const today = new Date().toISOString().slice(0, 10);
const pages = [];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const href = (p) => cfg.basePath + p;
const monthOf = (d) => new Date(d).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const amt = (a) => String(a).replace('.', '-');
const rate = (r) => `${Number(r.toFixed(2))}%`;

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
<nav aria-label="Loan types">${loans.map((l) => `<a href="${href(`/${l.slug}/`)}">${esc(l.name)}</a>`).join('')}</nav></div></header>
<main>
<p class="crumbs">${trail.map((c, i) => (i === trail.length - 1 ? esc(c.name) : `<a href="${href(c.url)}">${esc(c.name)}</a>`)).join(' › ')}</p>
${body}
</main>
<footer class="small">
<p>Rates are the starting rates published on each bank's own website on the date shown, and can change without notice. Your rate depends on your credit score, income and the bank's approval. This is not financial advice or a loan offer, and we are not a bank or lender.</p>
<p><a href="${href('/about/')}">About and how we get our data</a> · <a href="${href('/privacy/')}">Privacy</a></p>
</footer>
<script>window.CALC={worker:${JSON.stringify(cfg.workerUrl)}};${extraScript}</script>
<script src="${href('/app.js')}" defer></script>
</body>
</html>
`;
}

const field = (label, name, value, step = 'any') =>
  `<div><label for="${name}">${label}</label><input type="number" inputmode="decimal" id="${name}" name="${name}" value="${value}" step="${step}" min="0"></div>`;

const calcWidget = (P, r, y) => `<div class="card" data-calc="emi">
<div class="row">${field('Loan amount (₹)', 'amount', P)}${field('Interest rate (% p.a.)', 'rate', r, '0.05')}${field('Tenure (years)', 'years', y)}</div>
<div class="out" aria-live="polite"></div></div>`;

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

const forLoan = (loan) => products.filter((p) => p.loan === loan.slug).sort((a, b) => a.rateFrom - b.rateFrom);
const bankUrl = (loan, p) => `/${loan.slug}/${p.bank}/`;
const vsUrl = (loan, a, b) => `/${loan.slug}/${a.bank}-vs-${b.bank}/`;
const emiUrl = (loan, p, a, y) => `/${loan.slug}/${p.bank}/emi-${amt(a)}-lakh-${y}-years/`;

// ---------- pages ----------

function loanHub(loan) {
  const list = forLoan(loan);
  const rows = list
    .map(
      (p, i) => `<tr><td><a href="${href(bankUrl(loan, p))}">${esc(p.bankInfo.name)}</a>${i === 0 && list.length > 1 ? '<span class="badge">Lowest rate</span>' : ''}</td><td>${rate(p.rateFrom)}</td><td>${esc(p.fee ?? 'Not stated on page')}</td><td>${esc(p.prepayment ?? 'Not stated on page')}</td><td>${p.maxTenureYears ? `${p.maxTenureYears} yrs` : '-'}</td></tr>`,
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
  return layout({
    title: `${loan.name} Interest Rates, Fees and EMI Compared${best ? `: from ${rate(best.rateFrom)}` : ''} | ${cfg.siteName}`,
    desc: `Compare ${loan.name.toLowerCase()} interest rates, processing fees and EMI across Indian banks, with the source and check date for every rate.`,
    url: `/${loan.slug}/`,
    crumbs: [{ name: loan.name, url: `/${loan.slug}/` }],
    jsonld: qa.length ? [faqLd(qa)] : [],
    noindex: !best,
    extraScript: `window.PRODUCTS=${JSON.stringify(list.map((p) => ({ slug: p.bank, name: p.bankInfo.short, rate: p.rateFrom }))).replace(/</g, '\\u003c')};`,
    body: `<h1>${esc(loan.name)} Interest Rates Compared</h1>
<p class="lead">${esc(loan.blurb)}</p>
${best ? `<div class="tiles">
<div class="tile"><span>Lowest starting rate</span><b>${rate(best.rateFrom)}</b><span>${esc(best.bankInfo.short)}</span></div>
<div class="tile"><span>EMI at that rate</span><b>${inr(emi(P, best.rateFrom, loan.defaultTenure))}</b><span>${lakhLabel(loan.defaultAmountLakh)}, ${loan.defaultTenure} years</span></div>
<div class="tile"><span>Banks compared</span><b>${list.length}</b><span>each with its source</span></div>
<div class="tile"><span>Last checked</span><b>${esc(monthOf(list.map((p) => p.retrievedOn).sort().at(-1)))}</b><span>from bank websites</span></div>
</div>` : ''}
${compare}
${stdNote}
${calcWidget(P, loan.defaultRate, loan.defaultTenure)}
${leadForm({ loan: loan.slug, amount: P, heading: `Get help choosing a ${loan.name.toLowerCase()}` })}
${vs}
${qa.length ? `<h2>Frequently asked questions</h2>${faqHtml(qa)}` : ''}`,
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
    ['Processing fee', p.fee ?? 'Not stated on the page we checked'],
    ['Prepayment', p.prepayment ?? 'Not stated on the page we checked'],
    ['Maximum tenure', p.maxTenureYears ? `${p.maxTenureYears} years` : 'Not stated on the page we checked'],
  ];
  const emiLinks = loan.pageAmountsLakh.flatMap((a) => loan.pageTenures.map((y) => `<a href="${href(emiUrl(loan, p, a, y))}">${lakhLabel(a)} for ${y} years</a>`)).join('');
  const rivals = forLoan(loan).filter((q) => q.bank !== p.bank);
  return layout({
    title: `${name} ${loan.name} Interest Rate from ${rate(p.rateFrom)}, Fees and EMI (${monthOf(p.retrievedOn)}) | ${cfg.siteName}`,
    desc: `${name} ${loan.name.toLowerCase()} starting interest rate ${rate(p.rateFrom)}, processing fee, prepayment rules and EMI for popular loan amounts. Source and check date shown.`,
    url: bankUrl(loan, p),
    crumbs: [{ name: loan.name, url: `/${loan.slug}/` }, { name: name, url: bankUrl(loan, p) }],
    jsonld: [faqLd(qa)],
    body: `<h1>${esc(name)} ${esc(loan.name)}: Interest Rate, Fees and EMI</h1>
<p>${esc(name)} advertises ${esc(loan.name.toLowerCase())} rates starting from <b>${rate(p.rateFrom)}</b> per annum. For ${lakhLabel(loan.defaultAmountLakh)} over ${loan.defaultTenure} years that is an EMI of about <b>${inr(s.emi)}</b> a month.</p>
<div class="tiles">
<div class="tile"><span>Starting rate</span><b>${rate(p.rateFrom)}</b><span>per annum</span></div>
<div class="tile"><span>EMI</span><b>${inr(s.emi)}</b><span>${lakhLabel(loan.defaultAmountLakh)}, ${loan.defaultTenure} years</span></div>
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
<h2>Frequently asked questions</h2>
${faqHtml(qa)}`,
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
  const title = `${a.bankInfo.short} vs ${b.bankInfo.short} ${loan.name}: Rates, Fees and EMI Compared | ${cfg.siteName}`;
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
<p><a href="${href(bankUrl(loan, a))}">${esc(a.bankInfo.name)} details</a> · <a href="${href(bankUrl(loan, b))}">${esc(b.bankInfo.name)} details</a></p>`,
  });
}

function calcPage(loan) {
  const P = loan.defaultAmountLakh * 100000;
  const amountRows = loan.amountsLakh
    .map((a) => `<tr><td>${lakhLabel(a)}</td>${loan.tenures.map((y) => `<td>${inr(emi(a * 100000, loan.defaultRate, y))}</td>`).join('')}</tr>`)
    .join('');
  return layout({
    title: `${loan.name} EMI Calculator India: Monthly EMI, Interest and Total Payment | ${cfg.siteName}`,
    desc: `Free ${loan.name.toLowerCase()} EMI calculator. Enter amount, rate and tenure to see monthly EMI, total interest and total payment, with a quick table for common amounts.`,
    url: `/${loan.slug}-emi-calculator/`,
    crumbs: [{ name: loan.name, url: `/${loan.slug}/` }, { name: 'EMI calculator', url: `/${loan.slug}-emi-calculator/` }],
    body: `<h1>${esc(loan.name)} EMI Calculator</h1>
<p>Enter the amount, interest rate and tenure to see your monthly EMI. To use a real bank's rate, see <a href="${href(`/${loan.slug}/`)}">${esc(loan.name.toLowerCase())} rates by bank</a>.</p>
${calcWidget(P, loan.defaultRate, loan.defaultTenure)}
<h2>EMI at ${rate(loan.defaultRate)} for common amounts</h2>
<div class="scroll"><table><thead><tr><th>Amount</th>${loan.tenures.map((y) => `<th>${y} yrs</th>`).join('')}</tr></thead><tbody>${amountRows}</tbody></table></div>
<p class="small">Illustrative rate for the table only; change it in the calculator above.</p>
${leadForm({ loan: loan.slug, amount: P })}`,
  });
}

function homePage() {
  const verified = loans.filter((l) => forLoan(l).length);
  const upcoming = loans.filter((l) => !forLoan(l).length);
  return layout({
    title: `${cfg.siteName}: Compare Loan Interest Rates, Fees and EMI`,
    desc: 'Compare home, personal, car, education and property loan rates across Indian banks, with the source and check date for every rate, plus free EMI calculators.',
    url: '/',
    extraScript: `window.QUICK=${JSON.stringify(
      Object.fromEntries(
        loans.filter((l) => forLoan(l).length).map((l) => [
          l.slug,
          {
            name: l.name,
            amount: l.defaultAmountLakh * 100000,
            years: l.defaultTenure,
            banks: forLoan(l).map((p) => ({ name: p.bankInfo.short, rate: p.rateFrom, url: href(bankUrl(l, p)) })),
          },
        ]),
      ),
    ).replace(/</g, '\\u003c')};`,
    body: `<section class="hero">
<h1>Compare loan rates across Indian banks</h1>
<p class="lead">See which bank charges less for your loan. Every rate links to the bank's own page and shows the date we checked it.</p>
<div class="card" data-quick>
<div class="row">
<div><label for="qloan">Loan type</label><select id="qloan" name="loan">${verified.map((l) => `<option value="${l.slug}">${esc(l.name)}</option>`).join('')}</select></div>
${field('Loan amount (₹)', 'amount', verified[0] ? verified[0].defaultAmountLakh * 100000 : 5000000)}
${field('Tenure (years)', 'years', verified[0] ? verified[0].defaultTenure : 20)}
</div>
<div class="out" aria-live="polite"></div>
</div>
</section>
<div class="trust">
<div><b>Every rate has a source</b>Linked to the bank's own page.</div>
<div><b>Always dated</b>We show when each rate was checked.</div>
<div><b>No guesswork</b>Rates we cannot verify are not shown.</div>
</div>
<h2>Loan rates by type</h2>
<div class="grid">
${verified.map((l) => {
  const list = forLoan(l);
  return `<a class="lcard" href="${href(`/${l.slug}/`)}"><b>${esc(l.name)} rates</b><span>${list.length} bank${list.length > 1 ? 's' : ''} compared, from ${rate(list[0].rateFrom)}</span></a>`;
}).join('\n')}
</div>
${upcoming.length ? `<p class="small">More coming as we verify them: ${upcoming.map((l) => `<a href="${href(`/${l.slug}-emi-calculator/`)}">${esc(l.name)} EMI calculator</a>`).join(' · ')}</p>` : ''}
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
<p>Each rate is taken from the bank's own website. We show the source link and the date we checked it. A rate is published only if it has an official source and was checked within the last ${cfg.maxAgeDays} days. If the bank's page is unclear or contradicts itself, we hold the rate back until it is confirmed.</p>
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

// ---------- build ----------

fs.rmSync(OUT, { recursive: true, force: true });
write('index.html', homePage());
write('about/index.html', aboutPage());
write('privacy/index.html', privacyPage());
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
write('404.html', `<!doctype html><meta charset="utf-8"><title>Not found</title><p>Page not found. <a href="${href('/')}">Home</a></p>`);
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
