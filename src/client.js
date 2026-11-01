// Browser script: calculators, bank comparison and the lead form. No dependencies.
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var inr = function (n) { return '₹' + Math.round(n).toLocaleString('en-IN'); };
  var num = function (el) { return Math.max(0, parseFloat(el && el.value) || 0); };

  function emi(P, rate, years) {
    var n = years * 12, r = rate / 1200;
    if (!r) return P / n;
    var f = Math.pow(1 + r, n);
    return (P * r * f) / (f - 1);
  }

  document.querySelectorAll('[data-calc]').forEach(function (box) {
    var out = $('.out', box);
    function run() {
      var P = num($('[name=amount]', box)), rate = num($('[name=rate]', box)), y = num($('[name=years]', box));
      if (!P || !y) { out.innerHTML = ''; return; }
      var e = emi(P, rate, y), total = e * y * 12;
      out.innerHTML =
        '<div class="big">' + inr(e) + '<span> per month</span></div>' +
        '<p>Total interest: <b>' + inr(total - P) + '</b> · Total payment: <b>' + inr(total) + '</b></p>';
    }
    box.addEventListener('input', run);
    run();
  });

  // Pick banks, set amount and tenure, see EMI and extra interest at each bank's starting rate.
  document.querySelectorAll('[data-compare]').forEach(function (box) {
    var out = $('.out', box);
    var products = window.PRODUCTS || [];
    function run() {
      var P = num($('[name=amount]', box)), y = num($('[name=years]', box));
      var picked = [].slice.call(box.querySelectorAll('input[type=checkbox]:checked')).map(function (c) { return c.value; });
      var rows = products.filter(function (p) { return picked.indexOf(p.slug) > -1; }).map(function (p) {
        var e = emi(P, p.rate, y);
        return { name: p.name, rate: p.rate, emi: e, interest: e * y * 12 - P };
      }).sort(function (a, b) { return a.interest - b.interest; });
      if (!P || !y || !rows.length) { out.innerHTML = '<p>Choose at least one bank.</p>'; return; }
      var best = rows[0].interest;
      out.innerHTML = '<div class="scroll"><table><thead><tr><th>Bank</th><th>Starting rate</th><th>EMI</th><th>Total interest</th><th>Extra vs lowest</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td>' + r.name + '</td><td>' + r.rate + '%</td><td>' + inr(r.emi) + '</td><td>' + inr(r.interest) + '</td><td>' + (r.interest - best < 1 ? 'Lowest' : '+' + inr(r.interest - best)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="small">Uses each bank\'s advertised starting rate. Your own rate depends on your credit score and profile and may be higher.</p>';
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
