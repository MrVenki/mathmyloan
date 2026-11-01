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

export const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

export function lakhLabel(lakh) {
  return lakh >= 100 ? `₹${lakh / 100} crore` : `₹${lakh} lakh`;
}
