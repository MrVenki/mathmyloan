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
// extraMonthly is added to every EMI, extraYearly is paid with every 12th instalment.
export function schedule(P, rate, years, extraMonthly = 0, extraYearly = 0) {
  const r = rate / 1200;
  const e = emi(P, rate, years);
  const rows = [];
  let bal = P;
  for (let m = 1; bal > 0.5 && m <= years * 12 + 1; m++) {
    const interest = bal * r;
    const extra = extraMonthly + (m % 12 === 0 ? extraYearly : 0);
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

export const inr = (n) =>'₹' + Math.round(n).toLocaleString('en-IN');

export function lakhLabel(lakh) {
  return lakh >= 100 ? `₹${lakh / 100} crore` : `₹${lakh} lakh`;
}
