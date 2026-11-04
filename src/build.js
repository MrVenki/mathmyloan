import fs from 'node:fs';
import path from 'node:path';
import { emi, summary, schedule, yearly, loanForEmi, maxEmiFor, balanceTransfer, flatEmi, flatToReducing, ltvFor, maxLoanForValue, stampDuty, calendarYearly, monthLabel, inr, lakhLabel } from './math.js';
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
// "₹7.47 lakh" / "₹1.2 crore" for headline figures.
const lakhShort = (n) => {
  const trim = (x) => x.toFixed(2).replace(/\.?0+$/, '');
  if (n >= 1e7) return `₹${trim(n / 1e7)} crore`;
  if (n >= 1e5) return `₹${trim(n / 1e5)} lakh`;
  return inr(n);
};
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
// Logo: a drawn ₹ on a navy tile from assets/brand/logo.svg, inlined so it needs no extra request.
const MARK = fs.readFileSync(path.join(ROOT, 'assets', 'brand', 'logo.svg'), 'utf8').trim().replace('<svg ', '<svg class="logo" width="36" height="36" aria-hidden="true" focusable="false" ')
  // The header and footer are navy, so the mark there is a white tile with a navy rupee.
  .replace('fill="#001e60"', 'fill="#ffffff"').replace('stroke="#ffffff"', 'stroke="#001e60"');
const brandLink = () => `<a class="brand" href="${href('/')}">${MARK}<span class="wm"><span class="nm">${esc(cfg.siteName).replace('My', '<em>My</em>')}</span><span class="tag">${esc(cfg.tagline)}</span></span></a>`;
// Browser tab, bookmark, home-screen and search-result icons (Google wants 48px or larger).
const ICON_LINKS = `<link rel="icon" href="${href('/favicon.ico')}" sizes="32x32 48x48">
<link rel="icon" href="${href('/favicon.svg')}" type="image/svg+xml">
<link rel="icon" href="${href('/icon-192.png')}" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${href('/apple-touch-icon.png')}">
<link rel="manifest" href="${href('/site.webmanifest')}">
<meta name="theme-color" content="#001e60">`;

const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap';
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// "On this page": gives each plain <h2> an id and puts jump links before the first one.
function withToc(body) {
  const items = [];
  const out = body.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, text) => {
    let id = slugify(text) || `section-${items.length + 1}`;
    while (items.some((i) => i.id === id)) id += '-2';
    items.push({ id, text: text.replace(/<[^>]+>/g, '') });
    return `<h2 id="${id}">${text}</h2>`;
  });
  if (items.length < 3) return out;
  const toc = `<nav class="toc" aria-label="On this page"><span>On this page</span>${items.map((i) => `<a href="#${i.id}">${i.text}</a>`).join('')}</nav>`;
  // Right after the intro paragraph when there is one, so it is seen before scrolling.
  const lead = out.indexOf('<p class="lead">');
  if (lead >= 0) {
    const end = out.indexOf('</p>', lead) + 4;
    return `${out.slice(0, end)}\n${toc}${out.slice(end)}`;
  }
  return out.replace(/<h2 id=/, `${toc}\n<h2 id=`);
}

// Trust line under a rate page's heading; the date is when the rates on the page were checked.
const metaLine = (updated) =>
  `<p class="meta-line"><span>Updated ${esc(fmtDate(updated))}</span><span>Rates from official bank websites</span><a href="${href('/about/')}">How we check rates</a></p>`;

function footer() {
  const col = (title, links) => `<div><p class="fh">${esc(title)}</p><ul>${links.map(([u, t]) => `<li><a href="${href(u)}">${esc(t)}</a></li>`).join('')}</ul></div>`;
  return `<footer class="site"><div class="wrap">
<div class="fgrid">
<div class="fbrand">${brandLink()}
<p>Compare loan interest rates from Indian banks, each checked on the bank's own website and dated.</p></div>
${col('Loan rates', [...loans.map((l) => [`/${l.slug}/`, `${l.name} rates`]), ['/loan-interest-rates/', 'All bank loan rates']])}
${col('Calculators', [...TOOLS.map((t) => [t.url, t.name.replace(/^Home loan /, '').replace(/^./, (c) => c.toUpperCase())]), ['/calculators/', 'All calculators']])}
${col('Company', [['/about/', 'About and how we check rates'], ['/embed/', 'Free calculator for your website'], ['/privacy/', 'Privacy policy']])}
</div>
<p class="fine">© ${new Date().getUTCFullYear()} ${esc(cfg.siteName)}. Rates are the starting rates published on each bank's own website on the date shown, and can change without notice. Your rate depends on your credit score, income and the bank's approval. This is not financial advice or a loan offer, and we are not a bank or lender.</p>
</div></footer>`;
}

function layout({ title, desc, url, body, crumbs = [], jsonld = [], extraScript = '', noindex = false, updated = null, toc = false }) {
  if (!noindex) pages.push({ url, lastmod: updated ?? today });
  if (toc) body = withToc(body);
  const trail = [{ name: 'Home', url: '/' }, ...crumbs];
  // The call-back buttons jump to this page's form, or to the home loan page's form.
  const callbackHref = body.includes('data-lead') ? '#callback' : href('/home-loan/#callback');
  const ld = [
    ...jsonld,
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: cfg.siteUrl + c.url })),
    },
    ...(updated
      ? [{ '@context': 'https://schema.org', '@type': 'WebPage', name: title, url: cfg.siteUrl + url, dateModified: updated, inLanguage: 'en-IN', isPartOf: { '@type': 'WebSite', name: cfg.siteName, url: `${cfg.siteUrl}/` } }]
      : []),
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
<meta property="og:url" content="${esc(cfg.siteUrl + url)}">
<meta property="og:site_name" content="${esc(cfg.siteName)}">
<meta property="og:locale" content="en_IN">
<meta property="og:image" content="${esc(cfg.siteUrl)}/icon-512.png">
<meta name="twitter:card" content="summary">
${updated ? `<meta property="article:modified_time" content="${updated}">` : ''}
${ICON_LINKS}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="${FONT_CSS}" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="${FONT_CSS}"></noscript>
<style>${CSS}</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>
<body>
<header class="top"><div class="wrap">${brandLink()}
<nav id="main-nav" aria-label="Main">${loans.map((l) => `<a href="${href(`/${l.slug}/`)}">${esc(l.name)}</a>`).join('')}<a href="${href('/calculators/')}">Calculators</a><a href="${href('/loan-interest-rates/')}">All rates</a></nav>
<a class="cta-top" href="${callbackHref}">Free call back</a>
<button type="button" class="menu-btn" aria-expanded="false" aria-controls="main-nav" aria-label="Open menu"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg></button></div></header>
<noscript><style>#main-nav{display:flex!important}.menu-btn{display:none!important}</style></noscript>
${ticker()}
<main>
${url === '/' ? '' : `<p class="crumbs">${trail.map((c, i) => (i === trail.length - 1 ? esc(c.name) : `<a href="${href(c.url)}">${esc(c.name)}</a>`)).join(' › ')}</p>`}
${body}
</main>
${footer()}
<div class="mbar"><a href="${href('/home-loan-eligibility-calculator/')}">Eligibility</a><a class="go" href="${callbackHref}">Free call back</a></div>
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

const calcWidget = (P, r, y, { open = false, extraM = 0, extraY = 0, lump = 0, lumpAt = 12, view = '', sched = '' } = {}) => `<div class="card" data-calc="emi"${view ? ` data-view-default="${view}"` : ''}${sched ? ` data-sched="${sched}"` : ''}>
<div class="row">${field('Loan amount (₹)', 'amount', P)}${field('Interest rate (% p.a.)', 'rate', r, '0.05')}${field('Tenure (years)', 'years', y)}</div>
<details class="opts"${open ? ' open' : ''}><summary>Prepayment options (optional): pay extra to finish sooner</summary>
<div class="row">${field('Extra payment every month (₹)', 'extraM', extraM)}${field('Extra lump sum every year (₹)', 'extraY', extraY)}</div>
<div class="row">${field('One-time lump sum (₹)', 'lump', lump)}${field('Paid with instalment number', 'lumpAt', lumpAt, '1')}</div></details>
<div class="out" aria-live="polite"></div></div>`;

const verifiedNote = (p) =>
  `${p.effectiveFrom ? `Effective from ${esc(fmtDate(p.effectiveFrom))}. ` : ''}${p.conditions ? `${esc(p.conditions)}. ` : ''}${p.note ? esc(p.note) : ''}`;

// "How we checked" panel: the evidence behind every number on the page.
const trustBox = (list) => `<details class="trust-box">
<summary>How we checked ${list.length > 1 ? `these rates (${list.length} official sources)` : 'this rate'}</summary>
<ul>${list
  .map(
    (p) =>
      `<li>${esc(p.bankInfo.name)}: <a rel="nofollow noopener" href="${esc(p.sourceUrl)}">bank's official page</a>, checked ${esc(fmtDate(p.retrievedOn))}. ${verifiedNote(p)}</li>`,
  )
  .join('')}</ul>
