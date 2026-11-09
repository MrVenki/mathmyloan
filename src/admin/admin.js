// MathMyLoan admin: review scraped rates, edit rates, banks and sources, and publish.
// There is no server: you sign in with a GitHub access token for the site's repository,
// and "Publish" commits the changed data files in one commit, which rebuilds the site.
(function () {
  'use strict';
  var REPO = '__REPO__';
  var BRANCH = '__BRANCH__';
  var API = 'https://api.github.com/repos/' + REPO;
  var FILES = {
    products: 'data/products.json',
    banks: 'data/banks.json',
    loans: 'data/loans.json',
    sources: 'data/sources.json',
    drafts: 'data/drafts.json',
    history: 'data/history.json',
  };
  var ONE_LINE = { banks: true, sources: true };
  var KEY = 'mml-admin-token';

  var S = { token: null, user: '', head: null, data: {}, dirty: {}, tab: 'review', status: 'todo', loan: '', bank: '' };
  var app = document.getElementById('app');
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var pct = function (v) { return v == null || v === '' ? '–' : v + '%'; };

  // ---------- GitHub API ----------
  function gh(path, opts) {
    opts = opts || {};
    var headers = { Authorization: 'Bearer ' + S.token, Accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(path.indexOf('https://') === 0 ? path : API + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { var e = new Error('GitHub ' + r.status + ': ' + t.slice(0, 200)); e.status = r.status; throw e; });
      if (r.status === 204) return null;
      return opts.raw ? r.text() : r.json();
    });
  }
  function readFile(path, ref) { return gh('/contents/' + path + '?ref=' + encodeURIComponent(ref), { raw: true }).then(JSON.parse); }

  function serialize(name, v) {
    if (ONE_LINE[name]) {
      return '[\n' + v.map(function (o) {
        return '  { ' + Object.keys(o).filter(function (k) { return o[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ': ' + JSON.stringify(o[k]); }).join(', ') + ' }';
      }).join(',\n') + '\n]\n';
    }
    return JSON.stringify(v, null, 2) + '\n';
  }

  function loadAll() {
    return gh('/commits/' + BRANCH).then(function (c) {
      S.head = c.sha;
      return Promise.all(Object.keys(FILES).map(function (k) {
        return readFile(FILES[k], S.head).then(function (d) { S.data[k] = d; }, function (e) {
          if (e.status === 404) S.data[k] = k === 'drafts' ? { items: [], summary: {} } : [];
          else throw e;
        });
      }));
    }).then(function () { S.dirty = {}; });
  }

  // Scraper runs may commit new drafts while you edit; your decisions are carried over to them.
  function mergeDrafts(latest) {
    var mine = {};
    S.data.drafts.items.forEach(function (i) { if (i.review !== 'pending' || i.edited) mine[i.id] = i; });
    latest.items.forEach(function (i) {
      var m = mine[i.id];
      if (m && m.found === i.found) { i.review = m.review; i.proposed = m.proposed; i.reviewedOn = m.reviewedOn; i.edited = m.edited; }
    });
    return latest;
  }

  function publish() {
    var names = Object.keys(S.dirty);
    if (!names.length) return Promise.resolve();
    var btn = $('#publish');
    btn.disabled = true;
    btn.textContent = 'Publishing…';
    var head;
    return gh('/git/ref/heads/' + BRANCH).then(function (ref) {
      head = ref.object.sha;
      if (head === S.head) return;
      return gh('/compare/' + S.head + '...' + head).then(function (cmp) {
        var changed = (cmp.files || []).map(function (f) { return f.filename; });
        var clash = names.filter(function (n) { return changed.indexOf(FILES[n]) >= 0 && n !== 'drafts'; });
        if (clash.length) throw new Error('Someone else changed ' + clash.map(function (n) { return FILES[n]; }).join(', ') + ' since you opened this page. Reload and make your changes again.');
        if (S.dirty.drafts && changed.indexOf(FILES.drafts) >= 0) return readFile(FILES.drafts, head).then(function (d) { S.data.drafts = mergeDrafts(d); });
      });
    }).then(function () {
      return gh('/git/commits/' + head);
    }).then(function (commit) {
      return gh('/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree: names.map(function (n) { return { path: FILES[n], mode: '100644', type: 'blob', content: serialize(n, S.data[n]) }; }) } });
    }).then(function (tree) {
      var msg = 'admin: ' + (S.summary || 'update rates') + ' (by ' + S.user + ')';
      return gh('/git/commits', { method: 'POST', body: { message: msg, tree: tree.sha, parents: [head] } });
    }).then(function (c) {
      return gh('/git/refs/heads/' + BRANCH, { method: 'PATCH', body: { sha: c.sha } }).then(function () { return c; });
    }).then(function (c) {
      S.head = c.sha;
      S.dirty = {};
      S.summary = '';
      flash('Published. The site rebuilds in about 2 minutes.', 'ok');
      render();
    }).catch(function (e) {
      flash(e.message, 'err');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Publish to site';
    });
  }

  // ---------- state helpers ----------
  function touch() {
    for (var i = 0; i < arguments.length; i++) S.dirty[arguments[i]] = true;
    updateBar();
  }
  function note(s) { S.summary = S.summary ? S.summary.split('; ').concat(s).filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(-4).join('; ') : s; }
  function updateBar() {
    var n = Object.keys(S.dirty).length;
    $('#bar').hidden = !n;
    $('#dirty').textContent = n ? 'Unpublished changes in ' + Object.keys(S.dirty).map(function (k) { return k; }).join(', ') : '';
  }
  function flash(text, kind) {
    var el = document.createElement('div');
    el.className = 'msg ' + (kind || 'info');
    el.textContent = text;
    var box = $('#flash');
    box.innerHTML = '';
    box.appendChild(el);
    window.scrollTo(0, 0);
    if (kind !== 'err') setTimeout(function () { el.remove(); }, 8000);
  }
  var bankName = function (slug) { var b = S.data.banks.find(function (x) { return x.slug === slug; }); return b ? b.name : slug; };
  var loanName = function (slug) { var l = S.data.loans.find(function (x) { return x.slug === slug; }); return l ? l.name : slug === '*' ? 'All loans on the page' : slug; };
  var productOf = function (bank, loan) { return S.data.products.find(function (p) { return p.bank === bank && p.loan === loan; }); };
  var num = function (v) { var n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : null; };
  var slugify = function (s) { return String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };

  function setProduct(bank, loan, fields) {
    var list = S.data.products;
    var p = productOf(bank, loan);
    var before = p ? p.rateFrom : null;
    if (!p) { p = { bank: bank, loan: loan }; list.push(p); }
    Object.keys(fields).forEach(function (k) {
      var v = fields[k];
      if (v === '' || v === undefined) v = null;
      if ((k === 'effectiveFrom' || k === 'conditions' || k === 'note') && v == null) delete p[k];
      else p[k] = v;
    });
    delete p.review;
    if (before != null && before !== p.rateFrom) {
      S.data.history.push({ date: today(), bank: bank, loan: loan, from: before, to: p.rateFrom, sourceUrl: p.sourceUrl });
      touch('history');
    }
    touch('products');
  }

  // ---------- review ----------
  function approve(item) {
    var pr = item.proposed || {};
    var rate = num(pr.rateFrom);
    if (!(rate > 0 && rate < 40)) return flash('Enter a valid rate for ' + bankName(item.bank) + ' before approving.', 'err');
    // A rate read from the page carries the scrape date; one you typed in carries today's.
    var checked = item.found != null && rate === item.found ? item.checkedOn : today();
    setProduct(item.bank, item.loan, {
      rateFrom: rate,
      effectiveFrom: pr.effectiveFrom || null,
      conditions: pr.conditions || null,
      fee: pr.fee || null,
      prepayment: pr.prepayment || null,
      maxTenureYears: num(pr.maxTenureYears),
      sourceUrl: item.url,
      retrievedOn: checked,
    });
    item.review = 'approved';
    item.reviewedOn = today();
    item.live = rate;
    note('approved ' + item.bank + ' ' + item.loan);
    touch('drafts');
  }
  function reject(item) {
    item.review = 'rejected';
    item.reviewedOn = today();
    note('rejected ' + item.bank + ' ' + item.loan);
    touch('drafts');
  }
  function undo(item) {
    item.review = 'pending';
    delete item.reviewedOn;
    touch('drafts');
  }
  function approveSame() {
    var n = 0;
    S.data.drafts.items.forEach(function (i) {
      if (i.status !== 'same' || i.review !== 'pending') return;
      var p = productOf(i.bank, i.loan);
      if (!p) return;
      p.retrievedOn = i.checkedOn;
      p.sourceUrl = i.url;
      i.review = 'approved';
      i.reviewedOn = today();
      n++;
    });
    if (n) { note('confirmed ' + n + ' unchanged rates'); touch('products', 'drafts'); }
    flash(n + ' unchanged rates confirmed with today\'s check date. Publish to save.', 'ok');
    render();
  }

  var STATUS = { suspect: 'Check carefully', changed: 'Rate changed', new: 'New', failed: 'Could not read', manual: 'Check by hand', same: 'Unchanged' };
  var FILTERS = [['todo', 'To review'], ['suspect', 'Check carefully'], ['changed', 'Changed'], ['new', 'New'], ['failed', 'Could not read'], ['manual', 'By hand'], ['same', 'Unchanged'], ['done', 'Decided']];

  // True when text quotes a rate, e.g. 8.8 written as "8.80%" or "8.8%".
  function staleText(text, rate) {
    return new RegExp('(^|[^\\d.])' + String(rate).replace('.', '\\.') + '0?\\s*%').test(text || '');
  }

  function inFilter(i) {
    if (S.loan && i.loan !== S.loan) return false;
    if (S.status === 'todo') return i.review === 'pending' && i.status !== 'same';
    if (S.status === 'done') return i.review !== 'pending';
    return i.status === S.status && i.review === 'pending';
  }

  function loanOptions(sel, withAll) {
    return (withAll ? '<option value="">All loan types</option>' : '') + S.data.loans.map(function (l) { return '<option value="' + esc(l.slug) + '"' + (l.slug === sel ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('');
  }

  function reviewTab() {
    var d = S.data.drafts;
    var items = d.items || [];
    var count = function (f) { var keep = S.status; S.status = f; var n = items.filter(inFilter).length; S.status = keep; return n; };
    var sameN = items.filter(function (i) { return i.status === 'same' && i.review === 'pending'; }).length;
    var list = items.filter(inFilter);
    var html = '<h1>Review scraped rates</h1><p class="muted">Last scrape ' + (d.updatedAt ? esc(new Date(d.updatedAt).toLocaleString('en-IN')) : 'never') + '. Nothing reaches the site until you approve it and publish.</p>' +
      '<div class="row"><select id="f-loan">' + loanOptions(S.loan, true) + '</select>' +
      (sameN ? '<button class="b" id="same">Confirm ' + sameN + ' unchanged rates</button>' : '') + '</div>' +
      '<div class="chips">' + FILTERS.map(function (f) { return '<button class="chip" data-f="' + f[0] + '" aria-pressed="' + (S.status === f[0]) + '">' + esc(f[1]) + ' (' + count(f[0]) + ')</button>'; }).join('') + '</div>';
    if (!list.length) html += '<div class="card muted">Nothing here.</div>';
    html += list.map(function (i) {
      var idx = items.indexOf(i);
      var pr = i.proposed || {};
      var p = productOf(i.bank, i.loan);
      return '<div class="card item" data-i="' + idx + '"><div>' +
        '<div class="row"><span class="badge ' + i.status + '">' + esc(STATUS[i.status]) + '</span>' + (i.review !== 'pending' ? '<span class="badge ' + i.review + '">' + esc(i.review) + '</span>' : '') +
        (i.liveHeld ? '<span class="badge suspect">live rate is held</span>' : '') + '<h3>' + esc(bankName(i.bank)) + ' · ' + esc(loanName(i.loan)) + '</h3></div>' +
        '<div class="rates">' + (i.live != null && i.found !== i.live ? '<s>' + esc(pct(i.live)) + '</s> → ' : '') + '<b>' + esc(pct(i.found != null ? i.found : i.live)) + '</b> <span class="muted" style="font-size:.85rem">' +
        (i.found != null ? 'found by ' + esc(i.method) + ' via ' + esc(i.via) : '') + ' · <a href="' + esc(i.url) + '" target="_blank" rel="noopener">source page</a>' + (p ? ' · live checked ' + esc(p.retrievedOn) : '') + '</span></div>' +
        (i.error ? '<div class="muted">' + esc(i.error) + '</div>' : '') +
        (i.live != null && i.found != null && i.found !== i.live && staleText(pr.conditions, i.live) ? '<div class="msg info" style="margin:6px 0 0">The conditions still mention ' + esc(pct(i.live)) + '. Update them under "Edit before approving".</div>' : '') +
        (i.evidence ? '<pre class="ev">' + esc(i.evidence) + '</pre>' : '') +
        (i.alternatives && i.review === 'pending' ? '<div class="chips"><span class="muted" style="font-size:.85rem;align-self:center">Other rates on the page:</span>' + i.alternatives.map(function (a, k) { return '<button class="chip" data-alt="' + k + '" title="' + esc(a.evidence) + '">Use ' + esc(pct(a.value)) + '</button>'; }).join('') + '</div>' : '') +
        '<details' + (i.status === 'new' || i.status === 'failed' || i.status === 'manual' ? ' open' : '') + '><summary class="muted" style="cursor:pointer;margin-top:8px">Edit before approving</summary><div class="fields">' +
        '<label>Rate from (%)<input type="number" step="0.01" data-k="rateFrom" value="' + esc(pr.rateFrom) + '"></label>' +
        '<label>Effective from<input type="date" data-k="effectiveFrom" value="' + esc(pr.effectiveFrom) + '"></label>' +
        '<label>Max tenure (years)<input type="number" step="1" data-k="maxTenureYears" value="' + esc(pr.maxTenureYears) + '"></label>' +
        '<label class="wide">Conditions for this rate<textarea data-k="conditions">' + esc(pr.conditions) + '</textarea></label>' +
        '<label class="wide">Processing fee<input type="text" data-k="fee" value="' + esc(pr.fee) + '"></label>' +
        '<label class="wide">Prepayment<input type="text" data-k="prepayment" value="' + esc(pr.prepayment) + '"></label>' +
        '</div></details></div><div class="row" style="align-items:flex-start">' +
        (i.review === 'pending' ? '<button class="b ok" data-a="approve">Approve</button><button class="b no" data-a="reject">Reject</button>' : '<button class="b sm" data-a="undo">Undo</button>') +
        '</div></div>';
    }).join('');
    app.innerHTML = html;
    $('#f-loan').onchange = function (e) { S.loan = e.target.value; render(); };
    if ($('#same')) $('#same').onclick = approveSame;
    app.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { S.status = b.getAttribute('data-f'); render(); }; });
    app.querySelectorAll('.item').forEach(function (card) {
      var item = items[+card.getAttribute('data-i')];
      card.querySelectorAll('[data-k]').forEach(function (inp) {
        inp.onchange = function () {
          item.proposed = item.proposed || {};
          var k = inp.getAttribute('data-k');
          item.proposed[k] = inp.type === 'number' ? num(inp.value) : inp.value.trim();
          item.edited = true;
          touch('drafts');
        };
      });
      // Picking another rate the scraper saw swaps it in, with the page text it came from.
      card.querySelectorAll('[data-alt]').forEach(function (b) {
        b.onclick = function () {
          var k = +b.getAttribute('data-alt');
          var alt = item.alternatives[k];
          item.alternatives[k] = { value: item.found, evidence: item.evidence };
          item.found = alt.value;
          item.evidence = alt.evidence;
          item.proposed = item.proposed || {};
          item.proposed.rateFrom = alt.value;
          item.edited = true;
          touch('drafts');
          render();
        };
      });
      card.querySelectorAll('[data-a]').forEach(function (b) {
        b.onclick = function () {
          var a = b.getAttribute('data-a');
          if (a === 'approve') approve(item);
          if (a === 'reject') reject(item);
          if (a === 'undo') undo(item);
          render();
        };
      });
    });
  }

  // ---------- rates ----------
  function ratesTab() {
    var loan = S.loan || S.data.loans[0].slug;
    var list = S.data.products.filter(function (p) { return p.loan === loan; }).sort(function (a, b) { return a.rateFrom - b.rateFrom; });
    var missing = S.data.banks.filter(function (b) { return !productOf(b.slug, loan); });
    var cell = function (p, k, type, extra) { return '<td><input type="' + type + '" data-k="' + k + '" value="' + esc(p[k]) + '"' + (extra || '') + '></td>'; };
    app.innerHTML = '<h1>Rates</h1><p class="muted">Edit any rate directly. Changing a rate here records it in the rate history.</p>' +
      '<div class="row"><select id="f-loan">' + loanOptions(loan) + '</select><span class="muted">' + list.length + ' banks</span></div>' +
      '<div class="scroll" style="margin-top:12px"><table><thead><tr><th>Bank</th><th>Rate %</th><th style="min-width:240px">Conditions</th><th>Fee</th><th>Prepayment</th><th>Max yrs</th><th>Effective</th><th style="min-width:200px">Source URL</th><th>Checked on</th><th>Hold</th><th></th></tr></thead><tbody>' +
      list.map(function (p) {
        return '<tr data-b="' + esc(p.bank) + '"><td><b>' + esc(bankName(p.bank)) + '</b></td>' + cell(p, 'rateFrom', 'number', ' step="0.01"') + cell(p, 'conditions', 'text') + cell(p, 'fee', 'text') + cell(p, 'prepayment', 'text') +
          cell(p, 'maxTenureYears', 'number', ' step="1"') + cell(p, 'effectiveFrom', 'date') + cell(p, 'sourceUrl', 'url') + cell(p, 'retrievedOn', 'date') +
          '<td><input type="checkbox" data-k="review"' + (p.review ? ' checked' : '') + ' title="Hide this rate from the site"></td><td><button class="b sm no" data-del>Remove</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      (missing.length ? '<div class="card row"><b>Add a bank to ' + esc(loanName(loan)) + '</b><select id="add-bank">' + missing.map(function (b) { return '<option value="' + esc(b.slug) + '">' + esc(b.name) + '</option>'; }).join('') + '</select><input type="number" step="0.01" id="add-rate" placeholder="Rate %"><input type="url" id="add-url" placeholder="Official source URL" style="flex:1;min-width:220px"><button class="b p" id="add">Add</button></div>' : '');
    $('#f-loan').onchange = function (e) { S.loan = e.target.value; render(); };
    app.querySelectorAll('tbody tr').forEach(function (tr) {
      var p = productOf(tr.getAttribute('data-b'), loan);
      tr.querySelectorAll('[data-k]').forEach(function (inp) {
        inp.onchange = function () {
          var k = inp.getAttribute('data-k');
          if (k === 'review') { if (inp.checked) p.review = true; else delete p.review; touch('products'); return; }
          var v = inp.type === 'number' ? num(inp.value) : inp.value.trim() || null;
          if (k === 'rateFrom') { setProduct(p.bank, loan, { rateFrom: v }); note('edited ' + p.bank + ' ' + loan); return; }
          if (v == null && (k === 'conditions' || k === 'effectiveFrom')) delete p[k]; else p[k] = v;
          note('edited ' + p.bank + ' ' + loan);
          touch('products');
        };
      });
      tr.querySelector('[data-del]').onclick = function () {
        if (!confirm('Remove ' + bankName(p.bank) + ' from ' + loanName(loan) + '?')) return;
        S.data.products.splice(S.data.products.indexOf(p), 1);
        note('removed ' + p.bank + ' ' + loan);
        touch('products');
        render();
      };
    });
    if ($('#add')) $('#add').onclick = function () {
      var rate = num($('#add-rate').value);
      var url = $('#add-url').value.trim();
      if (!(rate > 0) || !/^https:\/\//.test(url)) return flash('Enter a rate and the bank\'s official https page.', 'err');
      var bank = $('#add-bank').value;
      setProduct(bank, loan, { rateFrom: rate, fee: null, prepayment: null, maxTenureYears: null, sourceUrl: url, retrievedOn: today() });
      note('added ' + bank + ' ' + loan);
      render();
    };
  }

  // ---------- banks ----------
  function banksTab() {
    var used = function (slug) { return S.data.products.filter(function (p) { return p.bank === slug; }).length; };
    app.innerHTML = '<h1>Banks</h1><p class="muted">A bank shows on the site once it has at least one approved rate.</p>' +
      '<div class="scroll"><table><thead><tr><th>Name</th><th>Short name</th><th>Slug</th><th>Rates</th><th></th></tr></thead><tbody>' +
      S.data.banks.map(function (b, i) {
        return '<tr data-i="' + i + '"><td><input data-k="name" value="' + esc(b.name) + '"></td><td><input data-k="short" value="' + esc(b.short) + '"></td><td class="muted">' + esc(b.slug) + '</td><td>' + used(b.slug) + '</td><td>' + (used(b.slug) ? '' : '<button class="b sm no" data-del>Delete</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card row"><b>Add a bank</b><input id="nb-name" placeholder="Full name, e.g. Karur Vysya Bank" style="flex:1;min-width:220px"><input id="nb-short" placeholder="Short name, e.g. KVB"><button class="b p" id="nb-add">Add bank</button></div>';
    app.querySelectorAll('tbody tr').forEach(function (tr) {
      var b = S.data.banks[+tr.getAttribute('data-i')];
      tr.querySelectorAll('[data-k]').forEach(function (inp) { inp.onchange = function () { b[inp.getAttribute('data-k')] = inp.value.trim(); note('edited bank ' + b.slug); touch('banks'); }; });
      var del = tr.querySelector('[data-del]');
      if (del) del.onclick = function () {
        if (!confirm('Delete ' + b.name + '? Its scrape sources are removed too.')) return;
        S.data.banks.splice(S.data.banks.indexOf(b), 1);
        S.data.sources = S.data.sources.filter(function (s) { return s.bank !== b.slug; });
        note('deleted bank ' + b.slug);
        touch('banks', 'sources');
        render();
      };
    });
    $('#nb-add').onclick = function () {
      var name = $('#nb-name').value.trim();
      var slug = slugify(name);
      if (!name) return flash('Enter the bank\'s name.', 'err');
      if (S.data.banks.some(function (b) { return b.slug === slug; })) return flash('That bank already exists.', 'err');
      S.data.banks.push({ slug: slug, name: name, short: $('#nb-short').value.trim() || name });
      note('added bank ' + slug);
      touch('banks');
      S.bank = slug;
      S.tab = 'sources';
      flash('Bank added. Now add its official rate pages so the scraper can read them.', 'ok');
      render();
    };
  }

  // ---------- sources ----------
  function sourcesTab() {
    var all = S.data.sources;
    var list = all.filter(function (s) { return !S.bank || s.bank === S.bank; });
    var bankOpts = function (sel) { return S.data.banks.map(function (b) { return '<option value="' + esc(b.slug) + '"' + (b.slug === sel ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join(''); };
    var loanOpts = function (sel) { return '<option value="*"' + (sel === '*' ? ' selected' : '') + '>All loans on the page</option>' + loanOptions(sel); };
    app.innerHTML = '<h1>Scrape sources</h1><p class="muted">The official bank pages the scraper reads. Use "All loans on the page" for a bank\'s rate list covering many loans. Tick "Browser" for pages that need JavaScript, "By hand" for rates the scraper cannot read (for example a rate shown as an image). "Margin over" works out a rate the bank states as its rate for another loan plus a margin.</p>' +
      '<div class="row"><select id="f-bank"><option value="">All banks</option>' + bankOpts(S.bank) + '</select><span class="muted">' + list.length + ' sources</span></div>' +
      '<div class="scroll" style="margin-top:12px"><table><thead><tr><th>Bank</th><th>Loan</th><th style="min-width:300px">Official page URL</th><th>Browser</th><th>By hand</th><th style="min-width:150px">Margin over</th><th>+ %</th><th style="min-width:160px">Note</th><th></th></tr></thead><tbody>' +
      list.map(function (s) {
        return '<tr data-i="' + all.indexOf(s) + '"><td><select data-k="bank">' + bankOpts(s.bank) + '</select></td><td><select data-k="loan">' + loanOpts(s.loan) + '</select></td><td><input type="url" data-k="url" value="' + esc(s.url) + '"></td>' +
          '<td><input type="checkbox" data-k="render"' + (s.render ? ' checked' : '') + '></td><td><input type="checkbox" data-k="manual"' + (s.manual ? ' checked' : '') + '></td>' +
          '<td><select data-k="base"><option value="">–</option>' + loanOptions(s.base) + '</select></td><td><input type="number" step="0.05" data-k="plus" value="' + esc(s.plus) + '"></td><td><input data-k="note" value="' + esc(s.note) + '"></td><td><button class="b sm no" data-del>Remove</button></td></tr>';
      }).join('') + '</tbody></table></div><p><button class="b" id="add-src">Add a source</button></p>';
    $('#f-bank').onchange = function (e) { S.bank = e.target.value; render(); };
    app.querySelectorAll('tbody tr').forEach(function (tr) {
      var s = all[+tr.getAttribute('data-i')];
      tr.querySelectorAll('[data-k]').forEach(function (inp) {
        inp.onchange = function () {
          var k = inp.getAttribute('data-k');
          if (inp.type === 'checkbox') { if (inp.checked) s[k] = true; else delete s[k]; }
          else if (inp.type === 'number') { if (num(inp.value) != null) s[k] = num(inp.value); else delete s[k]; }
          else if (inp.value.trim()) s[k] = inp.value.trim();
          else delete s[k];
          note('edited sources');
          touch('sources');
        };
      });
      tr.querySelector('[data-del]').onclick = function () { all.splice(all.indexOf(s), 1); note('edited sources'); touch('sources'); render(); };
    });
    $('#add-src').onclick = function () {
      all.push({ bank: S.bank || S.data.banks[0].slug, loan: '*', url: 'https://' });
      touch('sources');
      render();
    };
  }

  // ---------- run ----------
  function runTab() {
    var d = S.data.drafts;
    var s = d.summary || {};
    app.innerHTML = '<h1>Scraper</h1><div class="card"><p>Last run: <b>' + (d.updatedAt ? esc(new Date(d.updatedAt).toLocaleString('en-IN')) : 'never') + '</b></p>' +
      '<p class="muted">' + ['changed', 'suspect', 'new', 'failed', 'manual', 'same'].map(function (k) { return esc(STATUS[k]) + ': ' + (s[k] || 0); }).join(' · ') + '</p>' +
      '<p>It runs every morning on GitHub and emails you when there is something to review. You can also run it on your computer with <code>npm run scrape</code>.</p>' +
      '<button class="b p" id="run">Run the scraper now</button> <span class="muted" id="run-msg"></span></div><h2>Recent runs</h2><div id="runs" class="muted">Loading…</div>';
    $('#run').onclick = function () {
      $('#run').disabled = true;
      gh('/actions/workflows/scrape.yml/dispatches', { method: 'POST', body: { ref: BRANCH } }).then(function () {
        $('#run-msg').textContent = 'Started. It takes about 5 minutes; reload this page afterwards.';
        setTimeout(loadRuns, 4000);
      }, function (e) { $('#run-msg').textContent = e.status === 403 ? 'Your token needs the Actions (read and write) permission.' : e.message; $('#run').disabled = false; });
    };
    loadRuns();
  }
  function loadRuns() {
    gh('/actions/workflows/scrape.yml/runs?per_page=6').then(function (r) {
      $('#runs').innerHTML = (r.workflow_runs || []).map(function (w) {
        return '<div><a href="' + esc(w.html_url) + '" target="_blank" rel="noopener">' + esc(new Date(w.created_at).toLocaleString('en-IN')) + '</a> · ' + esc(w.event) + ' · ' + esc(w.conclusion || w.status) + '</div>';
      }).join('') || 'No runs yet.';
    }, function () { $('#runs').textContent = 'Could not list runs (the token may lack Actions read permission).'; });
  }

  // ---------- shell ----------
  var TABS = [['review', 'Review'], ['rates', 'Rates'], ['banks', 'Banks'], ['sources', 'Sources'], ['run', 'Scraper']];
  function render() {
    var nav = $('#tabs');
    nav.hidden = false;
    var todo = (S.data.drafts.items || []).filter(function (i) { return i.review === 'pending' && i.status !== 'same'; }).length;
    nav.innerHTML = TABS.map(function (t) { return '<button data-t="' + t[0] + '" aria-current="' + (S.tab === t[0]) + '">' + t[1] + (t[0] === 'review' && todo ? ' (' + todo + ')' : '') + '</button>'; }).join('');
    nav.querySelectorAll('button').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-t'); $('#flash').innerHTML = ''; render(); }; });
    ({ review: reviewTab, rates: ratesTab, banks: banksTab, sources: sourcesTab, run: runTab })[S.tab]();
    updateBar();
  }

  function signOut() {
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch (e) {}
    location.reload();
  }

  function start(token, remember) {
    S.token = token;
    app.innerHTML = '<p class="muted">Signing in…</p>';
    return gh('').then(function (repo) {
      if (!repo.permissions || !repo.permissions.push) throw new Error('This token cannot write to ' + REPO + '.');
      try { (remember ? localStorage : sessionStorage).setItem(KEY, token); } catch (e) {}
      return gh('https://api.github.com/user').then(function (u) { S.user = u.login; }, function () { S.user = 'admin'; });
    }).then(loadAll).then(function () {
      $('#who').innerHTML = esc(S.user) + '<button id="out">Sign out</button>';
      $('#out').onclick = signOut;
      render();
    }).catch(function (e) {
      try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch (x) {}
      login(e.status === 401 ? 'That token was not accepted.' : e.message);
    });
  }

  function login(error) {
    $('#tabs').hidden = true;
    app.innerHTML = '<div class="login card"><h1>Admin sign-in</h1>' + (error ? '<div class="msg err">' + esc(error) + '</div>' : '') +
      '<p class="muted">Sign in with a GitHub fine-grained access token for <b>' + esc(REPO) + '</b> with <b>Contents: read and write</b> and <b>Actions: read and write</b>. Only people who can change the repository can sign in.</p>' +
      '<form id="lf"><label for="tok">Access token</label><input type="password" id="tok" autocomplete="current-password" required placeholder="github_pat_…">' +
      '<label style="font-weight:400"><input type="checkbox" id="rem" checked> Keep me signed in on this device</label><p><button class="b p" type="submit">Sign in</button></p></form>' +
      '<p class="muted" style="font-size:.85rem">Create one at GitHub → Settings → Developer settings → Fine-grained tokens. The token stays in this browser only.</p></div>';
    $('#lf').onsubmit = function (e) { e.preventDefault(); start($('#tok').value.trim(), $('#rem').checked); };
  }

  $('#publish').onclick = publish;
  $('#discard').onclick = function () {
    if (!confirm('Discard all unpublished changes?')) return;
    app.innerHTML = '<p class="muted">Reloading…</p>';
    loadAll().then(render);
  };
  window.addEventListener('beforeunload', function (e) { if (Object.keys(S.dirty).length) { e.preventDefault(); e.returnValue = ''; } });

  var saved = null;
  try { saved = localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch (e) {}
  if (saved) start(saved, Boolean(localStorage.getItem(KEY))); else login();
})();
