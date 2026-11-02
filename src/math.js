// Monthly EMI for principal P at annual rate (percent) over `years`.
export function emi(P, rate, years) {
  const n = years * 12;
  const r = rate / 1200;
  if (r === 0) return P / n;
  const f = Math.pow(1 + r, n);
  return (P * r * f) / (f - 1);
}

// Outstanding principal after `months` of payments.
export function balanceAfter(P, rate, years, months) {
  const r = rate / 1200;
  if (r === 0) return P - (P / (years * 12)) * months;
  const e = emi(P, rate, years);
  const f = Math.pow(1 + r, months);
  return P * f - (e * (f - 1)) / r;
}

export function summary(P, rate, years) {
  const e = emi(P, rate, years);
  const total = e * years * 12;
  return { emi: e, total, interest: total - P };
}

// Largest loan whose EMI equals `maxEmi`.
export function loanForEmi(maxEmi, rate, years) {
  const n = years * 12;
  const r = rate / 1200;
  if (r === 0) return maxEmi * n;
  const f = Math.pow(1 + r, n);
  return (maxEmi * (f - 1)) / (r * f);
}

// Month-by-month repayment schedule. Optional extra payments shorten the loan:
// extraMonthly is added to every EMI, extraYearly is paid with every 12th instalment,
// and lumpSum is a one-time prepayment made with instalment number lumpMonth.
export function schedule(P, rate, years, extraMonthly = 0, extraYearly = 0, lumpSum = 0, lumpMonth = 0) {
  const r = rate / 1200;
  const e = emi(P, rate, years);
  const rows = [];
  let bal = P;
  for (let m = 1; bal > 0.5 && m <= years * 12 + 1; m++) {
    const interest = bal * r;
    const extra = extraMonthly + (m % 12 === 0 ? extraYearly : 0) + (m === lumpMonth ? lumpSum : 0);
    const principal = Math.min(bal, Math.max(0, e - interest) + extra);
    bal -= principal;
    rows.push({ m, interest, principal, paid: interest + principal, balance: Math.max(0, bal) });
  }
  return rows;
}

// Groups a monthly schedule into loan years (year 1 = months 1 to 12).
export function yearly(rows) {
  const out = [];
  for (const row of rows) {
    const y = Math.ceil(row.m / 12);
    const cur = (out[y - 1] ??= { year: y, principal: 0, interest: 0, paid: 0, balance: 0 });
    cur.principal += row.principal;
    cur.interest += row.interest;
    cur.paid += row.paid;
    cur.balance = row.balance;
  }
  return out;
}

// Maximum EMI a lender is likely to allow: a share (foir, percent) of net monthly income,
// minus EMIs already being paid.
export const maxEmiFor = (income, existingEmi, foir = 50) => Math.max(0, (income * foir) / 100 - existingEmi);

// Home loan balance transfer: keep the remaining tenure, move to a new rate, pay one-off fees.
export function balanceTransfer(outstanding, oldRate, newRate, years, fees = 0) {
  const oldEmi = emi(outstanding, oldRate, years);
  const newEmi = emi(outstanding, newRate, years);
  const monthly = oldEmi - newEmi;
  const gross = monthly * years * 12;
  return {
    oldEmi,
    newEmi,
    monthly,
    gross,
    net: gross - fees,
    breakEvenMonths: monthly > 0 ? Math.ceil(fees / monthly) : null,
  };
}

// Flat-rate loans charge interest on the full original amount for the whole tenure.
export const flatEmi = (P, flatRate, years) => (P + (P * flatRate * years) / 100) / (years * 12);

// The reducing-balance rate that gives the same EMI as a flat-rate quote (found by bisection).
export function flatToReducing(flatRate, years) {
  if (flatRate <= 0) return 0;
  const target = flatEmi(100000, flatRate, years);
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (emi(100000, mid, years) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Indian loan-to-value limits for home loans: 90% up to ₹30 lakh, 80% up to ₹75 lakh, 75% above.
export const ltvFor = (loan) => (loan <= 3e6 ? 0.9 : loan <= 7.5e6 ? 0.8 : 0.75);

export const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

export function lakhLabel(lakh) {
  return lakh >= 100 ? `₹${lakh / 100} crore` : `₹${lakh} lakh`;
}