<p class="small">We only publish rates we can trace to the bank's own website, and an automated check re-reads them every week. Always confirm with the bank before you apply. <a href="${href('/about/')}">Read our method</a>.</p>
</details>`;

// Rate strip under the header: every verified home loan rate, linked to its bank page.
function ticker() {
  if (!homeList.length) return '';
  return `<div class="ticker"><div class="wrap"><span class="lbl">Home loan starting rates</span>${homeList
    .map((p) => `<a href="${href(bankUrl(homeLoan, p))}">${esc(p.bankInfo.short)} <b>${p.rateFrom.toFixed(2)}%</b></a>`)
    .join('')}</div></div>`;
}

const leadForm = ({ loan = '', bank = '', amount = '', heading = 'Want a call back about this loan?' } = {}) => `<form class="card lead-card" id="callback" data-lead data-loan="${esc(loan)}" data-bank="${esc(bank)}">
<h2 style="margin-top:0">${esc(heading)}</h2>
<p class="small">Share your details and a partner lender or loan advisor may call you. No fee from us.</p>
<div class="row row4">
<div><label for="lname">Name</label><input type="text" id="lname" name="name" autocomplete="name" maxlength="80"></div>
<div><label for="lphone">Mobile number</label><input type="tel" id="lphone" name="phone" autocomplete="tel" inputmode="tel" maxlength="16"></div>
<div><label for="lcity">City</label><input type="text" id="lcity" name="city" autocomplete="address-level2" maxlength="60"></div>
${field('Loan amount (₹)', 'amount', amount)}
</div>
<div class="hp"><label>Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<label style="display:flex;gap:8px;align-items:flex-start;color:var(--fg)"><input type="checkbox" name="consent" style="margin-top:4px">
<span class="small">I agree to be contacted by phone, SMS or WhatsApp by partner lenders or loan advisors about loans, and to my details being shared with them. See the <a href="${href('/privacy/')}">privacy policy</a>.</span></label>
<button type="submit">Request a call back</button>
<p class="secure"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>Shared only with partner lenders or loan advisors, and only with your consent.</p>
<p class="msg small" aria-live="polite"></p>
</form>`;

const faqLd = (qa) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});
const faqHtml = (qa) => `<div class="faq">${qa.map(([q, a]) => `<details><summary><h3>${esc(q)}</h3></summary><p>${esc(a)}</p></details>`).join('\n')}</div>`;
const sourceLine = (p) => `Source: <a rel="nofollow noopener" href="${esc(p.sourceUrl)}">${esc(p.bankInfo.name)} official page</a>, checked ${esc(fmtDate(p.retrievedOn))}.`;
const stdNote = '<p class="note-line">Figures use each bank\'s advertised <b>starting</b> rate, a best case. Your rate depends on your credit score, income and loan size.</p>';

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
    ? `<span class="av has-logo"><img src="${esc(logoMap[slug])}" alt="${esc(name)} logo" width="64" height="28" loading="lazy" decoding="async"></span>`
    : `<span class="av" style="--h:${hueOf(name)}">${esc(initialsOf(name))}</span>`;

const forLoan = (loan) => products.filter((p) => p.loan === loan.slug).sort((a, b) => a.rateFrom - b.rateFrom);
const bankUrl = (loan, p) => `/${loan.slug}/${p.bank}/`;
const vsUrl = (loan, a, b) => `/${loan.slug}/${a.bank}-vs-${b.bank}/`;
const emiUrl = (loan, p, a, y) => `/${loan.slug}/${p.bank}/emi-${amt(a)}-lakh-${y}-years/`;

// Schedules start with this month's EMI, so years and months are real calendar dates.
const yearCell = (y) => (y.months < 12 ? `${y.year} <span class="small">(${y.months} mo)</span>` : String(y.year));
const scheduleStartNote = `First EMI in ${monthLabel(1, today)}. Years are calendar years, so the first and last may be part-years.`;

// ---------- pages ----------

// Slider ranges for the loan planner (amount in rupees, tenure in years).
const PLAN_RANGE = {
  'home-loan': { min: 500000, max: 30000000, step: 100000, ymax: 30 },
  'personal-loan': { min: 50000, max: 4000000, step: 10000, ymax: 7 },
  'car-loan': { min: 100000, max: 5000000, step: 10000, ymax: 7 },
  'education-loan': { min: 100000, max: 15000000, step: 50000, ymax: 15 },
  'loan-against-property': { min: 500000, max: 50000000, step: 100000, ymax: 20 },
};

// Guide text for each loan type: practical steps, and what sets the rate. Kept factual and general;
// bank-specific facts come from the verified rate data.
const GUIDES = {
  'home-loan': {
    tips: [
      ['Check your credit score first.', 'The lowest advertised home loan rates are usually for scores of 750 to 800 and above.'],
      ['Put more money down.', 'Some banks quote their best rate only when the loan is up to 80% of the property value.'],
      ['Consider a woman co-borrower.', 'Several banks, including Central Bank of India and Canara Bank, list lower rates for women borrowers.'],
      ['Ask about the processing fee and festive waivers.', 'Fees of 0.25% to 0.5% are common, and some banks waive them for a limited period.'],
    ],
    decides: 'Home loans are floating-rate loans linked to the bank\'s benchmark, usually the repo-linked lending rate. On top of that the bank adds a spread based on your credit score, income, the loan amount and the share of the property value you borrow. If rates fall later, you can ask your bank to reprice or move the loan to another bank.',
  },
  'personal-loan': {
    tips: [
      ['Check your credit score first.', 'The lowest advertised personal loan rates are for scores of 750 to 800 and above.'],
      ['Start with the bank that holds your salary account.', 'Bank of Baroda, Canara Bank and Bank of Maharashtra quote their best rates to existing salary customers.'],
      ['Compare the fee as well as the rate.', 'A 2% processing fee on ₹5 lakh is ₹10,000, which can outweigh a small rate difference.'],
      ['Choose the shortest tenure you can afford.', 'Interest falls sharply as the tenure shortens.'],
    ],
    decides: 'Personal loans are unsecured, so the bank prices your own risk: credit score and repayment history, monthly income, your employer\'s category and the EMIs you already pay. The advertised rate is the floor; most borrowers are offered more.',
  },
  'car-loan': {
    tips: [
      ['Check your credit score first.', 'Most banks link car loan rates to your score, with the lowest at 750 to 800 and above.'],
      ['Look at electric-car rates.', 'Banks such as Punjab National Bank and Union Bank of India list lower rates for electric cars.'],
      ['Compare a dealer\'s flat rate properly.', 'A flat rate looks lower than it is; convert it with the flat vs reducing rate calculator.'],
      ['Keep the tenure short.', 'A car loses value quickly, and a shorter loan costs far less interest.'],
    ],
    decides: 'Car loans are secured on the car, so rates are lower than for personal loans. The bank looks at your credit score, income, whether the car is new or used, the loan amount and the tenure.',
  },
  'education-loan': {
    tips: [
      ['Check whether your institute is on a premier list.', 'The lowest rates, around 7%, are for top-rated institutes under schemes such as PM Vidyalaxmi.'],
      ['Compare loans above and below ₹7.5 lakh.', 'Banks price these differently, and larger loans usually need collateral.'],
      ['Ask about concessions.', 'Some banks, such as Union Bank of India and Central Bank of India, give women students a lower rate.'],
      ['Plan for interest during the course.', 'Interest usually builds up during the study period and grace period before EMIs start.'],
    ],
    decides: 'Education loan rates depend mostly on the institute and course, the loan amount, whether there is collateral or a guarantee, and the co-borrower\'s credit profile. Rates for listed premier institutes are much lower than general rates.',
  },
  'loan-against-property': {
    tips: [
      ['Pledge a self-occupied home if you can.', 'Banks such as Union Bank of India charge less against a self-occupied residential property than against commercial or rented property.'],
      ['Borrow less against the property.', 'The lowest rates often need the property to be worth two to three times the loan.'],
      ['Check your credit score first.', 'Most banks link the rate to your score, with the best at 750 to 800 and above.'],
      ['Watch the loan size.', 'Some banks charge more on smaller loans; Federal Bank, for example, adds 1% below ₹35 lakh.'],
    ],
    decides: 'A loan against property is secured on a house or commercial property you own. The rate depends on the type of property, how much you borrow against its value, your credit score and income, and the tenure.',
  },
};

function loanHub(loan) {
  const list = forLoan(loan);
  const P = loan.defaultAmountLakh * 100000;
  const y = loan.defaultTenure;
  const best = list[0];
  const latest = best ? list.map((p) => p.retrievedOn).sort().at(-1) : null;
  const month = best ? monthOf(latest) : '';
  const ln = loan.name.toLowerCase();
  if (!best) {
    return layout({
      title: titled(`${loan.name} Interest Rates in India`),
      desc: `Compare ${ln} interest rates, processing fees and EMI across Indian banks.`,
      url: `/${loan.slug}/`,
      crumbs: [{ name: loan.name, url: `/${loan.slug}/` }],
      noindex: true,
      body: `<h1>${esc(loan.name)} Interest Rates</h1><p class="note">We are still verifying bank rates for this loan type, so none are listed yet. The calculator below works for any rate.</p>${calcWidget(P, loan.defaultRate, y)}`,
    });
  }
  const top = list.at(-1);
  const e1 = emi(P, best.rateFrom, y);
  const e2 = emi(P, top.rateFrom, y);
  const g = GUIDES[loan.slug] ?? GUIDES['personal-loan'];
  const qa = [
    [`Which bank has the lowest ${ln} interest rate?`, `Among the ${list.length} banks we checked, ${best.bankInfo.name} advertises the lowest starting rate at ${rate(best.rateFrom)} per annum (checked ${best.retrievedOn}). The rate you are offered can be higher.`],
    [`What is the EMI on a ${lakhLabel(loan.defaultAmountLakh)} ${ln} for ${y} years?`, `About ${inr(e1)} a month at ${rate(best.rateFrom)}, and about ${inr(e2)} at ${rate(top.rateFrom)}.`],
    ['How often are these rates checked?', 'An automated check re-reads every bank\'s official rate page each week, and each rate shows the date it was checked.'],
  ];
  const answer = `The lowest ${esc(ln)} rate this month is <b>${rate(best.rateFrom)} a year</b> at ${esc(best.bankInfo.name)}${best.conditions ? ` (${esc(best.conditions.charAt(0).toLowerCase() + best.conditions.slice(1))})` : ''}. Starting rates run from ${rate(best.rateFrom)} to ${rate(top.rateFrom)} across ${list.length} banks. On ${lakhLabel(loan.defaultAmountLakh)} over ${y} years that is an EMI of about <b>${inr(e1)} to ${inr(e2)}</b> a month.`;
  const vs = popularPairs(list, 12);
  return layout({
    title: titled(`${loan.name} Interest Rates ${month}: Lowest ${rate(best.rateFrom)}, ${list.length} Banks`),
    desc: `Best ${ln} interest rates for ${month}: lowest starting rate ${rate(best.rateFrom)} (${best.bankInfo.short}). Compare EMI, processing fees and prepayment across ${list.length} banks, each with its source.`,
    url: `/${loan.slug}/`,
    crumbs: [{ name: loan.name, url: `/${loan.slug}/` }],
    jsonld: [faqLd(qa)],
    updated: latest,
    extraScript: `window.PLANNER=${JSON.stringify({ name: loan.name, slug: loan.slug, own: loan.defaultRate, banks: list.map((p) => ({ name: p.bankInfo.name, short: p.bankInfo.short, rate: p.rateFrom })) }).replace(/</g, '\\u003c')};`,
    body: `<div class="phead"><div class="phead-t">
<h1>${esc(loan.name)} Interest Rates ${esc(month)}: Compare ${list.length} Banks</h1>
<p class="meta-line"><span>Updated ${esc(fmtDate(latest))}</span><span>By MathMyLoan research team</span><span>Rates from ${list.length} official bank websites</span><a href="${href('/about/')}">How we check rates</a></p>
</div><div class="phead-dl"><button type="button" class="dl-report" data-pdf data-pdf-target="[data-planner]"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Download report</button><span class="small pdf-note" aria-live="polite"></span></div></div>
${planner(loan, list, P, y)}
<h2 id="banks">${esc(loan.name)} rates from ${list.length} banks</h2>
<p class="small">Each bank's advertised starting rate, checked on its own website. Choose a bank to load its numbers into the planner.</p>
${plannerBanks(loan, list, P, y)}
<div class="guide"><article class="guide-main">
<h2>Your guide to ${esc(ln)} rates</h2>
<div class="answer"><p class="k">Quick answer</p><p>${answer}</p></div>
<h3>How to get the lowest ${esc(ln)} rate</h3>
<ol class="tips">${g.tips.map(([b, t]) => `<li><b>${esc(b)}</b> ${esc(t)}</li>`).join('')}</ol>
<h3>What decides your rate</h3>
<p>${esc(g.decides)}</p>
<h2>Frequently asked questions</h2>
${faqHtml(qa)}
${leadForm({ loan: loan.slug, amount: P, heading: `Get help choosing a ${ln}` })}
</article><aside class="guide-side">
<div class="gbox"><b>Not sure which bank?</b><p class="small">A partner lender or advisor can call you back. No fee from us.</p><a class="btn" href="#callback">Get a free call back</a></div>
${vs.length ? `<div class="gbox"><b>Compare two banks</b><p class="chips">${vs.map(([a, b]) => `<a href="${href(vsUrl(loan, a, b))}">${esc(a.bankInfo.short)} vs ${esc(b.bankInfo.short)}</a>`).join('')}</p></div>` : ''}
${trustBox(list)}
</aside></div>
${loanTools(loan)}`,
  });
}

// Decision centre: inputs on the left; on the right a chart pair and a comparison of the chosen rate
// against the lowest and highest bank. The numbers in the table are in the HTML; the charts are drawn by app.js.
function planner(loan, list, P, y) {
  const R = PLAN_RANGE[loan.slug] ?? { min: 50000, max: 10000000, step: 10000, ymax: 30 };
  const low = list[0];
  const high = list.at(-1);
  const me = summary(P, low.rateFrom, y);
  const hi = summary(P, high.rateFrom, y);
  const lastEmi = (r) => monthLabel(schedule(P, r, y).length, today);
  const types = loans.filter((l) => forLoan(l).length);
  const extra = Math.max(1000, Math.round((P * 0.01) / 500) * 500);
  const cmpRows = [
    ['Monthly EMI', inr(me.emi), inr(hi.emi)],
    ['Total interest', inr(me.interest), inr(hi.interest)],
    ['Total payment', inr(me.total), inr(hi.total)],
    ['Last EMI', lastEmi(low.rateFrom), lastEmi(high.rateFrom)],
  ];
  return `<div class="dc" data-planner data-min="${R.min}" data-max="${R.max}">
