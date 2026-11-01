// Browser script: calculators, bank comparison and the lead form. No dependencies.
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var inr = function (n) { return '₹' + Math.round(n).toLocaleString('en-IN'); };
  var num = function (el) { return Math.max(0, parseFloat(el && el.value) || 0); };
  var hue = function (s) { var h = 7; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
  var initials = function (s) { return s.split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); };
  var avatar = function (name) { return '<span class="av" style="--h:' + hue(name) + '">' + initials(name) + '</span>'; };

  function emi(P, rate, years) {
    var n = years * 12, r = rate / 1200;
    if (!r) return P / n;
    var f = Math.pow(1 + r, n);
    return (P * r * f) / (f - 1);
  }

  // Ranked list with a cost bar per bank (shared by the home tool and the hub compare tool).
  function rankHtml(rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.interest; })) || 1;
    var best = rows[0].interest;
    return rows.map(function (r, i) {
      var isBest = i === 0 && rows.length > 1;
      var extra = r.interest - best < 1 ? '' : '<span class="extra">+' + inr(r.interest - best) + ' interest vs lowest</span>';
      return '<div class="rank' + (isBest ? ' best' : '') + '">' + avatar(r.name) +
        '<span class="nm"><b>' + (r.url ? '<a href="' + r.url + '">' + r.name + '</a>' : r.name) + (isBest ? '<span class="badge">Lowest cost</span>' : '') + '</b>' +
        '<span class="small">Starting rate ' + r.rate + '%</span></span>' +
        '<span class="px"><b>' + inr(r.emi) + '</b> / month<br>' + (extra || '<span class="extra">Interest ' + inr(r.interest) + '</span>') + '</span>' +
        '<span class="bar"><i style="width:' + Math.max(6, Math.round((r.interest / max) * 100)) + '%"></i></span></div>';
    }).join('') + '<p class="small">At each bank\'s advertised starting rate. Your own rate depends on your credit score and profile and may be higher.</p>';
  }

  function rowsFor(banks, P, y) {
    return banks.map(function (b) {
      var e = emi(P, b.rate, y);
      return { name: b.name, rate: b.rate, url: b.url, emi: e, interest: e * y * 12 - P };
    }).sort(function (a, c) { return a.interest - c.interest; });
  }

  function donut(P, interest) {
    var total = P + interest, p = (P / total) * 100, i = 100 - p;
    return '<svg class="donut" viewBox="0 0 36 36" role="img" aria-label="Principal ' + Math.round(p) + ' percent, interest ' + Math.round(i) + ' percent">' +
      '<circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--accent)" stroke-width="4.5" stroke-dasharray="' + p + ' 100" transform="rotate(-90 18 18)"/>' +
      '<circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--accent3)" stroke-width="4.5" stroke-dasharray="' + i + ' 100" stroke-dashoffset="-' + p + '" transform="rotate(-90 18 18)"/></svg>' +
      '<div class="legend"><div><i style="background:var(--accent)"></i>Principal ' + inr(P) + '</div><div><i style="background:var(--accent3)"></i>Interest ' + inr(interest) + '</div></div>';
  }

  document.querySelectorAll('[data-calc]').forEach(function (box) {
    var out = $('.out', box);
    function run() {
      var P = num($('[name=amount]', box)), rate = num($('[name=rate]', box)), y = num($('[name=years]', box));
      if (!P || !y) { out.innerHTML = ''; return; }
      var e = emi(P, rate, y), total = e * y * 12;
      out.innerHTML = '<div class="calcout"><div><div class="big">' + inr(e) + '<span> per month</span></div>' +
        '<p>Total interest: <b>' + inr(total - P) + '</b> · Total payment: <b>' + inr(total) + '</b></p></div>' +
        '<div class="calcout">' + donut(P, total - P) + '</div></div>';
    }
    box.addEventListener('input', run);
    run();
  });

  // Home page: choose a loan type, amount and tenure and see the banks ranked by cost.
  document.querySelectorAll('[data-quick]').forEach(function (box) {
    var out = $('.out', box), sel = $('[name=loan]', box);
    var data = window.QUICK || {};
    var amountEl = $('[name=amount]', box), yearsEl = $('[name=years]', box);
    function run() {
      var d = data[sel.value], P = num(amountEl), y = num(yearsEl);
      if (!d || !P || !y) { out.innerHTML = ''; return; }
      out.innerHTML = rankHtml(rowsFor(d.banks, P, y));
    }
    sel.addEventListener('change', function () {
      var d = data[sel.value];
      if (d) { amountEl.value = d.amount; yearsEl.value = d.years; }
      run();
    });
    box.addEventListener('input', run);
    run();
  });

  // Loan hub: tick banks, set amount and tenure, compare cost at each bank's starting rate.
  document.querySelectorAll('[data-compare]').forEach(function (box) {
    var out = $('.out', box);
    var products = window.PRODUCTS || [];
    function run() {
      var P = num($('[name=amount]', box)), y = num($('[name=years]', box));
      var picked = [].slice.call(box.querySelectorAll('input[type=checkbox]:checked')).map(function (c) { return c.value; });
      var banks = products.filter(function (p) { return picked.indexOf(p.slug) > -1; });
      if (!P || !y || !banks.length) { out.innerHTML = '<p>Choose at least one bank.</p>'; return; }
      out.innerHTML = rankHtml(rowsFor(banks, P, y));
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
