// Finds loan rates in a bank page's text without any AI model.
// 1. A learned rule: the exact line (numbers blanked out) where the approved rate was last seen.
// 2. The approved rate itself, when it is still on the page (and a new rule is learned from it).
// 3. Keyword rules: lines about the loan type, lowest plausible "x.xx%" on them.
// Everything found here is only a draft; an admin approves it before it reaches the site.

// Words that identify each loan type, words that rule a line out, and plausible rate bounds.
export const LOAN_RULES = {
  'home-loan': { inc: /\b(home|housing)[\s-]*loans?\b|\bpmay\b/i, exc: /top[\s-]?up|overdraft|\bod\b|max\s?gain|smart\s?(home|save)|flexi|plot|site\b|land|improvement|repair|renovat|extension|reverse|against|furnish|decor|commercial|mortgage/i, min: 6, max: 14 },
  'personal-loan': { inc: /\bpersonal[\s-]*loans?\b/i, exc: /against|pension|gold|secured|overdraft|doctor|festival|top[\s-]?up/i, min: 8, max: 30 },
  'car-loan': { inc: /\b(car|vehicle|four[\s-]?wheeler|auto)[\s-]*loans?\b|\b4[\s-]?wheeler/i, exc: /used|user\s+car|pre[\s-]?owned|second[\s-]?hand|old\s+(car|vehicle|4|four)|two[\s-]?wheeler|2[\s-]?wheeler|commercial|tractor|farm/i, min: 6.5, max: 18 },
  'education-loan': { inc: /\b(education|educational|student)[\s-]*loans?\b|\bunion\s+education\b|vidya|scholar|skill\s+loan/i, exc: /skill/i, min: 6, max: 18 },
  'loan-against-property': { inc: /against\s+(immovable\s+)?property|\blap\b|mortgage\s+loan|property\s+loan|\bmortgage\b/i, exc: /reverse|commercial\s+property\s+purchase/i, min: 7, max: 20 },
  'gold-loan': { inc: /\bgold[\s-]*loans?\b|against\s+gold|gold\s+(ornaments?|jewel)/i, exc: /agri|kcc|crop|bond/i, min: 6, max: 26 },
  'two-wheeler-loan': { inc: /\b(two|2)[\s-]?wheeler|\bbike\s+loan|motor\s*cycle|scooter/i, exc: /four|commercial/i, min: 7, max: 30 },
  'used-car-loan': { inc: /used\s+(car|vehicle)|user\s+car|car\s+loans?\s*\(?\s*(used|pre)|pre[\s-]?owned|second[\s-]?hand\s+(car|vehicle)|old\s+(car|vehicle|4|four)[\s-]*(wheeler)?/i, exc: /two[\s-]?wheeler/i, min: 7.5, max: 26 },
  'home-loan-overdraft': { inc: /overdraft.{0,30}(home|housing)|(home|housing).{0,30}(overdraft|\bod\b)|max\s?gain|smart\s?(home|save)|home\s+loan\s+flexi|flexi\s+(home|housing)/i, exc: /against\s+(fd|deposit)/i, min: 6, max: 15 },
  'loan-against-securities': { inc: /against\s+(paper\s+)?(shares|securit|mutual\s+funds?|demat|bonds?|mf\b)|\bmutual\s+funds?\b.{0,20}loan|\bmf\s+loan|\blas\b/i, exc: /gold|property/i, min: 7, max: 20 },
  'plot-loan': { inc: /\bplot\b|site\s+loan|land\s+purchase|purchase\s+of\s+(land|plot|site)/i, exc: /agri|farm|kcc/i, min: 6.5, max: 17 },
  'top-up-home-loan': { inc: /top[\s-]?up/i, exc: /gold|personal/i, min: 6.5, max: 17 },
};

// A benchmark, fee or concession word just before a number means it is not the loan rate.
const NOT_A_RATE = /(mclr|eblr|rllr|rblr|prlr|repo|t[\s-]?bill|base\s+rate|bplr|\bebr\b|benchmark|spread|fee|charge|penal|gst|tax|concession|discount|rebate|waiver|ltv|margin|deposit|\bfd\b|cashback|stamp|\+|[-–]\s*$)/i;
// Charges described anywhere earlier on the line (penal interest is not the loan rate).
const PENALTY = /penal|overdue|default|foreclos|part[\s-]?pay|prepay|bounce|delayed/i;
// Table columns that hold benchmarks, spreads or upper/average rates rather than the starting rate.
const BAD_COLUMN = /spread|benchmark|repo|mclr|rllr|eblr|rblr|prlr|base|margin|discount|concession|\bmax|highest|mean|average|upper|fee|charge|premium|\bcrp\b|ltv/i;
const GOOD_COLUMN = /effective|\broi\b|rate of interest|applicable|\bmin|lowest|starting|floor|final/i;
// Lines about deposits, farm, small-business or staff schemes are not the retail loans compared here.
const OFF_TOPIC = /\bmudra\b|\bkcc\b|kisan|\bagri|\bmsme\b|\bstaff\b|pmegp|\bshg\b|e[\s-]?rickshaw/i;
const DEPOSIT = /deposit|\bfd\b|savings|\brd\b/i;
const PCT = /(\d{1,2}(?:\.\d{1,3})?)\s*%/g;
const DEC = /(?<![\d.])(\d{1,2}\.\d{1,3})(?![\d.%])/g;

export const shape = (s) => String(s).toLowerCase().replace(/\d+(?:[.,]\d+)*/g, '#').replace(/\s+/g, ' ').trim();
const round = (n) => Math.round(n * 1000) / 1000;

// Splits text into trimmed, non-empty, de-noised lines.
export function linesOf(text) {
  return String(text)
    .replace(/ /g, ' ')
    .replace(/[‒-―−]/g, '-')
    .split(/\n/)
    .map((l) => l.replace(/[ \t]+/g, ' ').replace(/(\s*\|\s*)+/g, ' | ').replace(/^\s*\|\s*|\s*\|\s*$/g, '').trim())
    .filter((l) => l && l.length <= 800);
}

// Numbers on a line that read as an interest rate (with or without a % sign).
export function rateTokens(line, withPct = true) {
  const out = [];
  for (const m of line.matchAll(withPct ? PCT : DEC)) {
    // Only the text since the last cell break, "=" or "presently" decides what the number is:
    // "RLLR + 2.75% (presently 11.10%)" is a formula followed by the rate it works out to.
    const before = line.slice(0, m.index);
    const said = [...before.matchAll(/presently|currently|effective(?:ly)?|i\.e\.|equivalent|works out|comes to/gi)].at(-1);
    const cut = Math.max(before.lastIndexOf('|'), before.lastIndexOf('='), said ? said.index + said[0].length - 1 : -1);
    const lead = before.slice(cut + 1).slice(-28);
    out.push({ value: round(Number(m[1])), skip: NOT_A_RATE.test(lead) || PENALTY.test(before), cell: before.split('|').length - 1 });
  }
  return out;
}

const matchesLoan = (line, slug) => LOAN_RULES[slug].inc.test(line) && !LOAN_RULES[slug].exc.test(line);
const mentionsAnyLoan = (line) => Object.keys(LOAN_RULES).filter((s) => LOAN_RULES[s].inc.test(line));

// Which loan types each line is about: its own words, else the last heading within 15 lines.
export function loanContext(lines) {
  let ctx = [];
  let age = 99;
  const ages = [];
  const out = lines.map((line) => {
    let own = Object.keys(LOAN_RULES).filter((s) => matchesLoan(line, s));
    // "Overdraft" on its own, inside a home loan section, is the home loan overdraft.
    if (!own.length && /overdraft|\bod\b/i.test(line) && age <= 15 && ctx.includes('home-loan')) own = ['home-loan-overdraft'];
    if (own.length || mentionsAnyLoan(line).length) {
      ctx = own;
      age = 0;
      ages.push(0);
      return own;
    }
    age += 1;
    ages.push(age);
    return age <= 15 ? ctx : [];
  });
  // How many lines below its heading each line sits.
  out.age = ages;
  return out;
}

// The nearest line above (within 40) that names a loan: a table's heading, usually.
export function headings(lines) {
  let last = -1;
  return lines.map((line, i) => {
    const h = last >= 0 && i - last <= 40 ? last : -1;
    if (mentionsAnyLoan(line).length) last = i;
    return h;
  });
}

const prevShape = (lines, i) => shape(lines.slice(Math.max(0, i - 2), i).join(' / '));
const headShape = (lines, heads, i) => (heads[i] >= 0 ? shape(lines[heads[i]]).slice(0, 160) : '');
const evidence = (lines, i) => lines.slice(Math.max(0, i - 2), i + 1).join('\n').slice(-400);
const inBounds = (slug, v) => v >= LOAN_RULES[slug].min && v <= LOAN_RULES[slug].max;

// 1. Learned rule. When the same line shape repeats (one per table), the table heading and
// the lines just above pick the right one, then its position among the repeats.
export function byRule(lines, slug, rule, heads = headings(lines)) {
  if (!rule?.shape) return null;
  const hits = [];
  lines.forEach((l, i) => {
    if (shape(l) === rule.shape) hits.push(i);
  });
  if (!hits.length) return null;
  const score = (h) => (rule.head != null && headShape(lines, heads, h) === rule.head ? 2 : 0) + (prevShape(lines, h) === rule.prev ? 1 : 0);
  const top = Math.max(...hits.map(score));
  const tied = hits.filter((h) => score(h) === top);
  const i = tied.reduce((a, b) => (Math.abs(hits.indexOf(b) - (rule.nth ?? 0)) < Math.abs(hits.indexOf(a) - (rule.nth ?? 0)) ? b : a));
  const tok = rateTokens(lines[i], rule.pct !== false)[rule.index];
  if (!tok || !inBounds(slug, tok.value)) return null;
  return { value: tok.value, evidence: evidence(lines, i), method: 'rule' };
}

// 2. Finds where a known (approved) rate sits on the page and returns a rule for it.
export function learn(lines, slug, rate, ctx = loanContext(lines), heads = headings(lines)) {
  let best = null;
  for (const pct of [true, false]) {
    lines.forEach((l, i) => {
      rateTokens(l, pct).forEach((t, k) => {
        if (Math.abs(t.value - rate) > 0.0005) return;
        let score = 0;
        if (ctx[i].includes(slug)) score += 6;
        else if (ctx[i].length) score -= 2;
        if (matchesLoan(l, slug)) score += 3;
        if (heads[i] >= 0 && matchesLoan(lines[heads[i]], slug)) score += 4;
        if (LOAN_RULES[slug].exc.test(l)) score -= 4;
        if (t.skip) score -= 3;
        if (!best || score > best.score) best = { score, i, k, pct };
      });
    });
    if (best && best.score >= -2) break;
  }
  if (!best || best.score < -2) return null;
  const sh = shape(lines[best.i]);
  const same = lines.map((l, i) => (shape(l) === sh ? i : -1)).filter((i) => i >= 0);
  return {
    value: rate,
    evidence: evidence(lines, best.i),
    method: 'learned',
    rule: { shape: sh, prev: prevShape(lines, best.i), head: headShape(lines, heads, best.i), nth: same.indexOf(best.i), index: best.k, pct: best.pct },
  };
}

// A line that reads like a rate: a table row, or words about interest next to it.
const RATEY = /\||interest|rate|\broi\b|p\.?\s?a\b|onwards|starting|from|effective|presently/i;

// 3. Keyword rules: the lowest plausible rate on lines about this loan type. Lines that name
// the loan, or sit within 6 lines of its heading, beat lines farther down its section.
// The other rates found are kept so the admin can pick one if this is wrong.
export function generic(lines, slug, ctx = loanContext(lines)) {
  const found = [];
  let header = null;
  lines.forEach((l, i) => {
    const cells = l.split(' | ');
    // A table's header row: several cells, words, no rates. Rows below are read by column.
    if (cells.length >= 2 && /[a-z]{3}/i.test(l) && !rateTokens(l).length && !rateTokens(l, false).length) header = { cells, at: i };
    if (!ctx[i].includes(slug)) return;
    if (!RATEY.test(l) && !RATEY.test(lines[i - 1] ?? '')) return;
    if (LOAN_RULES[slug].exc.test(l) || OFF_TOPIC.test(l) || DEPOSIT.test(l) || DEPOSIT.test(lines[i - 1] ?? '')) return;
    const tier = matchesLoan(l, slug) || ctx.age[i] <= 6 ? 0 : 1;
    const head = header && i - header.at <= 30 && cells.length >= 2 ? header.cells : null;
    for (const t of rateTokens(l)) {
      if (t.skip || !inBounds(slug, t.value)) continue;
      // Columns line up from the right: rows often have extra label cells on the left.
      const col = head ? head[head.length - (cells.length - t.cell)] : null;
      if (col && BAD_COLUMN.test(col) && !GOOD_COLUMN.test(col)) continue;
      found.push({ value: t.value, tier, evidence: evidence(lines, i) });
    }
  });
  if (!found.length) return null;
  found.sort((a, b) => a.tier - b.tier || a.value - b.value);
  const seen = new Set();
  const alternatives = found.filter((f) => !seen.has(f.value) && seen.add(f.value)).slice(1, 6).map(({ value, evidence: e }) => ({ value, evidence: e }));
  return { value: found[0].value, evidence: found[0].evidence, method: 'keywords', alternatives };
}

// Rule first, then the approved rate, then keywords.
export function findRate(text, slug, { rule, live } = {}) {
  const lines = linesOf(text);
  const ctx = loanContext(lines);
  const heads = headings(lines);
  const r = byRule(lines, slug, rule, heads);
  if (r) return r;
  if (Number.isFinite(live)) {
    const l = learn(lines, slug, live, ctx, heads);
    if (l) return l;
  }
  return generic(lines, slug, ctx);
}