<div class="lp" role="group" aria-label="Your loan details">
<div class="sec"><p class="sec-h"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>Your loan</p><div class="bd">
<div class="fld"><label for="pl-type">Loan type</label><select id="pl-type" data-nav>${types.map((l) => `<option value="${href(`/${l.slug}/`)}"${l.slug === loan.slug ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
<div class="fld"><div class="tp"><label for="pl-amt">Amount (₹)</label><input type="number" id="pl-amt" name="amount" min="${R.min}" max="${R.max * 5}" step="${R.step}" value="${P}"></div><input type="range" data-for="pl-amt" min="${R.min}" max="${R.max}" step="${R.step}" value="${P}" aria-label="Amount"><div class="rg"><span>${lakhShort(R.min)}</span><span>${lakhShort(R.max)}</span></div></div>
<div class="fld"><div class="tp"><label for="pl-yrs">Tenure (years)</label><input type="number" id="pl-yrs" name="years" min="1" max="${R.ymax}" step="1" value="${y}"></div><input type="range" data-for="pl-yrs" min="1" max="${R.ymax}" step="1" value="${y}" aria-label="Tenure"><div class="rg"><span>1 yr</span><span>${R.ymax} yrs</span></div></div>
</div></div>
<div class="sec"><p class="sec-h"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 8h.01M16 16h.01"/></svg>Interest rate</p><div class="bd" role="radiogroup" aria-label="Which rate to use">
<label class="pl-opt on"><input type="radio" name="pl-mode" value="lowest" checked><span><b>Lowest available rate</b><small>${esc(low.bankInfo.name)} · ${low.rateFrom.toFixed(2)}%</small></span></label>
<label class="pl-opt"><input type="radio" name="pl-mode" value="bank"><span><b>Choose a bank</b><select name="pl-bank" aria-label="Bank">${list.map((p, i) => `<option value="${i}">${esc(p.bankInfo.short)} · ${p.rateFrom.toFixed(2)}%</option>`).join('')}</select></span></label>
<label class="pl-opt"><input type="radio" name="pl-mode" value="own"><span><b>Enter my own rate</b><input type="number" name="pl-own" min="1" max="40" step="0.05" value="${loan.defaultRate}" aria-label="Your rate, percent a year"></span></label>
</div></div>
<div class="sec"><p class="sec-h"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Prepayment</p><div class="bd">
<label class="pl-sw"><span>Pay extra every month</span><input type="checkbox" name="pl-pp"></label>
<div class="fld" data-ppbox hidden><div class="tp"><label for="pl-extra">Extra per month (₹)</label><input type="number" id="pl-extra" name="pl-extra" min="0" step="500" value="${extra}"></div></div>
<p class="pl-hint">Figures use each bank's advertised starting rate, a best case. Your rate depends on your credit score, income and loan size.</p>
</div></div>
</div>
<div class="rp" aria-live="polite">
<p class="viewing">Viewing</p>
<div class="vt"><p class="vt-h">EMI summary</p><span class="pl-chip best" data-chip>${esc(low.bankInfo.short)} · ${low.rateFrom.toFixed(2)}% · lowest of ${list.length} banks</span></div>
<div class="charts" aria-hidden="true">
<div class="pl-donut"><svg viewBox="0 0 200 200" data-donut></svg><p class="lgd"><span><i class="ip"></i>Principal</span><span><i class="ii"></i>Interest</span></p></div>
<div class="pl-bars"><p class="ctitle">Payments by calendar year</p><svg viewBox="0 0 520 240" data-bars></svg><p class="lgd"><span><i class="ip sq"></i>Principal</span><span><i class="ii sq"></i>Interest</span></p></div>
</div>
<div class="cmp"><table><thead><tr><th></th><th class="sel" data-col="me">Your choice<br>${low.rateFrom.toFixed(2)}%</th><th class="hide-sm">Lowest rate<br>${low.rateFrom.toFixed(2)}%</th><th>Highest rate<br>${high.rateFrom.toFixed(2)}%</th></tr></thead>
<tbody data-cmp>${cmpRows.map(([k, a, b]) => `<tr><td>${k}</td><td class="sel">${a}</td><td class="hide-sm">${a}</td><td>${b}</td></tr>`).join('')}</tbody></table></div>
<p class="pl-save" data-save>This choice saves <b>${inr(hi.interest - me.interest)}</b> in interest compared with the highest-rate bank.</p>
</div></div>`;
}

// Every bank, with its rate and conditions as text and a link to its own page; app.js keeps the EMI columns
// in step with the planner and lets a row load that bank.
function plannerBanks(loan, list, P, y) {
  const facts = (p) => [p.fee && `Fee: ${p.fee}`, p.prepayment && `Prepayment: ${p.prepayment}`, p.maxTenureYears && `Up to ${p.maxTenureYears} years`].filter(Boolean).join(' · ');
  return `<div class="scroll pl-banks"><table><thead><tr><th>Bank</th><th>Starts at</th><th data-emi-head>EMI · ${lakhLabel(P / 100000)}, ${y} yrs</th><th class="hide-sm">Total interest</th><th class="hide-sm"><span class="sr-only">Load into planner</span></th></tr></thead><tbody>${list
    .map((p, i) => {
      const s = summary(P, p.rateFrom, y);
      const f = facts(p);
      return `<tr data-i="${i}"${i === 0 ? ' class="on"' : ''}><td><div class="bk">${avatar(p.bankInfo.short, p.bank)}<span><a href="${href(bankUrl(loan, p))}">${esc(p.bankInfo.name)}</a>${i === 0 ? '<span class="badge">Lowest</span>' : ''}${p.conditions ? `<span class="cond">${esc(p.conditions)}</span>` : ''}${f ? `<span class="cond">${esc(f)}</span>` : ''}</span></div></td><td><b>${p.rateFrom.toFixed(2)}%</b></td><td data-emi>${inr(s.emi)}</td><td class="hide-sm" data-int>${inr(s.interest)}</td><td class="hide-sm"><button type="button" class="use">${i === 0 ? 'Showing' : 'Use'}</button></td></tr>`;
    })
    .join('')}</tbody></table></div>`;
}

// "Work it out": links to the dedicated calculators instead of a second full calculator on the page.
function loanTools(loan) {
  const t = [[`/${loan.slug}-emi-calculator/`, `${loan.name} EMI calculator`, 'Monthly EMI, full payment schedule and a PDF report.', loan.slug]];
  if (loan.slug === 'home-loan') {
    t.push(['/home-loan-eligibility-calculator/', 'Eligibility calculator', 'How much loan your salary can support.', 'personal-loan']);
    t.push(['/home-loan-prepayment-calculator/', 'Prepayment calculator', 'Interest and years saved by paying extra.', 'education-loan']);
    t.push(['/stamp-duty-calculator/', 'Stamp duty calculator', 'Stamp duty, registration and cash needed.', 'loan-against-property']);
  } else if (loan.slug === 'personal-loan' || loan.slug === 'car-loan') {
    t.push(['/flat-vs-reducing-interest-rate-calculator/', 'Flat vs reducing rate', 'The real rate behind a flat-rate quote.', 'car-loan']);
  }
  t.push(['/calculators/', 'All calculators', 'Every loan calculator in one place.', 'education-loan']);
  return `<h2>Work it out</h2><div class="grid tools">${t.map(([u, n, d, ic]) => `<a class="lcard" href="${href(u)}"><span class="ico">${icon(ic)}</span><span><b>${esc(n)}</b><span>${esc(d)}</span></span></a>`).join('')}</div>`;
}

function pairs(list) {
  const sorted = [...list].sort((a, b) => a.bank.localeCompare(b.bank));
  const out = [];
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) out.push([sorted[i], sorted[j]]);
  return out;
}

// The pairs people search for most: large, well-known lenders first. Bank pages link every pair.
const BIG_BANKS = ['sbi', 'hdfc-bank', 'icici-bank', 'axis-bank', 'kotak-mahindra-bank', 'punjab-national-bank', 'bank-of-baroda', 'canara-bank', 'union-bank-of-india'];
const bigRank = (p) => (BIG_BANKS.includes(p.bank) ? BIG_BANKS.indexOf(p.bank) : 99);
const popularPairs = (list, n) => pairs(list).sort((x, y) => bigRank(x[0]) + bigRank(x[1]) - (bigRank(y[0]) + bigRank(y[1]))).slice(0, n);

