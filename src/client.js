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
    if (slug && LOGOS[slug]) return '<span class="av has-logo"><img src="' + LOGOS[slug] + '" alt="" width="22" height="22" loading="lazy" decoding="async"></span>';
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

  // Same maths as src/math.js: month-by-month schedule with optional extra payments.
  function schedule(P, rate, years, extraM, extraY) {
    var r = rate / 1200, e = emi(P, rate, years), rows = [], bal = P;
    for (var m = 1; bal > 0.5 && m <= years * 12 + 1; m++) {
      var interest = bal * r;
      var extra = (extraM || 0) + (m % 12 === 0 ? (extraY || 0) : 0);
      var principal = Math.min(bal, Math.max(0, e - interest) + extra);
      bal -= principal;
      rows.push({ m: m, interest: interest, principal: principal, paid: interest + principal, balance: Math.max(0, bal) });
    }
    return rows;
  }
  function yearly(rows) {
    var out = [];
    rows.forEach(function (r) {
      var y = Math.ceil(r.m / 12), c = out[y - 1] || (out[y - 1] = { year: y, principal: 0, interest: 0, paid: 0, balance: 0 });
      c.principal += r.principal; c.interest += r.interest; c.paid += r.paid; c.balance = r.balance;
    });
    return out;
  }
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
  function rankHtml(rows, years) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.interest; })) || 1, best = rows[0];
    var verdict = '';
    if (rows.length > 1) {
      var worst = rows[rows.length - 1];
      verdict = '<p class="verdict"><b>' + best.name + '</b> costs <b>' + inr(worst.interest - best.interest) + '</b> less interest than ' + worst.name +
        ' over ' + years + ' years, about <b>' + inr(worst.emi - best.emi) + '</b> less every month.</p>';
    }
    return verdict + rows.map(function (r, i) {
      var isBest = i === 0 && rows.length > 1;
      var extra = r.interest - best.interest < 1 ? '' : '<span class="extra">+' + inr(r.interest - best.interest) + ' more interest</span>';
      return '<div class="rank' + (isBest ? ' best' : '') + '">' + avatar(r.name, r.slug) +
        '<span class="nm"><b>' + (r.url ? '<a href="' + r.url + '">' + r.name + '</a>' : r.name) + (isBest ? '<span class="badge">Lowest cost</span>' : '') + '</b>' +
        '<span class="small">Starting rate ' + r.rate + '%</span></span>' +
        '<span class="px"><b>' + inr(r.emi) + '</b> / month<br>' + (extra || '<span class="extra">Interest ' + inr(r.interest) + '</span>') + '</span>' +
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
        return '<div class="col" title="Year ' + y.year + ': principal ' + inr(y.principal) + ', interest ' + inr(y.interest) + '"><div class="stack" style="height:' + h + '%">' +
          '<i class="i" style="height:' + ip + '%"></i><i class="p" style="height:' + (100 - ip) + '%"></i></div><span>' + y.year + '</span></div>';
      }).join('');
      var body = ys.map(function (y) {
        return '<tr><td>Year ' + y.year + '</td><td>' + inr(y.principal) + '</td><td>' + inr(y.interest) + '</td><td>' + inr(y.paid) + '</td><td>' + inr(y.balance) + '</td></tr>';
      }).join('');
      return head + '<div class="chart" aria-hidden="true">' + bars + '</div>' +
        '<p class="legend"><i style="background:var(--accent)"></i>Principal <i style="background:var(--accent3);margin-left:12px"></i>Interest, each bar is one year of payments. Early years are mostly interest.</p>' +
        '<div class="scroll"><table><thead><tr><th>Year</th><th>Principal</th><th>Interest</th><th>Paid</th><th>Balance left</th></tr></thead><tbody>' + body + '</tbody></table></div>';
    }
    var yr = Math.min(box._yr || 1, ys.length || 1);
    var opts = ys.map(function (y) { return '<option value="' + y.year + '"' + (y.year === yr ? ' selected' : '') + '>Year ' + y.year + '</option>'; }).join('');
    var mrows = rows.filter(function (r) { return Math.ceil(r.m / 12) === yr; }).map(function (r) {
      return '<tr><td>Month ' + r.m + '</td><td>' + inr(r.paid) + '</td><td>' + inr(r.principal) + '</td><td>' + inr(r.interest) + '</td><td>' + inr(r.balance) + '</td></tr>';
    }).join('');
    return head + '<label for="yr-' + box._id + '">Show payments for</label><select id="yr-' + box._id + '" name="yr">' + opts + '</select>' +
      '<div class="scroll" style="margin-top:10px"><table><thead><tr><th>Month</th><th>Paid</th><th>Principal</th><th>Interest</th><th>Balance left</th></tr></thead><tbody>' + mrows + '</tbody></table></div>' +
      '<p class="small">Each payment is split between interest on what you still owe and repayment of principal.</p>';
  }

  var uid = 0;
  document.querySelectorAll('[data-calc]').forEach(function (box) {
    box._id = ++uid;
    var out = $('.out', box);
    function run() {
      var P = num($('[name=amount]', box)), rate = num($('[name=rate]', box)), y = num($('[name=years]', box));
      var xm = num($('[name=extraM]', box)), xy = num($('[name=extraY]', box));
      if (!P || !y) { out.innerHTML = ''; return; }
      var base = schedule(P, rate, y, 0, 0), rows = xm || xy ? schedule(P, rate, y, xm, xy) : base;
      var e = emi(P, rate, y), interest = sum(rows, 'interest'), paid = P + interest;
      var saved = sum(base, 'interest') - interest;
      out.innerHTML = '<div class="calcout"><div><div class="big">' + inr(e) + '<span> per month</span></div>' +
        '<p>Total interest: <b>' + inr(interest) + '</b> · Total payment: <b>' + inr(paid) + '</b></p>' +
        (saved > 1 ? '<p class="saving">With your extra payments you finish <b>' + span(base.length - rows.length) + ' earlier</b> and save <b>' + inr(saved) + '</b> in interest.</p>' : '') +
        '</div><div class="calcout">' + donut(P, interest) + '</div></div>' +
        '<div class="sched">' + scheduleHtml(box, rows) + '</div>';
    }
    box.addEventListener('input', function (ev) {
      if (ev.target.name === 'yr') box._yr = parseInt(ev.target.value, 10) || 1;
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

  // Home page: choose a loan type, amount and tenure and see the banks ranked by cost.
  document.querySelectorAll('[data-quick]').forEach(function (box) {
    var out = $('.out', box), sel = $('[name=loan]', box), data = window.QUICK || {};
    var amountEl = $('[name=amount]', box), yearsEl = $('[name=years]', box);
    function run() {
      var d = data[sel.value], P = num(amountEl), y = num(yearsEl);
      if (!d || !P || !y) { out.innerHTML = ''; return; }
      out.innerHTML = rankHtml(rowsFor(d.banks, P, y), y);
    }
    sel.addEventListener('change', function () {
      var d = data[sel.value];
      if (d) { amountEl.value = d.amount; yearsEl.value = d.years; hints(box); }
      run();
    });
    box.addEventListener('input', run);
    run();
  });

  // Loan hub: tick banks, set amount and tenure, compare cost at each bank's starting rate.
  document.querySelectorAll('[data-compare]').forEach(function (box) {
    var out = $('.out', box), products = window.PRODUCTS || [];
    function run() {
      var P = num($('[name=amount]', box)), y = num($('[name=years]', box));
      var picked = [].slice.call(box.querySelectorAll('input[type=checkbox]:checked')).map(function (c) { return c.value; });
      var banks = products.filter(function (p) { return picked.indexOf(p.slug) > -1; });
      if (!P || !y || !banks.length) { out.innerHTML = '<p>Choose at least one bank.</p>'; return; }
      out.innerHTML = rankHtml(rowsFor(banks, P, y), y);
    }
    box.addEventListener('input', run);
    run();
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
