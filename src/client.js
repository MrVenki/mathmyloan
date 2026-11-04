// Browser script: calculators with payment schedules, bank comparison and the lead form.
// No dependencies. Monthly rows are rendered one loan year at a time to keep the page light.
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var inr = function (n) { return '₹' + Math.round(n).toLocaleString('en-IN'); };
  var num = function (el) { return Math.max(0, parseFloat(el && el.value) || 0); };
  var hue = function (s) { var h = 7; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
  var initials = function (s) { return s.split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); };
  var LOGOS = window.LOGOS || {};
  var avatar = function (name, slug) {
    if (slug && LOGOS[slug]) return '<span class="av has-logo"><img src="' + LOGOS[slug] + '" alt="' + name + ' logo" width="64" height="28" loading="lazy" decoding="async"></span>';
    return '<span class="av" style="--h:' + hue(name) + '">' + initials(name) + '</span>';
  };
  var words = function (n) {
    function t(x) { return String(Math.round(x * 100) / 100); }
    if (n >= 1e7) return t(n / 1e7) + ' crore';
    if (n >= 1e5) return t(n / 1e5) + ' lakh';
    if (n >= 1e3) return t(n / 1e3) + ' thousand';
    return '';
  };
  var span = function (months) {
    var y = Math.floor(months / 12), m = months % 12;
    return (y ? y + ' yr' + (y > 1 ? 's' : '') : '') + (y && m ? ' ' : '') + (m ? m + ' mo' : '') || '0 mo';
  };

  function emi(P, rate, years) {
    var n = years * 12, r = rate / 1200;
    if (!r) return P / n;
    var f = Math.pow(1 + r, n);
    return (P * r * f) / (f - 1);
  }

  // The page heading, used as context at the top of PDF reports.
  function pageName() {
    var h = document.querySelector('h1');
    return h ? h.textContent.replace(/\s+/g, ' ').trim() : document.title;
  }

  // Same maths as src/math.js: month-by-month schedule with optional extra payments.
  function loanForEmi(e, rate, years) {
    var n = years * 12, r = rate / 1200;
    if (!r) return e * n;
    var f = Math.pow(1 + r, n);
    return (e * (f - 1)) / (r * f);
  }

  function schedule(P, rate, years, extraM, extraY, lump, lumpAt) {
    var r = rate / 1200, e = emi(P, rate, years), rows = [], bal = P;
    for (var m = 1; bal > 0.5 && m <= years * 12 + 1; m++) {
      var interest = bal * r;
      var extra = (extraM || 0) + (m % 12 === 0 ? (extraY || 0) : 0) + (m === lumpAt ? (lump || 0) : 0);
      var principal = Math.min(bal, Math.max(0, e - interest) + extra);
      bal -= principal;
      rows.push({ m: m, interest: interest, principal: principal, paid: interest + principal, balance: Math.max(0, bal) });
    }
    return rows;
  }
  // The first EMI falls in the current month, so schedules use real dates: "2026-Nov", calendar years.
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var NOW = new Date(), SY = NOW.getFullYear(), SM = NOW.getMonth();
  var yearOf = function (m) { return SY + Math.floor((SM + m - 1) / 12); };
  var monthLabel = function (m) { return yearOf(m) + '-' + MONTHS[(SM + m - 1) % 12]; };
  function yearly(rows) {
    var out = [];
    rows.forEach(function (r) {
      var y = yearOf(r.m), c = out[out.length - 1];
      if (!c || c.year !== y) out.push(c = { year: y, months: 0, principal: 0, interest: 0, paid: 0, balance: 0 });
      c.months++; c.principal += r.principal; c.interest += r.interest; c.paid += r.paid; c.balance = r.balance;
    });
    return out;
  }
  var yearCell = function (y) { return y.year + (y.months < 12 ? ' <span class="small">(' + y.months + ' mo)</span>' : ''); };
  var sum = function (rows, k) { return rows.reduce(function (a, r) { return a + r[k]; }, 0); };

  // ---- plain-language hints under money fields ("₹50,00,000 = 50 lakh") ----
  function hints(root) {
    root.querySelectorAll('input[data-words]').forEach(function (inp) {
      var h = inp.nextElementSibling;
      if (!h || !h.classList.contains('hint')) { h = document.createElement('small'); h.className = 'hint'; inp.parentNode.insertBefore(h, inp.nextSibling); }
      var n = num(inp), w = words(n);
      h.textContent = n && w ? inr(n) + ' = ' + w : '';
    });
  }
  document.addEventListener('input', function (ev) { if (ev.target.matches && ev.target.matches('input[data-words]')) hints(ev.target.parentNode.parentNode); });
  hints(document);

  // ---- ranked bank list with cost bars and a one-line verdict ----
  function rankHtml(rows, years, limit) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.interest; })) || 1, best = rows[0];
    var verdict = '';
    if (rows.length > 1) {
      var worst = rows[rows.length - 1];
      verdict = '<p class="verdict"><b>' + best.name + '</b> costs <b>' + inr(worst.interest - best.interest) + '</b> less interest than ' + worst.name +
        ' over ' + years + ' years, about <b>' + inr(worst.emi - best.emi) + '</b> less every month.</p>';
    }
    return verdict + rows.slice(0, limit || rows.length).map(function (r, i) {
      var isBest = i === 0 && rows.length > 1;
      var extra = r.interest - best.interest < 1 ? '' : '<span class="extra">+' + inr(r.interest - best.interest) + ' more interest</span>';
      return '<div class="rank' + (isBest ? ' best' : '') + '">' + avatar(r.name, r.slug) +
        '<span class="nm"><b>' + (r.url ? '<a href="' + r.url + '">' + r.name + '</a>' : r.name) + (isBest ? '<span class="badge">Lowest cost</span>' : '') + '</b>' +
        '<span class="small">EMI ' + inr(r.emi) + ' / month</span></span>' +
        '<span class="px"><b class="rt">' + Number(r.rate).toFixed(2) + '%<small> p.a.</small></b>' + (extra || '<span class="extra">Interest ' + inr(r.interest) + '</span>') + '</span>' +
        '<span class="bar"><i style="width:' + Math.max(6, Math.round((r.interest / max) * 100)) + '%"></i></span></div>';
    }).join('') + '<p class="small">Based on each bank\'s advertised starting rate. Your own rate depends on your credit score and profile and may be higher.</p>';
  }
  function rowsFor(banks, P, y) {
    return banks.map(function (b) {
      var e = emi(P, b.rate, y);
      return { name: b.name, slug: b.slug, rate: b.rate, url: b.url, emi: e, interest: e * y * 12 - P };
    }).sort(function (a, c) { return a.interest - c.interest; });
  }

  function donut(P, interest) {
    var total = P + interest, p = (P / total) * 100, i = 100 - p;
    return '<svg class="donut" viewBox="0 0 36 36" role="img" aria-label="Principal ' + Math.round(p) + ' percent, interest ' + Math.round(i) + ' percent">' +
      '<circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--accent)" stroke-width="4.5" stroke-dasharray="' + p + ' 100" transform="rotate(-90 18 18)"/>' +
      '<circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--accent3)" stroke-width="4.5" stroke-dasharray="' + i + ' 100" stroke-dashoffset="-' + p + '" transform="rotate(-90 18 18)"/></svg>' +
      '<div class="legend"><div><i style="background:var(--accent)"></i>Principal ' + inr(P) + '</div><div><i style="background:var(--accent3)"></i>Interest ' + inr(interest) + '</div></div>';
  }

  // ---- payment schedule: year by year chart + table, or month by month for one year ----
  function scheduleHtml(box, rows) {
    var view = box._view || 'yearly', ys = yearly(rows);
    var head = '<div class="sched-head"><h3>Payment schedule</h3><div class="seg" role="group" aria-label="Schedule view">' +
      '<button type="button" data-view="yearly" class="' + (view === 'yearly' ? 'on' : '') + '">Year by year</button>' +
      '<button type="button" data-view="monthly" class="' + (view === 'monthly' ? 'on' : '') + '">Month by month</button></div></div>';
    if (view === 'yearly') {
      var max = Math.max.apply(null, ys.map(function (y) { return y.paid; })) || 1;
      var bars = ys.map(function (y) {
        var h = Math.max(4, Math.round((y.paid / max) * 100)), ip = Math.round((y.interest / y.paid) * 100);
        return '<div class="col" title="' + y.year + ': principal ' + inr(y.principal) + ', interest ' + inr(y.interest) + '"><div class="stack" style="height:' + h + '%">' +
          '<i class="i" style="height:' + ip + '%"></i><i class="p" style="height:' + (100 - ip) + '%"></i></div><span>' + (ys.length > 12 ? String(y.year).slice(2) : y.year) + '</span></div>';
      }).join('');
      var body = ys.map(function (y) {
        return '<tr><td>' + yearCell(y) + '</td><td>' + inr(y.principal) + '</td><td>' + inr(y.interest) + '</td><td class="opt">' + inr(y.paid) + '</td><td>' + inr(y.balance) + '</td></tr>';
      }).join('');
      return head + '<div class="chart" aria-hidden="true">' + bars + '</div>' +
        '<p class="legend"><i style="background:var(--accent)"></i>Principal <i style="background:var(--accent3);margin-left:12px"></i>Interest. Each bar is one calendar year, starting with your first EMI in ' + monthLabel(1) + '. Early years are mostly interest.</p>' +
        '<div class="scroll"><table><thead><tr><th>Year</th><th>Principal</th><th>Interest</th><th class="opt">Paid</th><th>Balance left</th></tr></thead><tbody>' + body + '</tbody></table></div>';
    }
    var last = ys.length ? ys[ys.length - 1].year : SY;
    var yr = Math.min(Math.max(box._yr || SY, SY), last);
    var opts = ys.map(function (y) { return '<option value="' + y.year + '"' + (y.year === yr ? ' selected' : '') + '>' + y.year + '</option>'; }).join('');
    var mrows = rows.filter(function (r) { return yearOf(r.m) === yr; }).map(function (r) {
      return '<tr><td>' + monthLabel(r.m) + '</td><td class="opt">' + inr(r.paid) + '</td><td>' + inr(r.principal) + '</td><td>' + inr(r.interest) + '</td><td>' + inr(r.balance) + '</td></tr>';
    }).join('');
    return head + '<label for="yr-' + box._id + '">Show payments for</label><select id="yr-' + box._id + '" name="yr">' + opts + '</select>' +
      '<div class="scroll" style="margin-top:10px"><table><thead><tr><th>Month</th><th class="opt">Paid</th><th>Principal</th><th>Interest</th><th>Balance left</th></tr></thead><tbody>' + mrows + '</tbody></table></div>' +
      '<p class="small">Each payment is split between interest on what you still owe and repayment of principal.</p>';
  }

  var uid = 0;
  document.querySelectorAll('[data-calc]').forEach(function (box) {
    box._id = ++uid;
    box._view = box.getAttribute('data-view-default') || 'yearly';
    var out = $('.out', box);
    function run() {
      var P = num($('[name=amount]', box)), rate = num($('[name=rate]', box)), y = num($('[name=years]', box));
      var xm = num($('[name=extraM]', box)), xy = num($('[name=extraY]', box));
      var lump = num($('[name=lump]', box)), lumpAt = Math.round(num($('[name=lumpAt]', box))) || 1;
      if (!P || !y) { out.innerHTML = ''; box._report = null; return; }
      var base = schedule(P, rate, y, 0, 0, 0, 0), rows = xm || xy || lump ? schedule(P, rate, y, xm, xy, lump, lumpAt) : base;
      var e = emi(P, rate, y), interest = sum(rows, 'interest'), paid = P + interest;
      var saved = sum(base, 'interest') - interest;
      box._report = {
        title: 'Loan EMI and repayment schedule', file: 'emi-schedule',
        subtitle: pageName() + '. First EMI in ' + monthLabel(1) + '; years in the schedule are calendar years.',
        inputs: [['Loan amount', inr(P)], ['Interest rate', rate + '% a year'], ['Tenure', y + ' years (' + Math.round(y * 12) + ' EMIs)'], ['First EMI', monthLabel(1)]]
          .concat(xm ? [['Extra payment every month', inr(xm)]] : [], xy ? [['Extra payment every year', inr(xy) + ' with every 12th EMI']] : [],
            lump ? [['One-time lump sum', inr(lump) + ' with EMI ' + lumpAt + ' (' + monthLabel(lumpAt) + ')']] : []),
        results: [['Monthly EMI', inr(e), true], ['Total interest', inr(interest)], ['Total payment', inr(paid)],
          ['Last EMI', monthLabel(rows.length) + ' (after ' + span(rows.length) + ')'], ['Interest as a share of what you pay', Math.round((interest / paid) * 100) + '%']]
          .concat(saved > 1 ? [['Interest saved by extra payments', inr(saved), true], ['Loan ends earlier by', span(base.length - rows.length)]] : []),
        sections: [
          { title: 'Year-by-year schedule', note: 'Totals for each calendar year. The first and last years may be part-years.', head: ['Year', 'Principal', 'Interest', 'Total paid', 'Balance left'],
            rows: yearly(rows).map(function (x) { return [x.year + (x.months < 12 ? ' (' + x.months + ' mo)' : ''), inr(x.principal), inr(x.interest), inr(x.paid), inr(x.balance)]; }) },
          { title: 'Month-by-month schedule', head: ['Month', 'EMI no.', 'Paid', 'Principal', 'Interest', 'Balance left'], widths: [1.1, 0.7, 1, 1, 1, 1.2],
            rows: rows.map(function (r) { return [monthLabel(r.m), String(r.m), inr(r.paid), inr(r.principal), inr(r.interest), inr(r.balance)]; }) },
        ],
        notes: ['EMI = P x r x (1 + r)^n / ((1 + r)^n - 1), where P is the loan amount, r the monthly interest rate and n the number of EMIs.',
          'Interest each month is charged on the balance still owed, so early EMIs are mostly interest. Amounts are rounded to the nearest rupee.'],
      };
      out.innerHTML = '<div class="calcout"><div><div class="big">' + inr(e) + '<span> per month</span></div>' +
        '<p>Total interest: <b>' + inr(interest) + '</b> · Total payment: <b>' + inr(paid) + '</b></p>' +
        (saved > 1 ? '<p class="saving">With your extra payments you finish <b>' + span(base.length - rows.length) + ' earlier</b> and save <b>' + inr(saved) + '</b> in interest.</p>' : '') +
        '</div><div class="calcout">' + donut(P, interest) + '</div></div>' +
        (folded
          ? '<details class="sched-fold"' + (box._schedOpen ? ' open' : '') + '><summary>Show payment schedule <span class="small">year by year and month by month</span></summary><div class="sched">' + scheduleHtml(box, rows) + '</div></details>'
          : '<div class="sched">' + scheduleHtml(box, rows) + '</div>');
    }
    // On rate pages the schedule starts folded; remember if it was opened, since each input redraws it.
    var folded = box.getAttribute('data-sched') === 'closed';
    box.addEventListener('toggle', function (ev) { if (ev.target.classList.contains('sched-fold')) box._schedOpen = ev.target.open; }, true);
    box.addEventListener('input', function (ev) {
      if (ev.target.name === 'yr') box._yr = parseInt(ev.target.value, 10) || SY;
      run();
    });
    box.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-view]');
      if (!b || !box.contains(b)) return;
      box._view = b.getAttribute('data-view');
      run();
    });
    run();
  });

  // Eligibility: income and existing EMIs -> maximum EMI -> loan, home budget, and loan per bank.
  var LTV = function (loan) { return loan <= 3e6 ? 0.9 : loan <= 7.5e6 ? 0.8 : 0.75; };
  document.querySelectorAll('[data-elig]').forEach(function (box) {
    var out = $('.out', box), products = window.PRODUCTS || [];
    function run() {
      var inc = num($('[name=income]', box)), ex = num($('[name=existing]', box));
      var rate = num($('[name=rate]', box)), y = num($('[name=years]', box)), foir = num($('[name=foir]', box)) || 50;
      var maxE = Math.max(0, (inc * foir) / 100 - ex);
      box._report = null;
      if (!inc || !y) { out.innerHTML = '<p>Enter your income to see an estimate.</p>'; return; }
      if (!maxE) { out.innerHTML = '<p class="verdict">Your existing EMIs already use your ' + foir + '% limit, so lenders are unlikely to offer a new loan until they come down.</p>'; return; }
      var loan = loanForEmi(maxE, rate, y), home = loan / LTV(loan);
      var banks = products.map(function (b) { return { name: b.name, slug: b.slug, url: b.url, rate: b.rate, loan: loanForEmi(maxE, b.rate, y) }; })
        .sort(function (a, c) { return c.loan - a.loan; });
      box._report = {
        title: 'Home loan eligibility estimate', file: 'loan-eligibility', subtitle: pageName() + '.',
        inputs: [['Net monthly income', inr(inc)], ['Existing EMIs per month', inr(ex)], ['Interest rate', rate + '% a year'], ['Tenure', y + ' years'], ['EMI limit', foir + '% of income']],
        results: [['Estimated home loan', inr(loan), true], ['Maximum EMI', inr(maxE) + ' a month'], ['Home you could buy', inr(home)], ['Your down payment', inr(home - loan)]],
        sections: banks.length ? [{ title: 'Eligible loan at each bank\'s starting rate', note: 'Same EMI limit and tenure, at each bank\'s advertised starting rate (a best case).',
          head: ['Bank', 'Starting rate', 'Eligible loan'], widths: [1.6, 1, 1.2], rows: banks.map(function (b) { return [b.name, b.rate + '%', inr(b.loan)]; }) }] : [],
        notes: ['Lenders usually cap all EMIs at 40% to 60% of net income. They also look at age, job, credit score and the property, so this is an estimate, not an approval.',
          'Down payment uses RBI loan-to-value limits: up to 90% for loans to Rs. 30 lakh, 80% to Rs. 75 lakh, 75% above. Stamp duty and registration are extra.'],
      };
      out.innerHTML = '<div class="big">' + inr(loan) + '<span> estimated home loan</span></div>' +
        '<p>Your EMI can be up to <b>' + inr(maxE) + '</b> a month (' + foir + '% of income minus existing EMIs).</p>' +
        '<p class="saving">That could buy a home worth about <b>' + inr(home) + '</b>, with about <b>' + inr(home - loan) + '</b> as your own down payment (RBI loan-to-value limits), plus stamp duty and registration.</p>' +
        (banks.length ? '<h3>At each bank\'s starting rate</h3>' + banks.map(function (b, i) {
          return '<div class="rank' + (i === 0 && banks.length > 1 ? ' best' : '') + '">' + avatar(b.name, b.slug) +
            '<span class="nm"><b><a href="' + b.url + '">' + b.name + '</a>' + (i === 0 && banks.length > 1 ? '<span class="badge">Highest amount</span>' : '') + '</b><span class="small">Starting rate ' + b.rate + '%</span></span>' +
            '<span class="px"><b>' + inr(b.loan) + '</b><br><span class="extra">eligible loan</span></span></div>';
        }).join('') + '<p class="small">Best case at advertised starting rates; your offered rate may vary.</p>' : '');
    }
    box.addEventListener('input', run);
    run();
  });

  // Balance transfer: same remaining tenure at a new rate, minus one-off fees.
  document.querySelectorAll('[data-bt]').forEach(function (box) {
    var out = $('.out', box), products = window.PRODUCTS || [];
    function calc(O, oldR, newR, y, fees) {
      var a = emi(O, oldR, y), b = emi(O, newR, y), m = a - b;
      return { oldEmi: a, newEmi: b, monthly: m, net: m * y * 12 - fees, be: m > 0 ? Math.ceil(fees / m) : null };
    }
    function run() {
      var O = num($('[name=outstanding]', box)), oldR = num($('[name=oldRate]', box)), y = num($('[name=years]', box));
      var newR = num($('[name=newRate]', box)), fees = num($('[name=fees]', box));
      if (!O || !y) { out.innerHTML = ''; box._report = null; return; }
      var r = calc(O, oldR, newR, y, fees);
      var rivals = products.map(function (b) { var c = calc(O, oldR, b.rate, y, fees); c.b = b; return c; })
        .filter(function (c) { return c.monthly > 0; }).sort(function (a, c) { return c.net - a.net; });
      box._report = {
        title: 'Home loan balance transfer comparison', file: 'balance-transfer', subtitle: pageName() + '.',
        inputs: [['Outstanding loan', inr(O)], ['Current rate', oldR + '% a year'], ['Years left', y + ' years'], ['New rate', newR + '% a year'], ['Total switching fees', inr(fees)]],
        results: [['Saving per month', inr(Math.max(0, r.monthly)), true], ['Current EMI', inr(r.oldEmi)], ['New EMI', inr(r.newEmi)], ['Net saving after fees', inr(r.net)],
          ['Fees earned back in', r.be ? r.be + ' months' : 'Not applicable']],
        sections: rivals.length ? [{ title: 'If you moved to each bank at its starting rate', note: 'Same outstanding loan, years left and fees, at each bank\'s advertised starting rate (a best case).',
          head: ['Bank', 'Starting rate', 'Saving a month', 'Net saving', 'Fees back in'], widths: [1.5, 0.9, 1, 1.1, 0.9],
          rows: rivals.map(function (c) { return [c.b.name, c.b.rate + '%', inr(c.monthly), inr(c.net), c.be + ' mo']; }) }] : [],
        notes: ['Count every fee when switching: processing, legal, valuation and stamp duty on the new agreement. Ask your current bank to reprice first; it is often cheaper.'],
      };
      var head = r.monthly <= 0
        ? '<p class="verdict">The new rate is not lower than your current rate, so a transfer would not save money.</p>'
        : '<div class="big">' + inr(r.monthly) + '<span> saved per month</span></div>' +
          '<p>EMI drops from <b>' + inr(r.oldEmi) + '</b> to <b>' + inr(r.newEmi) + '</b>.</p>' +
          (r.net > 0
            ? '<p class="saving">After ' + inr(fees) + ' in fees you save about <b>' + inr(r.net) + '</b> over ' + y + ' years. The fees are earned back in about <b>' + r.be + ' months</b>.</p>'
            : '<p class="verdict">The fees are larger than the savings, so this transfer would cost you money.</p>');
      var banks = products.map(function (b) { var c = calc(O, oldR, b.rate, y, fees); c.b = b; return c; })
        .filter(function (c) { return c.monthly > 0; }).sort(function (a, c) { return c.net - a.net; });
      out.innerHTML = head + (banks.length ? '<h3>If you moved to each bank at its starting rate</h3>' + banks.map(function (c, i) {
        return '<div class="rank' + (i === 0 && banks.length > 1 ? ' best' : '') + '">' + avatar(c.b.name, c.b.slug) +
          '<span class="nm"><b><a href="' + c.b.url + '">' + c.b.name + '</a>' + (i === 0 && banks.length > 1 ? '<span class="badge">Biggest saving</span>' : '') + '</b><span class="small">Starting rate ' + c.b.rate + '%</span></span>' +
          '<span class="px"><b>' + inr(c.monthly) + '</b> / month<br><span class="extra">Net ' + inr(c.net) + '</span></span></div>';
      }).join('') + '<p class="small">Best case at advertised starting rates; your offered rate may vary.</p>' : '');
    }
    box.addEventListener('input', run);
    run();
  });

  // Flat vs reducing: the reducing-balance rate with the same EMI as a flat-rate quote.
  function flatToReducing(flat, years) {
    if (flat <= 0) return 0;
    var target = (100000 + 100000 * flat * years / 100) / (years * 12), lo = 0, hi = 100;
    for (var i = 0; i < 80; i++) { var mid = (lo + hi) / 2; if (emi(100000, mid, years) < target) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  document.querySelectorAll('[data-flat]').forEach(function (box) {
    var out = $('.out', box);
    function run() {
      var P = num($('[name=amount]', box)), f = num($('[name=flat]', box)), y = num($('[name=years]', box));
      if (!P || !y) { out.innerHTML = ''; box._report = null; return; }
      var fe = (P + P * f * y / 100) / (y * 12), fi = P * f * y / 100;
      var r = flatToReducing(f, y), re = emi(P, f, y), ri = re * y * 12 - P;
      box._report = {
        title: 'Flat vs reducing interest rate', file: 'flat-vs-reducing', subtitle: pageName() + '.',
        inputs: [['Loan amount', inr(P)], ['Flat interest rate', f + '% a year'], ['Tenure', y + ' years']],
        results: [['Real (reducing-balance) rate', r.toFixed(2) + '% a year', true], ['EMI on the flat quote', inr(fe)], ['Total interest on the flat quote', inr(fi)],
          ['EMI at a genuine ' + f + '% reducing rate', inr(re)], ['Interest at ' + f + '% reducing', inr(ri)], ['Extra cost of the flat quote', inr(fi - ri)]],
        notes: ['A flat rate charges interest on the full loan for the whole term, even as you repay it. The real rate is the reducing-balance rate that gives the same EMI.'],
      };
      out.innerHTML = '<div class="calcout"><div><div class="big">' + r.toFixed(2) + '%<span> real (reducing) rate</span></div>' +
        '<p>EMI <b>' + inr(fe) + '</b> a month · total interest <b>' + inr(fi) + '</b></p></div></div>' +
        (f > 0 ? '<p class="verdict">This ' + f + '% flat quote is really <b>' + r.toFixed(2) + '%</b>. At a genuine ' + f + '% reducing rate the EMI would be ' + inr(re) +
          ', saving <b>' + inr(fi - ri) + '</b> in interest.</p>' : '');
    }
    box.addEventListener('input', run);
    run();
  });

  // Stamp duty: same rules as stampDuty() and maxLoanForValue() in src/math.js.
  function stampDuty(area, value, buyer) {
    var lines = area.duty.map(function (d) {
      var pct = buyer === 'woman' && d.womanPct != null ? d.womanPct : d.pct;
      return { label: d.label, pct: pct, amount: value * pct / 100 };
    });
    var duty = lines.reduce(function (a, l) { return a + l.amount; }, 0);
    var reg = area.registration;
    var base = reg.roundUpTo ? Math.ceil(value / reg.roundUpTo) * reg.roundUpTo : value;
    var registration = base * reg.pct / 100 + (reg.add || 0);
    if (reg.min != null) registration = Math.max(reg.min, registration);
    if (reg.max != null) registration = Math.min(reg.max, registration);
    return { lines: lines, duty: duty, registration: registration, total: duty + registration };
  }
  var maxLoanForValue = function (v) { return Math.max(Math.min(3e6, 0.9 * v), Math.min(7.5e6, 0.8 * v), 0.75 * v); };
  document.querySelectorAll('[data-stamp]').forEach(function (box) {
    var out = $('.out', box), states = window.STAMP || [];
    var stateEl = $('[name=state]', box), areaEl = $('[name=area]', box), buyerEl = $('[name=buyer]', box);
    var current = function () { return states.filter(function (s) { return s.slug === stateEl.value; })[0] || states[0]; };
    function fillAreas() {
      var s = current();
      areaEl.innerHTML = s.areas.map(function (a) { return '<option value="' + a.id + '">' + a.label + '</option>'; }).join('');
    }
    function run() {
      var s = current(), V = num($('[name=amount]', box));
      if (!s || !V) { out.innerHTML = ''; box._report = null; return; }
      var area = s.areas.filter(function (a) { return a.id === areaEl.value; })[0] || s.areas[0];
      var womanRate = area.duty.some(function (d) { return d.womanPct != null; });
      var r = stampDuty(area, V, buyerEl.value), loan = maxLoanForValue(V), down = V - loan;
      var pct = Math.round(r.total / V * 10000) / 100;
      box._report = {
        title: 'Stamp duty and registration in ' + s.name, file: 'stamp-duty-' + s.slug, subtitle: pageName() + '.',
        inputs: [['State', s.name], ['Where is the property', area.label], ['Buyer', buyerEl.value === 'woman' ? 'Woman' : 'Man'], ['Property value', inr(V)]],
        results: [['Stamp duty and registration', inr(r.total), true], ['Share of the property value', pct + '%']]
          .concat(r.lines.filter(function (l) { return l.pct > 0; }).map(function (l) { return [l.label + ' at ' + l.pct + '%', inr(l.amount)]; }),
            [['Registration fee', inr(r.registration)], ['Most a bank can lend', inr(loan)], ['Down payment', inr(down)], ['Cash you need in total', inr(down + r.total), true]]),
        notes: ['Rates are from the official ' + s.name + ' government website. Full rates, conditions and sources: ' + location.origin + s.url,
          'Duty is charged on the sale price or the government value of the property, whichever is higher. Banks usually do not fund stamp duty or registration.'],
      };
      out.innerHTML = '<div class="calcout"><div><div class="big">' + inr(r.total) + '<span> stamp duty and registration</span></div>' +
        '<p>' + r.lines.filter(function (l) { return l.pct > 0; }).map(function (l) { return l.label + ' at ' + l.pct + '%: <b>' + inr(l.amount) + '</b>'; }).join(' · ') +
        ' · registration fee <b>' + inr(r.registration) + '</b> · ' + pct + '% of the property value</p></div></div>' +
        (!womanRate ? '<p class="small">' + s.name + ' charges the same rate for men and women buyers.</p>' :
          buyerEl.value === 'man' ? '<p class="small">A woman buyer would pay <b>' + inr(stampDuty(area, V, 'woman').total) + '</b>.</p>' : '') +
        '<p class="verdict">With a home loan, a bank can lend up to <b>' + inr(loan) + '</b>. You pay the <b>' + inr(down) + '</b> down payment plus ' + inr(r.total) +
        ' in charges: about <b>' + inr(down + r.total) + '</b> from your own savings.</p>' +
        (location.pathname !== s.url ? '<p class="small"><a href="' + s.url + '">Stamp duty rates in ' + s.name + '</a></p>' : '');
    }
    stateEl.addEventListener('change', fillAreas);
    box.addEventListener('input', run);
    box.addEventListener('change', run);
    run();
  });

  // ---- Loan planner on loan-type pages: inputs left, charts and comparison right, bank list below ----
  var lakhS = function (n) { var t = function (x) { return String(+x.toFixed(2)); }; return n >= 1e7 ? '₹' + t(n / 1e7) + ' cr' : n >= 1e5 ? '₹' + t(n / 1e5) + ' lakh' : inr(n); };
  function plDonut(svg, P, I, e) {
    var tot = P + I, c = 2 * Math.PI * 78, p = tot ? P / tot : 1;
    svg.innerHTML = '<circle cx="100" cy="100" r="78" fill="none" stroke="#f2b632" stroke-width="22"/>' +
      '<circle cx="100" cy="100" r="78" fill="none" stroke="#001e60" stroke-width="22" stroke-dasharray="' + (c * p).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 100 100)"/>' +
      '<text x="100" y="95" text-anchor="middle" font-family="Source Serif 4, Georgia, serif" font-size="' + (e >= 1e6 ? 22 : 27) + '" font-weight="700" fill="#001e60">' + inr(e) + '</text>' +
      '<text x="100" y="117" text-anchor="middle" font-size="12" fill="#475569">EMI per month</text>' +
      '<text x="100" y="137" text-anchor="middle" font-size="11" fill="#64748b">Interest ' + Math.round((1 - p) * 100) + '% of total</text>';
  }
  function plBars(svg, ys) {
    var narrow = (svg.getBoundingClientRect().width || 520) < 440, W = narrow ? 340 : 520, H = narrow ? 220 : 240, l = 54, r = 6, t = 10, b = 28, cw = W - l - r, ch = H - t - b;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var max = Math.max.apply(null, ys.map(function (v) { return v.interest + v.principal; })) || 1;
    var raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = Math.ceil(raw / mag) * mag, top = step * 4, out = '';
    for (var k = 0; k <= 4; k++) {
      var gy = t + ch - ch * k / 4;
      out += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" stroke="#e2e8f0"/><text x="' + (l - 6) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#64748b">' + (k ? lakhS(step * k) : '0') + '</text>';
    }
    var n = ys.length, slot = cw / n, bw = Math.max(3, Math.min(34, slot * 0.68)), every = Math.ceil(n / (narrow ? 5 : 10));
    ys.forEach(function (v, j) {
      var x = l + slot * j + (slot - bw) / 2, hp = ch * v.principal / top, hi = ch * v.interest / top, base = t + ch;
      out += '<rect x="' + x.toFixed(1) + '" y="' + (base - hp).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hp.toFixed(1) + '" fill="#001e60"/>' +
        '<rect x="' + x.toFixed(1) + '" y="' + (base - hp - hi).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hi.toFixed(1) + '" fill="#f2b632"/>';
      if (j % every === 0 || j === n - 1) out += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="11" fill="#64748b">' + v.year + '</text>';
    });
    svg.innerHTML = out;
  }
  document.querySelectorAll('[data-planner]').forEach(function (box) {
    var D = window.PLANNER || { banks: [] }, B = D.banks;
    if (!B.length) return;
    var amt = $('#pl-amt', box), yrs = $('#pl-yrs', box), bankSel = $('[name=pl-bank]', box), own = $('[name=pl-own]', box);
    var pp = $('[name=pl-pp]', box), extraEl = $('[name=pl-extra]', box), table = document.querySelector('.pl-banks');
    var mode = function () { return $('[name=pl-mode]:checked', box).value; };
    function pick() {
      var m = mode();
      if (m === 'bank') { var i = +bankSel.value; return { name: B[i].name, short: B[i].short, rate: B[i].rate, i: i }; }
      if (m === 'own') return { name: 'Your rate', short: 'Your rate', rate: Math.max(0.01, num(own)), i: -1 };
      return { name: B[0].name, short: B[0].short, rate: B[0].rate, i: 0 };
    }
    function run() {
      var P = num(amt), y = Math.round(num(yrs));
      if (!P || !y) return;
      var c = pick(), ex = pp.checked ? num(extraEl) : 0;
      var me = schedule(P, c.rate, y, ex), base = ex ? schedule(P, c.rate, y) : me;
      var lo = schedule(P, B[0].rate, y, ex), hi = schedule(P, B[B.length - 1].rate, y, ex);
      var e = emi(P, c.rate, y), I = sum(me, 'interest'), Ilo = sum(lo, 'interest'), Ihi = sum(hi, 'interest'), Ibase = sum(base, 'interest');
      [].forEach.call(box.querySelectorAll('.pl-opt'), function (o) { o.classList.toggle('on', $('input[type=radio]', o).checked); });
      var isLow = c.i === 0 || (c.i > 0 && B[c.i].rate === B[0].rate);
      var chip = $('[data-chip]', box);
      chip.textContent = c.short + ' · ' + c.rate.toFixed(2) + '%' + (isLow ? ' · lowest of ' + B.length + ' banks' : '');
      chip.classList.toggle('best', isLow);
      plDonut($('[data-donut]', box), P, I, e);
      plBars($('[data-bars]', box), yearly(me));
      $('[data-col=me]', box).innerHTML = (c.i === -1 ? 'Your rate' : 'Your choice') + '<br>' + c.rate.toFixed(2) + '%';
      var rows = [['Monthly EMI', e, emi(P, B[0].rate, y), emi(P, B[B.length - 1].rate, y)], ['Total interest', I, Ilo, Ihi], ['Total payment', P + I, P + Ilo, P + Ihi]];
      $('[data-cmp]', box).innerHTML = rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="sel">' + inr(r[1]) + '</td><td class="hide-sm">' + inr(r[2]) + '</td><td>' + inr(r[3]) + '</td></tr>'; }).join('') +
        '<tr><td>Last EMI</td><td class="sel">' + monthLabel(me.length) + '</td><td class="hide-sm">' + monthLabel(lo.length) + '</td><td>' + monthLabel(hi.length) + '</td></tr>';
      var msg = [];
      if (Ihi - I > 1) msg.push('This choice saves <b>' + inr(Ihi - I) + '</b> in interest compared with the highest-rate bank.');
      if (ex && Ibase - I > 1) msg.push('Paying ' + inr(ex) + ' extra a month ends the loan ' + span(base.length - me.length) + ' early and saves <b>' + inr(Ibase - I) + '</b>.');
      var save = $('[data-save]', box); save.hidden = !msg.length; save.innerHTML = msg.join(' ');
      if (table) {
        $('[data-emi-head]', table).textContent = 'EMI · ' + lakhS(P) + ', ' + y + ' yrs';
        [].forEach.call(table.querySelectorAll('tr[data-i]'), function (tr) {
          var i = +tr.getAttribute('data-i'), s = schedule(P, B[i].rate, y, ex);
          $('[data-emi]', tr).textContent = inr(emi(P, B[i].rate, y));
          $('[data-int]', tr).textContent = inr(sum(s, 'interest'));
          tr.classList.toggle('on', i === c.i);
          $('.use', tr).textContent = i === c.i ? 'Showing' : 'Use';
        });
      }
      box._report = {
        title: D.name + ' comparison and repayment plan', file: D.slug + '-plan',
        subtitle: pageName() + '. Rates are each bank\'s advertised starting rate. First EMI in ' + monthLabel(1) + '.',
        inputs: [['Loan type', D.name], ['Amount', inr(P)], ['Tenure', y + ' years'], ['Rate used', c.name + ', ' + c.rate.toFixed(2) + '% a year']].concat(ex ? [['Extra payment every month', inr(ex)]] : []),
        results: [['Monthly EMI', inr(e), true], ['Total interest', inr(I)], ['Total payment', inr(P + I)], ['Last EMI', monthLabel(me.length)],
          ['Saving vs highest-rate bank', inr(Math.max(0, Ihi - I)), true]].concat(ex ? [['Saved by extra payments', inr(Ibase - I)]] : []),
        sections: [
          { title: 'Every bank at your amount and tenure', head: ['Bank', 'Starting rate', 'EMI', 'Total interest'], widths: [1.7, 0.9, 1, 1.1],
            rows: B.map(function (b) { var s = schedule(P, b.rate, y, ex); return [b.name, b.rate.toFixed(2) + '%', inr(emi(P, b.rate, y)), inr(sum(s, 'interest'))]; }) },
          { title: 'Year-by-year schedule at ' + c.rate.toFixed(2) + '%', head: ['Year', 'Principal', 'Interest', 'Total paid', 'Balance left'],
            rows: yearly(me).map(function (x) { return [x.year + (x.months < 12 ? ' (' + x.months + ' mo)' : ''), inr(x.principal), inr(x.interest), inr(x.paid), inr(x.balance)]; }) },
          { title: 'Month-by-month schedule', head: ['Month', 'EMI no.', 'Paid', 'Principal', 'Interest', 'Balance left'], widths: [1.1, 0.7, 1, 1, 1, 1.2],
            rows: me.map(function (r) { return [monthLabel(r.m), String(r.m), inr(r.paid), inr(r.principal), inr(r.interest), inr(r.balance)]; }) },
        ],
        notes: ['Rates are the starting rates published on each bank\'s own website; most borrowers are offered more depending on credit score, income and loan size.',
          'EMI = P x r x (1 + r)^n / ((1 + r)^n - 1), where P is the loan amount, r the monthly interest rate and n the number of EMIs.'],
      };
    }
    // Number box and slider stay in step.
    [].forEach.call(box.querySelectorAll('input[type=range][data-for]'), function (rg) {
      var box2 = document.getElementById(rg.getAttribute('data-for'));
      rg.addEventListener('input', function () { box2.value = rg.value; run(); });
      box2.addEventListener('input', function () { if (+box2.value > 0) rg.value = box2.value; });
    });
    box.addEventListener('input', run);
    box.addEventListener('change', function (ev) {
      if (ev.target.matches('[data-nav]')) { location.href = ev.target.value; return; }
      if (ev.target === bankSel) $('[name=pl-mode][value=bank]', box).checked = true;
      if (ev.target === own) $('[name=pl-mode][value=own]', box).checked = true;
      if (ev.target === pp) $('[data-ppbox]', box).hidden = !pp.checked;
      run();
    });
    own.addEventListener('focus', function () { $('[name=pl-mode][value=own]', box).checked = true; run(); });
    if (table) table.addEventListener('click', function (ev) {
      if (ev.target.closest('a')) return;
      var tr = ev.target.closest('tr[data-i]');
      if (!tr) return;
      bankSel.value = tr.getAttribute('data-i');
      $('[name=pl-mode][value=bank]', box).checked = true;
      run();
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    var rz;
    window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(run, 150); });
    run();
  });

  // ---- "Download PDF report" under every calculator ----
  // Each calculator keeps box._report up to date; pdf.js (loaded on first click) turns it into a PDF file.
  var PDF_BOXES = '[data-calc],[data-elig],[data-bt],[data-flat],[data-stamp]';
  function loadPdf(done, fail) {
    if (window.MMLPdf) return done();
    var app = document.querySelector('script[src*="app.js"]'), s = document.createElement('script');
    s.src = app ? app.src.replace(/app\.js.*$/, 'pdf.js') : '/pdf.js';
    s.onload = done; s.onerror = fail;
    document.head.appendChild(s);
  }
  document.querySelectorAll(PDF_BOXES).forEach(function (box) {
    var bar = document.createElement('div');
    bar.className = 'pdfbar';
    bar.innerHTML = '<button type="button" class="btn-pdf" data-pdf><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Download PDF report</button>' +
      '<span class="small">' + (box.hasAttribute('data-calc') ? 'Your inputs, results and full payment schedule' : 'Your inputs and results') + ' in one document.</span>';
    // Right under the inputs, so it is seen before the long results and schedules.
    box.insertBefore(bar, $('.out', box));
  });
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('[data-pdf]');
    if (!btn) return;
    // A button outside its calculator (the planner's "Download report" in the page header) names its target.
    var box = btn.closest(PDF_BOXES) || document.querySelector(btn.getAttribute('data-pdf-target') || '[data-none]'), note = btn.nextElementSibling;
    if (!box || !box._report) { note.textContent = 'Enter your loan details above first.'; return; }
    btn.disabled = true;
    loadPdf(function () {
      try {
        window.MMLPdf.download(box._report);
        note.textContent = 'Report downloaded. Check your downloads folder.';
      } catch (e) {
        note.textContent = 'Could not create the PDF. Please try again.';
      }
      btn.disabled = false;
    }, function () {
      note.textContent = 'Could not load the PDF tool. Check your connection and try again.';
      btn.disabled = false;
    });
  });

  // Header menu button (narrow screens). The links are always in the HTML; this only shows them.
  var menuBtn = $('.menu-btn'), mainNav = document.getElementById('main-nav');
  if (menuBtn && mainNav) {
    menuBtn.addEventListener('click', function () {
      var open = mainNav.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
  }

  // Copy-to-clipboard buttons (embed code).
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      var done = function () { var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
    });
  });

  // Home page: choose a loan type, amount and tenure and see the banks ranked by cost.
  // The ranking is already in the page from the server; this only redraws it on change.
  document.querySelectorAll('[data-quick]').forEach(function (box) {
    var out = $('.out', box), data = window.QUICK || {};
    var amountEl = $('[name=amount]', box), yearsEl = $('[name=years]', box);
    var shown = $('.amt output', box), tenure = $('.tenure', box);
    var tabs = [].slice.call(box.querySelectorAll('[data-loan]'));
    var active = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0];
    var current = active ? active.getAttribute('data-loan') : '';
    function showAmount() {
      var P = num(amountEl);
      if (shown) shown.innerHTML = inr(P) + ' <small>' + words(P) + '</small>';
    }
    function run() {
      var d = data[current], P = num(amountEl), y = num(yearsEl);
      showAmount();
      if (!d || !P || !y) return;
      out.innerHTML = rankHtml(rowsFor(d.banks, P, y), y, 5);
      var more = $('.more', box);
      if (more) {
        more.textContent = 'See all ' + d.banks.length + ' bank' + (d.banks.length > 1 ? 's' : '') + ', fees and prepayment rules';
        if (d.hub) more.href = d.hub;
      }
    }
    function setYears(y) {
      yearsEl.value = y;
      [].forEach.call(tenure.querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-years') === +y)); });
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var d = data[tab.getAttribute('data-loan')];
        if (!d) return;
        current = tab.getAttribute('data-loan');
        tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t === tab)); });
        amountEl.min = d.min; amountEl.max = d.max; amountEl.value = d.amount;
        tenure.innerHTML = d.tenures.map(function (t) { return '<button type="button" data-years="' + t + '" aria-pressed="false">' + t + ' yrs</button>'; }).join('');
        setYears(d.years);
        run();
      });
    });
    tenure.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-years]');
      if (!b) return;
      setYears(b.getAttribute('data-years'));
      run();
    });
    amountEl.addEventListener('input', run);
  });

  // Loan hub: tick banks, set amount and tenure, compare cost at each bank's starting rate.
  // Rate pages: the bank list is in the HTML; typing an amount or tenure updates each bank's EMI in place.
  document.querySelectorAll('[data-rates]').forEach(function (box) {
    var rows = [].slice.call(box.querySelectorAll('.rank[data-rate]')), verdict = $('.verdict', box);
    function run() {
      var P = num($('[name=amount]', box)), y = num($('[name=years]', box));
      if (!P || !y || !rows.length) return;
      var c = rows.map(function (r) { var e = emi(P, +r.getAttribute('data-rate'), y); return { r: r, e: e, i: e * y * 12 - P, name: r.getAttribute('data-name') }; });
      var best = c[0], worst = c[c.length - 1], max = Math.max.apply(null, c.map(function (x) { return x.i; })) || 1;
      c.forEach(function (x) {
        $('[data-emi]', x.r).textContent = 'EMI ' + inr(x.e) + ' / month';
        $('[data-extra]', x.r).textContent = x === best ? 'Interest ' + inr(x.i) : '+' + inr(x.i - best.i) + ' more interest';
        $('.bar i', x.r).style.width = Math.max(6, Math.round((x.i / max) * 100)) + '%';
      });
      if (verdict && c.length > 1) verdict.innerHTML = '<b>' + best.name + '</b> costs <b>' + inr(worst.i - best.i) + '</b> less interest than ' + worst.name + ' over ' + y + ' years, about <b>' + inr(worst.e - best.e) + '</b> less every month.';
    }
    box.addEventListener('input', run);
  });

  document.querySelectorAll('form[data-lead]').forEach(function (form) {
    var msg = $('.msg', form);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = new FormData(form);
      var body = {
        name: (f.get('name') || '').trim(),
        phone: (f.get('phone') || '').replace(/[\s-]/g, '').replace(/^\+?91/, ''),
        city: (f.get('city') || '').trim(),
        amount: parseFloat(f.get('amount')) || 0,
        consent: f.get('consent') === 'on',
        website: f.get('website') || '',
        loan: form.getAttribute('data-loan') || '',
        bank: form.getAttribute('data-bank') || '',
        page: location.pathname
      };
      if (!body.name || !/^[6-9]\d{9}$/.test(body.phone) || !body.consent) {
        msg.textContent = 'Please enter your name, a valid 10-digit mobile number and tick the consent box.';
        return;
      }
      msg.textContent = 'Sending...';
      fetch(window.CALC.worker + '/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function () { form.reset(); msg.textContent = 'Thank you. We will contact you soon.'; })
        .catch(function () { msg.textContent = 'Sorry, something went wrong. Please try again later.'; });
    });
  });
})();