function bankPage(loan, p) {
  const P = loan.defaultAmountLakh * 100000;
  const s = summary(P, p.rateFrom, loan.defaultTenure);
  const name = p.bankInfo.name;
  const all = forLoan(loan);
  const rank = all.findIndex((q) => q.bank === p.bank) + 1;
  // Only questions the bank's own page answers; "not stated" answers help nobody.
  const qa = [
    [`What is the ${name} ${loan.name.toLowerCase()} interest rate?`, `${name}'s website advertises ${loan.name.toLowerCase()} rates starting from ${rate(p.rateFrom)} per annum (checked ${p.retrievedOn}). The rate you get depends on your credit score, income and loan amount.`],
    [`What is the EMI on a ${lakhLabel(loan.defaultAmountLakh)} ${loan.name.toLowerCase()} from ${name}?`, `At the starting rate of ${rate(p.rateFrom)} over ${loan.defaultTenure} years the EMI is about ${inr(s.emi)} a month, with total interest of about ${inr(s.interest)}. A higher personal rate would raise this.`],
    ...(p.fee ? [[`What is the processing fee for a ${name} ${loan.name.toLowerCase()}?`, `${name} states: ${p.fee}.`]] : []),
    ...(p.prepayment ? [[`Does ${name} charge prepayment charges on a ${loan.name.toLowerCase()}?`, `${p.prepayment}. Terms can differ between floating and fixed rates, so confirm with the bank.`]] : []),
    ...(all.length > 1 ? [[`How does ${name} compare with other banks?`, `Its starting rate of ${rate(p.rateFrom)} is number ${rank} of the ${all.length} banks we checked for ${loan.name.toLowerCase()}s, where the lowest is ${rate(all[0].rateFrom)} (${all[0].bankInfo.name}).`]] : []),
  ];
  const specs = [
    ['Starting interest rate', `${rate(p.rateFrom)} per annum`],
    ...(p.conditions ? [['Applies to', p.conditions]] : []),
    ...(p.effectiveFrom ? [['Effective from', fmtDate(p.effectiveFrom)]] : []),
    ...(p.fee ? [['Processing fee', p.fee]] : []),
    ...(p.prepayment ? [['Prepayment', p.prepayment]] : []),
    ...(p.maxTenureYears ? [['Maximum tenure', `${p.maxTenureYears} years`]] : []),
  ];
  const missing = [!p.fee && 'processing fee', !p.prepayment && 'prepayment terms'].filter(Boolean);
  // EMI table: every amount and tenure we have a page for, each figure linking to that page's full schedule.
  const emiGrid = `<div class="scroll"><table class="emi-grid"><thead><tr><th>Loan amount</th>${loan.pageTenures.map((y) => `<th>${y} years</th>`).join('')}</tr></thead><tbody>${loan.pageAmountsLakh
    .map((a) => `<tr><td>${lakhLabel(a)}</td>${loan.pageTenures.map((y) => `<td><a href="${href(emiUrl(loan, p, a, y))}">${inr(emi(a * 100000, p.rateFrom, y))}<span class="sr-only"> a month for ${lakhLabel(a)} over ${y} years</span></a></td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>
<p class="small">EMI per month at ${rate(p.rateFrom)}. Tap a figure for its full repayment schedule.</p>`;
  const rivals = all.filter((q) => q.bank !== p.bank);
  return layout({
    title: titled(`${p.bankInfo.short} ${loan.name} Interest Rate ${monthOf(p.retrievedOn)}: ${rate(p.rateFrom)} Onwards`),
    desc: `${name} ${loan.name.toLowerCase()} interest rate for ${monthOf(p.retrievedOn)} starts at ${rate(p.rateFrom)} p.a. See EMI for ${lakhLabel(loan.defaultAmountLakh)}, processing fee, prepayment rules and how it compares with other banks.`,
    url: bankUrl(loan, p),
    crumbs: [{ name: loan.name, url: `/${loan.slug}/` }, { name: name, url: bankUrl(loan, p) }],
    jsonld: [faqLd(qa)],
    updated: p.retrievedOn,
    toc: true,
    body: `<div class="title-row">${avatar(p.bankInfo.short, p.bank)}<h1 style="margin:0">${esc(name)} ${esc(loan.name)} Interest Rate ${esc(monthOf(p.retrievedOn))}</h1></div>
${metaLine(p.retrievedOn)}
<p class="lead">${esc(name)} advertises ${esc(loan.name.toLowerCase())} rates starting from <b>${rate(p.rateFrom)}</b> per annum. For ${lakhLabel(loan.defaultAmountLakh)} over ${loan.defaultTenure} years that is an EMI of about <b>${inr(s.emi)}</b> a month.</p>
<div class="tiles">
<div class="tile"><span>Starting rate</span><b>${rate(p.rateFrom)}</b><span>per annum</span></div>
<div class="tile"><span><abbr title="Equated Monthly Instalment: the fixed amount you pay the bank every month">EMI</abbr> per month</span><b>${inr(s.emi)}</b><span>${lakhLabel(loan.defaultAmountLakh)}, ${loan.defaultTenure} years</span></div>
<div class="tile"><span>Total interest</span><b>${inr(s.interest)}</b><span>over the full term</span></div>
${all.length > 1 ? `<div class="tile"><span>Rank by rate</span><b>#${rank} of ${all.length}</b><span><a href="${href(`/${loan.slug}/`)}">banks we checked</a></span></div>` : ''}
</div>
<h2>${esc(p.bankInfo.short)} ${esc(loan.name.toLowerCase())} rates and charges</h2>
<div class="scroll"><table class="specs"><tbody>${specs.map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:left">${esc(v)}</td></tr>`).join('')}</tbody></table></div>
<p class="small">${sourceLine(p)}${missing.length ? ` The page did not state the ${missing.join(' or ')}; confirm with the bank.` : ''}</p>
${stdNote}
<h2>${esc(p.bankInfo.short)} ${esc(loan.name.toLowerCase())} EMI calculator</h2>
${calcWidget(P, p.rateFrom, loan.defaultTenure, { sched: 'closed' })}
<h2>EMI for popular amounts</h2>
${emiGrid}
${rivals.length ? `<h2>Compare ${esc(name)} with other banks</h2><p class="chips">${rivals.map((q) => { const [a, b] = [p, q].sort((x, y) => x.bank.localeCompare(y.bank)); return `<a href="${href(vsUrl(loan, a, b))}"><span class="chip-self">${esc(p.bankInfo.short)} </span>vs ${esc(q.bankInfo.short)} <span class="chip-rate">${rate(q.rateFrom)}</span></a>`; }).join('')}</p>` : ''}
${leadForm({ loan: loan.slug, bank: p.bank, amount: P, heading: `Get a call back about a ${name} ${loan.name.toLowerCase()}` })}
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
  const yearRows = calendarYearly(schedule(P, p.rateFrom, years), today)
    .map((y) => `<tr><td>${yearCell(y)}</td><td>${inr(y.principal)}</td><td>${inr(y.interest)}</td><td class="opt">${inr(y.paid)}</td><td>${inr(y.balance)}</td></tr>`)
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
    updated: p.retrievedOn,
    body: `<h1>${esc(name)} ${esc(lakhLabel(lakh))} ${esc(loan.name)} EMI for ${years} Years</h1>
${metaLine(p.retrievedOn)}
<p class="lead">At the advertised starting rate of <b>${rate(p.rateFrom)}</b>, the EMI is about <b>${inr(s.emi)}</b> a month, with total interest of about ${inr(s.interest)}.</p>
<p class="small">${sourceLine(p)}</p>
${stdNote}
${calcWidget(P, p.rateFrom, years)}
<h2>EMI at higher rates</h2>
<div class="scroll"><table><thead><tr><th>Rate</th><th>EMI</th><th>Total interest</th><th>Total payment</th></tr></thead><tbody>${steps}</tbody></table></div>
<h2>Year-by-year repayment schedule at ${rate(p.rateFrom)}</h2>
<p class="small">How much of each year's payments goes to principal and to interest, and what you still owe at the end of the year. Use the calculator above for a month-by-month view and prepayment options. ${scheduleStartNote}</p>
<div class="scroll"><table><thead><tr><th>Year</th><th>Principal</th><th>Interest</th><th class="opt">Paid</th><th>Balance left</th></tr></thead><tbody>${yearRows}</tbody></table></div>
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
    updated: [a.retrievedOn, b.retrievedOn].sort().at(-1),
    body: `<h1>${esc(a.bankInfo.name)} vs ${esc(b.bankInfo.name)} ${esc(loan.name)}</h1>
${metaLine([a.retrievedOn, b.retrievedOn].sort().at(-1))}
<p class="lead">${esc(verdict)}</p>
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

// Server-rendered ranking (same markup the browser script redraws), so search engines and
// no-JS visitors see the comparison too.
// "Rates from SBI, HDFC Bank and ICICI Bank" for a few banks; "Rates from 12 banks, including …" for many.
function leadBanks(list) {
  const join = (names) => names.join(', ').replace(/, ([^,]*)$/, ' and $1');
  if (list.length <= 5) return `Rates from ${join(list.map((p) => p.bankInfo.short))}`;
  const famous = ['sbi', 'hdfc-bank', 'icici-bank', 'axis-bank', 'punjab-national-bank', 'kotak-mahindra-bank'];
  const picks = famous.map((slug) => list.find((p) => p.bank === slug)).filter(Boolean).slice(0, 5);
  return `Rates from ${list.length} banks, including ${join(picks.map((p) => p.bankInfo.short))},`;
}

// limit caps how many rows are drawn; the verdict still compares the cheapest and costliest of all.
function rankRowsHtml(list, P, y, limit = Infinity) {
  const rows = list
    .map((p) => {
      const s = summary(P, p.rateFrom, y);
      return { p, emi: s.emi, interest: s.interest };
    })
    .sort((a, b) => a.interest - b.interest);
  if (!rows.length) return '';
  const best = rows[0];
  const worst = rows.at(-1);
  const max = Math.max(...rows.map((r) => r.interest)) || 1;
  const verdict =
    rows.length > 1
      ? `<p class="verdict"><b>${esc(best.p.bankInfo.short)}</b> costs <b>${inr(worst.interest - best.interest)}</b> less interest than ${esc(worst.p.bankInfo.short)} over ${y} years, about <b>${inr(worst.emi - best.emi)}</b> less every month.</p>`
      : '';
  return (
    verdict +
    rows
      .slice(0, limit)
      .map((r, i) => {
        const isBest = i === 0 && rows.length > 1;
        const extra = r.interest - best.interest < 1 ? `<span class="extra">Interest ${inr(r.interest)}</span>` : `<span class="extra">+${inr(r.interest - best.interest)} more interest</span>`;
        return `<div class="rank${isBest ? ' best' : ''}">${avatar(r.p.bankInfo.short, r.p.bank)}<span class="nm"><b><a href="${href(bankUrl(r.p.loanInfo, r.p))}">${esc(r.p.bankInfo.short)}</a>${isBest ? '<span class="badge">Lowest cost</span>' : ''}</b><span class="small">EMI ${inr(r.emi)} / month</span></span><span class="px"><b class="rt">${r.p.rateFrom.toFixed(2)}%<small> p.a.</small></b>${extra}</span><span class="bar"><i style="width:${Math.max(6, Math.round((r.interest / max) * 100))}%"></i></span></div>`;
      })
      .join('')
  );
}

function homePage() {
  const verified = loans.filter((l) => forLoan(l).length);
  const upcoming = loans.filter((l) => !forLoan(l).length);
  const first = verified[0];
  const P = first ? first.defaultAmountLakh * 100000 : 5000000;
  const Y = first ? first.defaultTenure : 20;
  const firstList = first ? forLoan(first) : [];
  const best = firstList[0];
  const worst = firstList.at(-1);
  const spread = best && worst ? summary(P, worst.rateFrom, Y).interest - summary(P, best.rateFrom, Y).interest : 0;
  const bankCount = new Set(products.map((p) => p.bank)).size;
  const latest = products.map((p) => p.retrievedOn).sort().at(-1);

  // Real worked examples for the calculator cards.
  const r = homeLoan?.defaultRate ?? 8.5;
  const eligibleOn1L = loanForEmi(maxEmiFor(100000, 0, 50), r, 20);
  const base = schedule(5000000, r, 20);
  const extra5k = schedule(5000000, r, 20, 5000);
  const sumI = (rows) => rows.reduce((a, x) => a + x.interest, 0);
  const saved5k = sumI(base) - sumI(extra5k);
  const btBest = homeList[0] ? balanceTransfer(4000000, 9.5, homeList[0].rateFrom, 15, 0).monthly : 0;
  const years = yearly(base);
  const shares = years.map((x) => Math.round((x.interest / x.paid) * 100));
  const bars = shares.filter((_, i) => i % 2 === 0);

  const rangeOf = (l) => ({
    min: Math.max(50000, Math.round((l.amountsLakh[0] * 100000) / 2 / 50000) * 50000),
    max: Math.round((l.amountsLakh.at(-1) * 100000 * 1.5) / 100000) * 100000,
  });
  const quick = Object.fromEntries(
    verified.map((l) => [
      l.slug,
      {
        name: l.name,
        amount: l.defaultAmountLakh * 100000,
        years: l.defaultTenure,
        tenures: l.tenures,
        hub: href(`/${l.slug}/`),
        ...rangeOf(l),
        banks: forLoan(l).map((p) => ({ slug: p.bank, name: p.bankInfo.short, rate: p.rateFrom, url: href(bankUrl(l, p)) })),
      },
    ]),
  );
  const fr = first ? rangeOf(first) : { min: 100000, max: 20000000 };

  const qa = [
    best && [`Which bank has the lowest home loan interest rate?`, `Among the banks we checked on ${latest}, ${best.bankInfo.name} advertises the lowest starting rate at ${rate(best.rateFrom)} a year. Your own rate depends on your credit score and income.`],
    best && worst && [`What is the EMI on a ${lakhLabel(first.defaultAmountLakh)} home loan for ${Y} years?`, `About ${inr(emi(P, best.rateFrom, Y))} a month at ${rate(best.rateFrom)} and ${inr(emi(P, worst.rateFrom, Y))} at ${rate(worst.rateFrom)}.`],
    [`Are these rates guaranteed?`, `No. They are the starting rates each bank publishes for its best borrowers. Most people are offered a higher rate, so use them to shortlist banks, then ask for a quote.`],
    [`How often are the rates updated?`, `An automated check re-reads every bank's official page each week, and each rate shows the date it was checked.`],
  ].filter(Boolean);

  return layout({
    title: `Compare Loan Interest Rates and EMI in India | ${cfg.siteName}`,
    desc: `${cfg.tagline.replace(/\.$/, '')}: compare starting rates from ${new Set(products.map((p) => p.bank)).size} Indian banks, each checked on the bank's own site, and see your real EMI, eligibility and full repayment schedule.`,
    url: '/',
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'Organization', name: cfg.siteName, url: `${cfg.siteUrl}/`, logo: `${cfg.siteUrl}/icon-512.png` },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.siteName, url: `${cfg.siteUrl}/` },
      faqLd(qa),
    ],
    extraScript: `window.QUICK=${JSON.stringify(quick).replace(/</g, '\\u003c')};`,
    body: `<section class="hero"><div class="hero-grid">
<div class="copy">
<h1>Compare home loan interest rates and see your <em>real EMI</em></h1>
<p class="lead">${esc(leadBanks(firstList))} side by side. Every number links to the bank's own page, so you always know it is current.</p>
<div class="ctas"><a class="btn-lg primary" href="${href('/home-loan/')}">Compare all banks</a><a class="btn-lg ghost" href="${href('/home-loan-eligibility-calculator/')}">Check my eligibility</a></div>
<div class="hstats">
${best ? `<div><b>${best.rateFrom.toFixed(2)}%</b><span>Lowest home loan rate (${esc(best.bankInfo.short)})</span></div>` : ''}
${spread ? `<div><b>${esc(lakhShort(spread))}</b><span>Cheapest vs costliest bank on ${lakhLabel(first.defaultAmountLakh)}</span></div>` : ''}
<div><b>${bankCount} banks</b><span>Verified ${latest ? esc(monthOf(latest)) : 'this month'}</span></div>
</div>
</div>
<div class="card" data-quick>
<div class="tabs" role="tablist" aria-label="Loan type">${verified
      .map((l, i) => `<button type="button" role="tab" data-loan="${l.slug}" aria-selected="${i === 0}">${esc(l.name.replace(/ Loan$/, ''))}</button>`)
      .join('')}</div>
<div class="amt"><label for="q-amount">Loan amount</label><output for="q-amount">${inr(P)} <small>${lakhLabel(P / 100000).replace('₹', '')}</small></output></div>
<input type="range" id="q-amount" name="amount" min="${fr.min}" max="${fr.max}" step="50000" value="${P}">
<div class="small" style="font-weight:600;margin-bottom:6px">Tenure</div>
<div class="tenure" role="group" aria-label="Tenure in years">${(first?.tenures ?? [10, 15, 20, 25, 30])
      .map((t) => `<button type="button" data-years="${t}" aria-pressed="${t === Y}">${t} yrs</button>`)
      .join('')}</div>
<input type="hidden" name="years" value="${Y}">
<div class="out" aria-live="polite">${rankRowsHtml(firstList, P, Y, 5)}</div>
<a class="more" href="${href('/home-loan/')}">See all ${firstList.length} banks, fees and prepayment rules</a>
</div>
</div></section>

<section class="block">
<h2>Lowest starting rates this month</h2>
<p class="sub">From each bank's official website${latest ? `, checked ${esc(new Date(latest).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }))}` : ''}.</p>
<div class="grid">
${verified
  .map((l) => {
    const list = forLoan(l);
    return `<a class="rcard" href="${href(`/${l.slug}/`)}"><span class="k">${esc(l.name)}</span><span class="v">${list[0].rateFrom.toFixed(2)}%</span><span class="s">${esc(list[0].bankInfo.short)} · ${list.length} bank${list.length > 1 ? 's' : ''} compared</span><span class="go">Compare ${esc(l.name.toLowerCase())} rates</span></a>`;
  })
  .join('\n')}
${upcoming.map((l) => `<a class="rcard" href="${href(`/${l.slug}-emi-calculator/`)}"><span class="k">${esc(l.name)}</span><span class="v" style="font-size:1.4rem;padding:8px 0">Rates coming soon</span><span class="s">Use the EMI calculator meanwhile</span><span class="go">${esc(l.name)} EMI calculator</span></a>`).join('\n')}
</div>
</section>

<section class="block">
<h2>Calculators that answer real questions</h2>
<p class="sub">Free, instant, no sign-up.</p>
<div class="grid">
<a class="tcard" href="${href('/home-loan-eligibility-calculator/')}"><span class="ico">${icon('personal-loan')}</span><b>How much loan can I get?</b><span class="d">A ₹1 lakh net salary supports about <strong>${lakhShort(eligibleOn1L)}</strong> at ${rate(r)} over 20 years.</span><span class="go">Eligibility calculator</span></a>
<a class="tcard" href="${href('/home-loan-prepayment-calculator/')}"><span class="ico g"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg></span><b>What if I pay extra?</b><span class="d">₹5,000 more a month on ₹50 lakh saves <strong>${lakhShort(saved5k)}</strong> in interest.</span><span class="go">Prepayment calculator</span></a>
${homeList[0] ? `<a class="tcard" href="${href('/home-loan-balance-transfer-calculator/')}"><span class="ico a"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h13l-4-4"/><path d="M17 17H4l4 4"/></svg></span><b>Should I switch banks?</b><span class="d">Moving ₹40 lakh from 9.5% to ${rate(homeList[0].rateFrom)} saves about <strong>${inr(btBest)} a month</strong>.</span><span class="go">Balance transfer calculator</span></a>` : ''}
<a class="tcard" href="${href('/home-loan-amortization-schedule/')}"><span class="ico p"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg></span><b>Where does my EMI go?</b><span class="d">See every payment split into principal and interest, month by month.</span><span class="go">Amortization schedule</span></a>
</div>
</section>

<section class="insight">
<div class="copy">
<span class="k">WHY PREPAYING EARLY MATTERS</span>
<h2>${shares[0]}% of your first year's EMIs is interest</h2>
<p>On ₹50 lakh at ${rate(r)} over 20 years. The interest share falls every year, so extra payments in the early years save the most.</p>
<a class="btn-lg" href="${href('/home-loan-prepayment-calculator/')}">Try the prepayment calculator</a>
</div>
<div class="viz">
<div class="ibars" role="img" aria-label="Share of each year's payments that is interest, falling from ${shares[0]}% in year 1 to ${shares.at(-1)}% in year ${shares.length}">${bars
      .map((s) => `<div><i class="i" style="flex:${s}"></i><i class="p" style="flex:${100 - s}"></i></div>`)
      .join('')}</div>
<div class="ilbl"><span>Year 1</span><span>Year ${Math.round(shares.length / 2)}</span><span>Year ${shares.length - 1}</span></div>
<div class="ilegend"><span><i style="background:var(--amber)"></i>Interest</span><span><i style="background:#3b82f6"></i>Principal</span></div>
</div>
</section>

<section class="block">
<h2>How we check every rate</h2>
<div class="steps">
<div class="step"><em>1</em><b>Straight from the bank</b><span>We read each bank's official loan page. No third-party figures.</span></div>
<div class="step"><em>2</em><b>Source and date on every number</b><span>Each rate links to the page it came from and shows when we checked it.</span></div>
<div class="step"><em>3</em><b>Re-checked every week</b><span>Unclear or conflicting rates are held back until they are confirmed.</span></div>
</div>
</section>

${verified.flatMap((l) => (forLoan(l).length > 1 ? [`<section class="block"><h2>Popular ${esc(l.name.toLowerCase())} comparisons</h2><p class="chips">${popularPairs(forLoan(l), l.slug === 'home-loan' ? 8 : 4).map(([a, b]) => `<a href="${href(vsUrl(l, a, b))}">${esc(a.bankInfo.short)} vs ${esc(b.bankInfo.short)}</a>`).join('')}</p></section>`] : [])).join('\n')}

<section class="block faq">
<h2>Common questions</h2>
${qa.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
</section>`,
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
  { url: '/how-much-home-loan-can-i-get/', name: 'How much home loan can I get', desc: 'Salary-wise table from ₹15,000 to ₹2 lakh, bank by bank.', icon: 'personal-loan' },
  { url: '/flat-vs-reducing-interest-rate-calculator/', name: 'Flat vs reducing rate calculator', desc: 'The real rate behind a flat-rate car or personal loan quote.', icon: 'car-loan', home: false },
  { url: '/stamp-duty-calculator/', name: 'Stamp duty calculator', desc: 'State-wise stamp duty, registration fee and the cash you need upfront.', icon: 'loan-against-property' },
  { url: '/emi-calculator-excel/', name: 'EMI calculator for Excel', desc: 'Free spreadsheet with a full amortization schedule.', icon: 'education-loan', home: false },
];
const toolChips = () =>
  `<h2>Home loan calculators</h2><p class="chips">${TOOLS.filter((t) => t.home !== false).map((t) => `<a href="${href(t.url)}">${esc(t.name)}</a>`).join('')}</p>`;

function eligibilityPage() {
  const L = homeLoan;
  const r = L.defaultRate;
  const y = L.defaultTenure;
  const forIncome = (inc) => loanForEmi(maxEmiFor(inc, 0, 50), r, y);
  const rows = [25000, 40000, 50000, 75000, 100000, 150000, 200000]
    .map((inc) => `<tr><td><a href="${href(`/home-loan-for-${inc}-salary/`)}">${inr(inc)}</a></td><td>${inr(maxEmiFor(inc, 0, 50))}</td><td>${inr(forIncome(inc))}</td></tr>`)
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
    toc: true,
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
    toc: true,
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
    .map(({ p, bt }) => `<tr><td><span class="title-row" style="gap:8px">${avatar(p.bankInfo.short, p.bank)}<a href="${href(bankUrl(homeLoan, p))}">${esc(p.bankInfo.name)}</a></span></td><td class="opt">${rate(p.rateFrom)}</td><td>${inr(bt.monthly)}</td><td>${inr(bt.net)}</td><td>${bt.breakEvenMonths} mo</td></tr>`)
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
    toc: true,
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
<div class="scroll"><table><thead><tr><th>Bank</th><th class="opt">Starting rate</th><th>Saving per month</th><th>Net saving</th><th>Fees earned back in</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
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
  const yearRows = calendarYearly(rowsAll, today).map((x) => `<tr><td>${yearCell(x)}</td><td>${inr(x.principal)}</td><td>${inr(x.interest)}</td><td class="opt">${inr(x.paid)}</td><td>${inr(x.balance)}</td></tr>`).join('');
  const monthRows = rowsAll.slice(0, 12).map((x) => `<tr><td>${monthLabel(x.m, today)}</td><td class="opt">${inr(x.paid)}</td><td>${inr(x.principal)}</td><td>${inr(x.interest)}</td><td>${inr(x.balance)}</td></tr>`).join('');
  const qa = [
    ['What is a home loan amortization schedule?', 'It is the full list of your loan payments, showing how much of each EMI pays interest, how much repays principal, and the balance left after each payment.'],
    ['Why is most of my early EMI interest?', `Interest is charged on what you still owe, which is highest at the start. On ₹50 lakh at ${rate(r)} for ${y} years, about ${share(1)}% of what you pay in year 1 is interest, falling to about ${share(15)}% in year 15.`],
    ['How can I pay less interest?', 'Prepay when you can, especially in the early years, choose a shorter tenure if the EMI is affordable, or move to a lower rate.'],
  ];
  return layout({
    title: 'Home Loan Amortization Schedule: Month-by-Month Repayment',
    desc: 'Free home loan amortization schedule. See how each EMI splits into principal and interest, month by month and year by year, and what you still owe.',
    url: '/home-loan-amortization-schedule/',
    toc: true,
    crumbs: [{ name: 'Calculators', url: '/calculators/' }, { name: 'Amortization schedule', url: '/home-loan-amortization-schedule/' }],
    jsonld: [faqLd(qa)],
    body: `<h1>Home Loan Amortization Schedule</h1>
<p class="lead">See exactly where every EMI goes. Change the amount, rate and tenure, then switch between a year-by-year and a month-by-month repayment schedule.</p>
${calcWidget(P, r, y)}
<h2>Repayment schedule for ₹50 lakh at ${rate(r)} over ${y} years</h2>
<p class="small">${scheduleStartNote}</p>
<div class="scroll"><table><thead><tr><th>Year</th><th>Principal</th><th>Interest</th><th class="opt">Paid</th><th>Balance left</th></tr></thead><tbody>${yearRows}</tbody></table></div>
<h2>First 12 months, month by month</h2>
<div class="scroll"><table><thead><tr><th>Month</th><th class="opt">EMI paid</th><th>Principal</th><th>Interest</th><th>Balance left</th></tr></thead><tbody>${monthRows}</tbody></table></div>
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
<div class="scroll"><table class="stack"><thead><tr><th>Bank</th><th>Starting rate</th><th>Applies to</th><th>Checked</th></tr></thead><tbody>${list
        .map((p) => `<tr><td><span class="title-row" style="gap:8px">${avatar(p.bankInfo.short, p.bank)}<a href="${href(bankUrl(l, p))}">${esc(p.bankInfo.name)}</a></span></td><td data-label="Starting rate"><b>${rate(p.rateFrom)}</b></td><td data-label="Applies to" style="text-align:left">${esc(p.conditions ?? 'Starting rate for eligible borrowers')}</td><td data-label="Checked">${esc(fmtDate(p.retrievedOn))}</td></tr>`)
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
    updated: latest ?? null,
    toc: true,
    body: `<h1>Bank loan interest rates ${esc(month)}</h1>
${latest ? metaLine(latest) : ''}
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
${ICON_LINKS}
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

// ---------- quick-win pages from the keyword gap research ----------

const SALARIES = [15000, 20000, 25000, 30000, 35000, 40000, 50000, 60000, 75000, 100000, 150000, 200000];
const salaryLabel = (s) => (s >= 100000 ? `₹${s / 100000} lakh` : inr(s));
const salaryUrl = (s) => `/home-loan-for-${s}-salary/`;
const homeUpdated = () => homeList.map((p) => p.retrievedOn).sort().at(-1);

const eligWidget = (income) => `<div class="card" data-elig>
<div class="row">${field('Net monthly income (₹)', 'income', income)}${field('Existing EMIs per month (₹)', 'existing', 0)}${field('Interest rate (% p.a.)', 'rate', homeLoan.defaultRate, '0.05')}</div>
<div class="row">${field('Tenure (years)', 'years', 20)}${field('EMI limit (% of income)', 'foir', 50, '5')}</div>
<div class="out" aria-live="polite"></div></div>`;

function salaryPage(sal) {
  const r = homeLoan.defaultRate;
  const y = 20;
  const maxE = maxEmiFor(sal, 0, 50);
  const loan = loanForEmi(maxE, r, y);
  const home = loan / ltvFor(loan);
  const label = salaryLabel(sal);
  const banksRanked = homeList.map((p) => ({ p, amt: loanForEmi(maxE, p.rateFrom, y) })).sort((a, b) => b.amt - a.amt);
  const bankRows = banksRanked
    .map(({ p, amt }, i) => `<tr><td><span class="title-row" style="gap:8px">${avatar(p.bankInfo.short, p.bank)}<a href="${href(bankUrl(homeLoan, p))}">${esc(p.bankInfo.name)}</a></span>${i === 0 ? '<span class="badge">Highest amount</span>' : ''}</td><td>${p.rateFrom.toFixed(2)}%</td><td><b>${inr(amt)}</b></td></tr>`)
    .join('');
  const tenureRows = [15, 20, 25, 30].map((t) => `<tr><td>${t} years</td><td>${inr(loanForEmi(maxE, r, t))}</td><td>${inr(maxE)}</td></tr>`).join('');
  const existingRows = [0, 2000, 5000, 10000, 20000]
    .filter((e) => e < maxE)
    .map((e) => `<tr><td>${e ? `${inr(e)} a month` : 'None'}</td><td>${inr(maxEmiFor(sal, e, 50))}</td><td>${inr(loanForEmi(maxEmiFor(sal, e, 50), r, y))}</td></tr>`)
    .join('');
  const joint = loanForEmi(maxEmiFor(sal * 2, 0, 50), r, y);
  const top = banksRanked[0];
  const qa = [
    [`How much home loan can I get on a ${label} salary?`, `With a ${label} net monthly salary and no other EMIs, banks typically allow an EMI of up to about ${inr(maxE)}. At ${rate(r)} over ${y} years that supports a home loan of about ${inr(loan)}.`],
    [`What price of home can I buy on a ${label} salary?`, `About ${inr(home)}. Banks lend up to ${Math.round(ltvFor(loan) * 100)}% of the property value at this loan size, so you would pay about ${inr(home - loan)} yourself, plus stamp duty and registration.`],
    [`Which bank gives the highest home loan on a ${label} salary?`, `At advertised starting rates, ${top.p.bankInfo.name} supports the most, about ${inr(top.amt)}, because a lower rate means more loan for the same EMI. Your actual rate depends on your credit score.`],
    [`How can I get a bigger loan on a ${label} salary?`, `Choose a longer tenure (30 years supports about ${inr(loanForEmi(maxE, r, 30))}), add a co-applicant (with a partner earning the same, about ${inr(joint)}), close small loans first, and keep your credit score above 750.`],
  ];
  const others = SALARIES.filter((s) => s !== sal);
  return layout({
    title: `Home Loan for ${label} Salary: Up to ${lakhShort(loan)} (${monthOf(homeUpdated())})`,
    desc: `How much home loan you can get on a ${label} monthly salary: about ${lakhShort(loan)} at ${rate(r)} over 20 years, the amount at each of ${homeList.length} banks, and how tenure and existing EMIs change it.`,
    url: salaryUrl(sal),
    crumbs: [{ name: 'Home Loan', url: '/home-loan/' }, { name: 'How much can I get', url: '/how-much-home-loan-can-i-get/' }, { name: `${label} salary`, url: salaryUrl(sal) }],
    jsonld: [faqLd(qa)],
    updated: homeUpdated(),
    toc: true,
    extraScript: productsScript(homeList, homeLoan),
    body: `<h1>Home Loan for ${esc(label)} Salary</h1>
${metaLine(homeUpdated())}
<p class="lead">With a <b>${esc(label)}</b> net monthly salary and no other EMIs, you can typically get a home loan of about <b>${inr(loan)}</b> at ${rate(r)} over ${y} years, with an EMI of up to ${inr(maxE)} a month.</p>
<div class="tiles">
<div class="tile"><span>Eligible loan</span><b>${lakhShort(loan)}</b><span>at ${rate(r)}, ${y} years</span></div>
<div class="tile"><span>Maximum EMI</span><b>${inr(maxE)}</b><span>half of take-home pay</span></div>
<div class="tile"><span>Home you could buy</span><b>${lakhShort(home)}</b><span>with ${lakhShort(home - loan)} down payment</span></div>
<div class="tile"><span>With a co-applicant</span><b>${lakhShort(joint)}</b><span>if they earn the same</span></div>
</div>
<h2>Eligible loan at each bank</h2>
<p class="sub">EMI up to ${inr(maxE)} over ${y} years, at each bank's advertised starting rate (a best case).</p>
<div class="scroll"><table><thead><tr><th>Bank</th><th>Starting rate</th><th>Eligible loan</th></tr></thead><tbody>${bankRows}</tbody></table></div>
<h2>Check your own numbers</h2>
${eligWidget(sal)}
<h2>How tenure changes your loan</h2>
<div class="scroll"><table><thead><tr><th>Tenure</th><th>Eligible loan at ${rate(r)}</th><th>EMI</th></tr></thead><tbody>${tenureRows}</tbody></table></div>
<h2>If you already pay EMIs</h2>
<div class="scroll"><table><thead><tr><th>Existing EMIs</th><th>EMI left for a home loan</th><th>Eligible loan</th></tr></thead><tbody>${existingRows}</tbody></table></div>
${leadForm({ loan: 'home-loan', amount: Math.round(loan / 100000) * 100000, heading: 'Want a lender to confirm your eligibility?' })}
<h2>Frequently asked questions</h2>${faqHtml(qa)}
<h2>Home loan on other salaries</h2>
<p class="chips">${others.map((s) => `<a href="${href(salaryUrl(s))}">${esc(salaryLabel(s))} salary</a>`).join('')}</p>
${trustBox(homeList)}`,
  });
}

function howMuchPage() {
  const r = homeLoan.defaultRate;
  const per10k = loanForEmi(5000, r, 20);
  const rows = SALARIES.map((s) => {
    const l = loanForEmi(maxEmiFor(s, 0, 50), r, 20);
    return `<tr><td><a href="${href(salaryUrl(s))}">${esc(salaryLabel(s))}</a></td><td>${inr(maxEmiFor(s, 0, 50))}</td><td><b>${inr(l)}</b></td><td>${inr(l / ltvFor(l))}</td></tr>`;
  }).join('');
  const qa = [
    ['How much home loan can I get?', `Banks usually let all your EMIs together reach about 40% to 60% of your take-home pay. At 50%, ${rate(r)} and 20 years, every ₹10,000 of monthly salary supports about ${inr(per10k)} of home loan.`],
    ['How much home loan can I get on ₹50,000 salary?', `About ${inr(loanForEmi(maxEmiFor(50000, 0, 50), r, 20))} at ${rate(r)} over 20 years, if you have no other EMIs.`],
    ['Does age affect how much I can borrow?', 'Yes. Banks usually want the loan repaid by about 60 to 75 years of age, so older borrowers get shorter tenures and smaller loans for the same income.'],
    ['Does my credit score matter?', 'A score of 750 or more usually gets a lower rate, and a lower rate supports a bigger loan for the same EMI. Some banks offer their best rate only above 800.'],
  ];
  return layout({
    title: `How Much Home Loan Can I Get? Salary-Wise Table (${monthOf(homeUpdated())})`,
    desc: `How much home loan you can get on your salary: a salary-wise table from ₹15,000 to ₹2 lakh, a calculator using ${homeList.length} banks' rates, and what decides your eligibility.`,
    url: '/how-much-home-loan-can-i-get/',
    crumbs: [{ name: 'Home Loan', url: '/home-loan/' }, { name: 'How much can I get', url: '/how-much-home-loan-can-i-get/' }],
    jsonld: [faqLd(qa)],
    updated: homeUpdated(),
    toc: true,
    extraScript: productsScript(homeList, homeLoan),
    body: `<h1>How Much Home Loan Can I Get?</h1>
${metaLine(homeUpdated())}
<p class="lead">Banks usually let all your EMIs together reach about half of your take-home pay. At ${rate(r)} over 20 years, every <b>₹10,000</b> of monthly salary supports about <b>${inr(per10k)}</b> of home loan. Enter your numbers below, or find your salary in the table.</p>
${eligWidget(50000)}
<h2>Home loan by salary</h2>
<p class="sub">At ${rate(r)} for 20 years, no other EMIs, EMIs capped at 50% of take-home pay.</p>
<div class="scroll"><table><thead><tr><th>Monthly salary</th><th>Maximum EMI</th><th>Eligible loan</th><th>Home you could buy</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>What decides how much you can borrow</h2>
<ul class="clean">
<li><b>Take-home pay.</b> The bigger your net monthly income, the bigger the EMI a bank will allow.</li>
<li><b>EMIs you already pay.</b> Car, personal loan and credit card EMIs come out of the same limit.</li>
<li><b>Tenure and age.</b> A longer tenure lowers the EMI, so you can borrow more, but banks cap it by your age at the end of the loan.</li>
<li><b>Interest rate and credit score.</b> A lower rate means more loan for the same EMI. See <a href="${href('/home-loan/')}">home loan rates at ${homeList.length} banks</a>.</li>
<li><b>Property value.</b> Banks lend up to 90% of the property value for loans up to ₹30 lakh, 80% up to ₹75 lakh, and 75% above that.</li>
</ul>
<h2>How to get a bigger home loan</h2>
<ul class="clean">
<li>Add a co-applicant, such as a spouse or parent, to combine incomes.</li>
<li>Choose a longer tenure, then prepay when you can. See the <a href="${href('/home-loan-prepayment-calculator/')}">prepayment calculator</a>.</li>
<li>Close small loans and credit card balances before you apply.</li>
<li>Keep your credit score above 750 to qualify for the lowest rates.</li>
</ul>
${leadForm({ loan: 'home-loan', heading: 'Want a lender to confirm your eligibility?' })}
${toolChips()}
<h2>Frequently asked questions</h2>${faqHtml(qa)}`,
  });
}

function flatPage() {
  const tenures = [1, 2, 3, 5, 7];
  const rows = [6, 7, 8, 9, 10, 11, 12, 14]
    .map((f) => `<tr><td>${f}% flat</td>${tenures.map((t) => `<td>${flatToReducing(f, t).toFixed(2)}%</td>`).join('')}</tr>`)
    .join('');
  const P = 500000;
  const f = 10;
  const t = 3;
  const fe = flatEmi(P, f, t);
  const fi = (P * f * t) / 100;
  const re = emi(P, f, t);
  const ri = re * t * 12 - P;
  const eq = flatToReducing(f, t);
  const qa = [
    ['Is 10% flat the same as 10% reducing?', `No. On ₹5 lakh over 3 years, 10% flat costs ${inr(fi)} in interest, while 10% on a reducing balance costs ${inr(ri)}. A 10% flat rate is really about ${eq.toFixed(2)}% reducing.`],
    ['How do I convert a flat rate to a reducing rate?', 'Find the reducing rate that gives the same EMI. For tenures of 1 to 5 years the reducing rate is roughly 1.7 to 1.9 times the flat rate. The calculator above works it out exactly.'],
    ['Which is better, flat or reducing?', 'At the same headline number, a reducing rate is always cheaper, because interest is charged only on what you still owe. Always ask for the reducing-balance rate, or the APR, before you sign.'],
    ['Where are flat rates used?', 'Mostly car, two-wheeler and consumer durable loans arranged through dealers, and some personal loans from finance companies. Banks quote home loans on a reducing balance.'],
  ];
  return layout({
    title: 'Flat vs Reducing Interest Rate Calculator: Find the Real Rate',
    desc: 'Convert a flat interest rate into the real reducing-balance rate. See the true cost of car, two-wheeler and personal loans quoted at flat rates, with a conversion table.',
    url: '/flat-vs-reducing-interest-rate-calculator/',
    crumbs: [{ name: 'Calculators', url: '/calculators/' }, { name: 'Flat vs reducing rate', url: '/flat-vs-reducing-interest-rate-calculator/' }],
    jsonld: [faqLd(qa)],
    toc: true,
    body: `<h1>Flat vs Reducing Interest Rate Calculator</h1>
<p class="lead">A flat rate charges interest on the full loan for the whole term, even as you repay it, so it looks cheaper than it is. A <b>10% flat</b> rate over 3 years is really about <b>${eq.toFixed(2)}%</b> on a reducing balance. Enter the quote you were given to see the real rate.</p>
<div class="card" data-flat>
<div class="row">${field('Loan amount (₹)', 'amount', P)}${field('Flat interest rate (% p.a.)', 'flat', f, '0.05')}${field('Tenure (years)', 'years', t)}</div>
<div class="out" aria-live="polite"></div></div>
<h2>Flat rate converted to reducing rate</h2>
<p class="sub">The reducing-balance rate that gives the same EMI as each flat rate.</p>
<div class="scroll"><table><thead><tr><th>Flat rate</th>${tenures.map((x) => `<th>${x} yr${x > 1 ? 's' : ''}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
<h2>Flat vs reducing: a worked example</h2>
<div class="scroll"><table><thead><tr><th>₹5 lakh, 3 years</th><th>10% flat</th><th>10% reducing</th></tr></thead><tbody>
<tr><td>Monthly EMI</td><td>${inr(fe)}</td><td>${inr(re)}</td></tr>
<tr><td>Total interest</td><td>${inr(fi)}</td><td>${inr(ri)}</td></tr>
<tr><td>Real (reducing) rate</td><td>${eq.toFixed(2)}%</td><td>10.00%</td></tr>
</tbody></table></div>
<p>The flat quote costs <b>${inr(fi - ri)}</b> more in interest, even though both say "10%".</p>
<h2>Frequently asked questions</h2>${faqHtml(qa)}
<p><a href="${href('/car-loan/')}">Compare car loan rates</a> · <a href="${href('/personal-loan/')}">Compare personal loan rates</a> · <a href="${href('/calculators/')}">All calculators</a></p>`,
  });
}

const EXCEL_FILE = '/downloads/mathmyloan-emi-calculator.xlsx';

function excelPage() {
  const P = 5000000;
  const r = 8.5;
  const y = 20;
  const e = emi(P, r, y);
  const first = schedule(P, r, y).slice(0, 6).map((x) => `<tr><td>${monthLabel(x.m, today)}</td><td class="opt">${inr(x.paid)}</td><td>${inr(x.interest)}</td><td>${inr(x.principal)}</td><td>${inr(x.balance)}</td></tr>`).join('');
  const qa = [
    ['What is the Excel formula for EMI?', 'Use =PMT(rate/12, years*12, -loan). For ₹50 lakh at 8.5% for 20 years that is =PMT(8.5%/12, 240, -5000000), which gives about ' + inr(e) + '.'],
    ['Does the sheet work in Google Sheets?', 'Yes. In Google Sheets choose File, then Import, then Upload, and select the downloaded file. All formulas keep working.'],
    ['Is the download free?', 'Yes. No sign-up and no email needed. You can share it and use it for your own planning.'],
  ];
  return layout({
    title: 'Free EMI Calculator in Excel: Download with Amortization Schedule',
    desc: 'Download a free EMI calculator for Excel and Google Sheets: enter amount, rate and tenure to get your EMI and a full month-by-month amortization schedule with prepayments. No sign-up.',
    url: '/emi-calculator-excel/',
    crumbs: [{ name: 'Calculators', url: '/calculators/' }, { name: 'EMI calculator for Excel', url: '/emi-calculator-excel/' }],
    jsonld: [faqLd(qa)],
    toc: true,
    body: `<h1>Free EMI Calculator for Excel and Google Sheets</h1>
<p class="lead">Download a ready-made spreadsheet: type your loan amount, interest rate and tenure, and it works out your EMI, total interest and a full month-by-month repayment schedule. It also handles extra monthly prepayments. Free, no sign-up.</p>
<p><a class="btn-lg primary" href="${href(EXCEL_FILE)}" download>Download the EMI calculator (.xlsx)</a></p>
<h2>What is inside</h2>
<ul class="clean">
<li><b>EMI, total interest and total payment</b>, calculated as soon as you type.</li>
<li><b>Full amortization schedule</b> for up to 30 years, showing interest, principal and balance for every month.</li>
<li><b>Optional extra payment</b> each month, to see how much sooner you finish.</li>
<li>Works in Microsoft Excel, Google Sheets and LibreOffice.</li>
</ul>
<h2>The EMI formula in Excel</h2>
<p>Excel's PMT function gives your EMI. For a ₹50 lakh loan at 8.5% for 20 years:</p>
<pre class="code"><code>=PMT(8.5%/12, 20*12, -5000000)</code></pre>
<p>That returns about <b>${inr(e)}</b> a month. The rate is divided by 12 because EMIs are monthly, and the loan amount is negative because it is money you receive.</p>
<h2>First months of the schedule</h2>
<div class="scroll"><table><thead><tr><th>Month</th><th class="opt">EMI</th><th>Interest</th><th>Principal</th><th>Balance left</th></tr></thead><tbody>${first}</tbody></table></div>
<p class="small">₹50 lakh at 8.5% for 20 years. The download contains all ${y * 12} months.</p>
<h2>Frequently asked questions</h2>${faqHtml(qa)}
<p>Prefer not to download? Use the <a href="${href('/home-loan-emi-calculator/')}">online EMI calculator</a>, or <a href="${href('/embed/')}">add our calculator to your website</a>.</p>`,
  });
}

// ---------- stamp duty (official state rates, data/stampduty.json) ----------

const stampStates = (() => {
  let list = [];
  try {
    list = readJson('data/stampduty.json').states;
  } catch {
    return [];
  }
  // Same rule as bank rates: https official sources, checked within maxAgeDays.
  const fresh = (s) => s.sources?.length && s.sources.every((x) => /^https:\/\//.test(x.url)) && (Date.parse(today) - Date.parse(s.retrievedOn)) / 864e5 <= cfg.maxAgeDays;
  return list.filter(fresh).sort((a, b) => a.name.localeCompare(b.name));
})();
const STAMP_HUB = '/stamp-duty-calculator/';
const stampUrl = (s) => `/stamp-duty-in-${s.slug}/`;
const stampYear = new Date(today).getUTCFullYear();
const hasWomanRate = (s) => s.areas.some((a) => a.duty.some((d) => d.womanPct != null));
const pctLabel = (n) => `${Number(n.toFixed(2))}%`;
const dutyPct = (a, buyer = 'man') => a.duty.reduce((x, d) => x + (buyer === 'woman' && d.womanPct != null ? d.womanPct : d.pct), 0);
const regLabel = (r) => `${pctLabel(r.pct)}${r.add ? ` + ${inr(r.add)}` : ''}${r.max != null ? ` (max ${inr(r.max)})` : ''}`;
const sourcesHtml = (s) =>
  `<p class="small">Source: ${s.sources.map((x) => `<a rel="nofollow noopener" href="${esc(x.url)}">${esc(x.label)}</a>`).join('; ')}. Checked ${esc(fmtDate(s.retrievedOn))}.</p>`;
const stampScript = () =>
  `window.STAMP=${JSON.stringify(stampStates.map((s) => ({ slug: s.slug, name: s.name, url: href(stampUrl(s)), areas: s.areas }))).replace(/</g, '\\u003c')};`;

const stampWidget = (s, value = 5000000) => {
  const id = ++fieldId;
  return `<div class="card" data-stamp>
<div class="row"><div><label for="sd-state-${id}">State</label><select id="sd-state-${id}" name="state">${stampStates.map((x) => `<option value="${x.slug}"${x.slug === s.slug ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
<div><label for="sd-area-${id}">Where is the property?</label><select id="sd-area-${id}" name="area">${s.areas.map((a) => `<option value="${a.id}">${esc(a.label)}</option>`).join('')}</select></div></div>
<div class="row">${field('Property value (₹)', 'amount', value)}<div><label for="sd-buyer-${id}">Buyer</label><select id="sd-buyer-${id}" name="buyer"><option value="man">Man</option><option value="woman">Woman</option></select></div></div>
<div class="out" aria-live="polite"></div></div>`;
};

// Down payment the LTV slabs leave you to pay, plus stamp duty and registration.
const upfront = (area, value, buyer = 'man') => {
  const loan = maxLoanForValue(value);
  const sd = stampDuty(area, value, buyer);
  return { loan, down: value - loan, sd, cash: value - loan + sd.total };
};

const STAMP_VALUES = [2500000, 5000000, 7500000, 10000000, 20000000];

function stampStatePage(s) {
  const main = s.areas[0];
  const woman = hasWomanRate(s);
  const multi = s.areas.length > 1;
  const ex = stampDuty(main, 5000000);
  const rateRows = s.areas
    .map((a) => `<tr><td>${esc(a.label)}</td>${a.duty.map((d) => `<td>${pctLabel(d.pct)}${d.womanPct != null ? ` <span class="small">(women ${pctLabel(d.womanPct)})</span>` : ''}</td>`).join('')}<td>${regLabel(a.registration)}</td></tr>`)
    .join('');
  // With a women's column the table has five columns; phones then show only the totals.
  const opt = woman ? ' class="opt"' : '';
  const valueRows = STAMP_VALUES.map((v) => {
    const m = stampDuty(main, v);
    return `<tr><td>${lakhShort(v)}</td><td${opt}>${inr(m.duty)}</td><td${opt}>${inr(m.registration)}</td><td><b>${inr(m.total)}</b></td>${woman ? `<td>${inr(stampDuty(main, v, 'woman').total)}</td>` : ''}</tr>`;
  }).join('');
  const cashRows = STAMP_VALUES.map((v) => {
    const u = upfront(main, v);
    return `<tr><td>${lakhShort(v)}</td><td class="opt">${inr(u.loan)}</td><td>${inr(u.down)}</td><td>${inr(u.sd.total)}</td><td><b>${inr(u.cash)}</b></td></tr>`;
  }).join('');
  const u50 = upfront(main, 5000000);
  const inArea = (a) => `in a ${a.label.charAt(0).toLowerCase()}${a.label.slice(1)}`;
  const sameReg = s.areas.every((a) => regLabel(a.registration) === regLabel(main.registration));
  const intro = `${multi ? `${inArea(main).replace(/^i/, 'I')}, ` : ''}${s.name} charges ${main.duty.filter((d) => d.pct > 0).map((d) => `${pctLabel(d.pct)} ${d.label.toLowerCase()}`).join(' and ')}${woman ? ` (${pctLabel(dutyPct(main, 'woman'))} when the buyer is a woman)` : ''}, plus a registration fee of ${regLabel(main.registration)}. On a ₹50 lakh home that comes to <b>${inr(ex.total)}</b>.`;
  const qa = [
    [`What is the stamp duty in ${s.name} in ${stampYear}?`, `${intro.replace(/<[^>]+>/g, '')} Duty is charged on ${s.valueBasis}.`],
    [`What is the registration fee in ${s.name}?`, sameReg ? `${regLabel(main.registration)} of the property value${multi ? ', in every kind of area' : ''}.` : s.areas.map((a) => `${regLabel(a.registration)} of the property value ${inArea(a)}.`).join(' ')],
    woman
      ? [`Do women pay less stamp duty in ${s.name}?`, `Yes. ${s.areas.map((a) => `${multi ? `${inArea(a).replace(/^i/, 'I')}, a` : 'A'} woman buyer pays ${pctLabel(dutyPct(a, 'woman'))} instead of ${pctLabel(dutyPct(a))}.`).join(' ')} On a ₹50 lakh home that saves ${inr(ex.total - stampDuty(main, 5000000, 'woman').total)}.`]
      : [`Do women pay less stamp duty in ${s.name}?`, `No. ${s.name}'s official rates are the same for men and women buyers.`],
    ['Can I add stamp duty to my home loan?', 'Banks usually lend only against the property price, so plan to pay stamp duty and the registration fee from your own savings, along with the down payment.'],
    [`How much cash do I need to buy a ₹50 lakh home in ${s.name}?`, `A bank can lend up to ${inr(u50.loan)} (80%) on a ₹50 lakh home, leaving a ${inr(u50.down)} down payment. Add ${inr(u50.sd.total)} for stamp duty and registration and you need about ${inr(u50.cash)} of your own money.`],
  ];
  const others = stampStates.filter((x) => x.slug !== s.slug);
  return layout({
    title: `Stamp Duty in ${s.name} ${stampYear}: Rates, Registration Fee, Calculator`,
    desc: `${s.name} stamp duty and registration fee for ${stampYear} from the official state website${woman ? ', including the lower rate for women' : ''}. Calculate the amount on your property and the total cash you need.`,
    url: stampUrl(s),
    toc: true,
    updated: s.retrievedOn,
    crumbs: [{ name: 'Calculators', url: '/calculators/' }, { name: 'Stamp duty calculator', url: STAMP_HUB }, { name: s.name, url: stampUrl(s) }],
    jsonld: [faqLd(qa)],
    extraScript: stampScript(),
    body: `<h1>Stamp Duty in ${esc(s.name)} ${stampYear}</h1>
<p class="lead">${intro}</p>
<p class="meta-line"><span>Updated ${esc(fmtDate(s.retrievedOn))}</span><span>Rates from the official ${esc(s.name)} government website</span></p>
${stampWidget(s)}
<h2>Stamp duty and registration fee rates in ${esc(s.name)}</h2>
<div class="scroll"><table><thead><tr><th>Area</th>${main.duty.map((d) => `<th>${esc(d.label)}</th>`).join('')}<th>Registration fee</th></tr></thead><tbody>${rateRows}</tbody></table></div>
<p class="small">Charged on ${esc(s.valueBasis)}.</p>
${sourcesHtml(s)}
<h2>Stamp duty on common property values</h2>
<p class="small">${multi ? `${esc(main.label)}. ` : ''}${woman ? 'Total for a man buying alone, and for a woman.' : 'Same for men and women buyers.'}</p>
<div class="scroll"><table><thead><tr><th>Property value</th><th${opt}>Stamp duty</th><th${opt}>Registration</th><th>Total${woman ? ' (man)' : ''}</th>${woman ? '<th>Total (woman)</th>' : ''}</tr></thead><tbody>${valueRows}</tbody></table></div>
<h2>Total cash you need to buy a home in ${esc(s.name)}</h2>
<p>Banks lend up to 90% of the property value for loans up to ₹30 lakh, 80% up to ₹75 lakh and 75% above that. The rest, plus stamp duty and registration, comes from your own savings.</p>
<div class="scroll"><table><thead><tr><th>Property value</th><th class="opt">Most a bank can lend</th><th>Down payment</th><th>Stamp duty and registration</th><th>Cash you need</th></tr></thead><tbody>${cashRows}</tbody></table></div>
<p>Check what your salary supports with the <a href="${href('/home-loan-eligibility-calculator/')}">home loan eligibility calculator</a>, then <a href="${href('/home-loan/')}">compare home loan rates</a>.</p>
<h2>Things to know</h2>
<ul class="clean">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
${leadForm({ loan: 'home-loan', heading: `Buying in ${s.name}? Get a call back about a home loan` })}
${toolChips()}
<h2>Frequently asked questions</h2>${faqHtml(qa)}
${others.length ? `<p>Stamp duty in other states: ${others.map((x) => `<a href="${href(stampUrl(x))}">${esc(x.name)}</a>`).join(' · ')}</p>` : ''}`,
  });
}

function stampHubPage() {
  const def = stampStates.find((s) => s.slug === 'maharashtra') ?? stampStates[0];
  const updated = stampStates.map((s) => s.retrievedOn).sort().at(-1);
  const rows = stampStates
    .flatMap((s) =>
      s.areas.map((a, i) => {
        const w = a.duty.some((d) => d.womanPct != null);
        return `<tr><td>${i === 0 ? `<a href="${href(stampUrl(s))}">${esc(s.name)}</a>` : ''}</td><td data-label="Area">${esc(a.label)}</td><td data-label="Stamp duty">${pctLabel(dutyPct(a))}${w ? ` <span class="small">(women ${pctLabel(dutyPct(a, 'woman'))})</span>` : ''}</td><td data-label="Registration">${regLabel(a.registration)}</td><td data-label="On ₹50 lakh"><b>${inr(stampDuty(a, 5000000).total)}</b></td></tr>`;
      }),
    )
    .join('');
  const withW = stampStates.filter(hasWomanRate).map((s) => s.name);
  const withoutW = stampStates.filter((s) => !hasWomanRate(s)).map((s) => s.name);
  const qa = [
    ['What is stamp duty?', 'A tax the state government charges when a property changes hands. The buyer pays it when the sale deed is registered, along with a separate registration fee.'],
    ['On what value is stamp duty charged?', 'On the sale price or the government value of the property (circle rate or ready reckoner rate), whichever is higher.'],
    ...(withW.length && withoutW.length ? [['Do women pay less stamp duty?', `In some states. ${withW.join(' and ')} charge${withW.length === 1 ? 's' : ''} women buyers a lower rate; ${withoutW.join(' and ')} ${withoutW.length === 1 ? 'does' : 'do'} not.`]] : []),
    ['Can I add stamp duty to my home loan?', 'Banks usually lend only against the property price, so plan to pay stamp duty and the registration fee from your own savings, along with the down payment.'],
  ];
  return layout({
    title: `Stamp Duty Calculator ${stampYear}: State-wise Rates and Registration Fee`,
    desc: `Calculate stamp duty and registration charges on a property in ${stampStates.map((s) => s.name).join(', ')}. Official ${stampYear} rates, women's concessions and the total cash you need to buy a home.`,
    url: STAMP_HUB,
    toc: true,
    updated,
    crumbs: [{ name: 'Calculators', url: '/calculators/' }, { name: 'Stamp duty calculator', url: STAMP_HUB }],
    jsonld: [faqLd(qa)],
    extraScript: stampScript(),
    body: `<h1>Stamp Duty Calculator</h1>
<p class="lead">Work out the stamp duty and registration fee on your home, and the total cash you need on top of your home loan. Rates are taken from each state's official registration website.</p>
${stampWidget(def)}
<h2>Stamp duty and registration fee by state</h2>
<div class="scroll"><table class="stack"><thead><tr><th>State</th><th>Area</th><th>Stamp duty</th><th>Registration fee</th><th>On a ₹50 lakh home</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="small">We add a state only after checking every charge on its official government website. More states are on the way.</p>
<h2>How stamp duty is calculated</h2>
<p>Multiply the property value by the state's stamp duty rate, then add the registration fee. For example, a ₹50 lakh home in ${esc(def.name)} (${esc(def.areas[0].label.charAt(0).toLowerCase() + def.areas[0].label.slice(1))}) pays ${pctLabel(dutyPct(def.areas[0]))} stamp duty (${inr(stampDuty(def.areas[0], 5000000).duty)}) plus a registration fee of ${inr(stampDuty(def.areas[0], 5000000).registration)}, a total of ${inr(stampDuty(def.areas[0], 5000000).total)}.</p>
${leadForm({ loan: 'home-loan', heading: 'Buying a home? Get a call back about a home loan' })}
${toolChips()}
<h2>Frequently asked questions</h2>${faqHtml(qa)}`,
  });
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
  write('how-much-home-loan-can-i-get/index.html', howMuchPage());
  for (const s of SALARIES) write(`${salaryUrl(s).slice(1)}index.html`, salaryPage(s));
}
write('flat-vs-reducing-interest-rate-calculator/index.html', flatPage());
write('emi-calculator-excel/index.html', excelPage());
if (stampStates.length) {
  write('stamp-duty-calculator/index.html', stampHubPage());
  for (const st of stampStates) write(`${stampUrl(st).slice(1)}index.html`, stampStatePage(st));
}
fs.mkdirSync(path.join(OUT, 'downloads'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'assets', 'downloads', 'mathmyloan-emi-calculator.xlsx'), path.join(OUT, EXCEL_FILE.slice(1)));
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
// PDF report builder, loaded only when someone downloads a report.
write('pdf.js', fs.readFileSync(path.join(ROOT, 'src', 'pdf.js'), 'utf8'));
// Site icon: made by scripts/make-icons.ps1 and scripts/make-ico.mjs, served from the site root.
for (const f of ['favicon.ico', 'favicon.svg', 'icon-48.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
  fs.copyFileSync(path.join(ROOT, 'assets', 'brand', f), path.join(OUT, f));
}
write(
  'site.webmanifest',
  JSON.stringify(
    {
      name: cfg.siteName,
      short_name: cfg.siteName,
      start_url: href('/'),
      display: 'browser',
      theme_color: '#001e60',
      background_color: '#ffffff',
      icons: [
        { src: href('/icon-192.png'), sizes: '192x192', type: 'image/png' },
        { src: href('/icon-512.png'), sizes: '512x512', type: 'image/png' },
      ],
    },
    null,
    2,
  ),
);
if (cfg.domain) write('CNAME', cfg.domain);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`);
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((p) => `<url><loc>${cfg.siteUrl}${p.url}</loc><lastmod>${p.lastmod}</lastmod></url>`)
    .join('\n')}\n</urlset>\n`,
);
write(`${cfg.indexNowKey}.txt`, cfg.indexNowKey);
write('urls.json', JSON.stringify(pages.map((p) => `${cfg.siteUrl}${p.url}`), null, 1));
console.log(`Built ${pages.length} pages into dist/ (${products.length} verified products, ${banks.length} banks known)`);
