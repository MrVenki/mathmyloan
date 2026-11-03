// Builds a calculator report as a real PDF file in the browser, with no library.
// Loaded on demand by app.js when someone clicks "Download PDF report".
// Uses the PDF standard fonts (Helvetica), so text is limited to WinAnsi characters; ₹ prints as "Rs.".
(function (root) {
  var W = 595.28, H = 841.89, M = 40, CW = W - 2 * M, TOP = H - 40, BOTTOM = 62;
  var BLUE = [0.145, 0.388, 0.922], INK = [0.059, 0.09, 0.165], MUTED = [0.278, 0.333, 0.412], LINE = [0.886, 0.91, 0.941];
  var TAGLINE = 'The math behind every rupee.';
  var SOFT = [0.961, 0.973, 1], HEAD = [0.937, 0.965, 1], ZEBRA = [0.973, 0.98, 0.988], GOOD = [0.086, 0.4, 0.204];

  // Helvetica and Helvetica-Bold advance widths (1/1000 em) for ASCII 32-126.
  var REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  var BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

  // Map text to the WinAnsi subset the standard fonts can show.
  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/₹\s?/g, 'Rs. ').replace(/[–—−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/…/g, '...').replace(/[   ]/g, ' ').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
  }
  function width(s, bold, size) {
    var t = bold ? BOLD : REG, w = 0;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); w += c >= 32 && c <= 126 ? t[c - 32] : 556; }
    return (w * size) / 1000;
  }
  function esc(s) { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
  function n(v) { return (Math.round(v * 100) / 100).toString(); }
  function rgb(c) { return n(c[0]) + ' ' + n(c[1]) + ' ' + n(c[2]); }
  function fit(s, bold, size, max) {
    if (width(s, bold, size) <= max) return s;
    while (s.length > 1 && width(s + '...', bold, size) > max) s = s.slice(0, -1);
    return s + '...';
  }
  function wrap(s, bold, size, max) {
    var words = s.split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (cur && width(t, bold, size) > max) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function Doc(title) {
    this.title = clean(title);
    this.pages = [];
    this.newPage();
  }
  Doc.prototype.newPage = function () {
    this.ops = [];
    this.pages.push(this.ops);
    var first = this.pages.length === 1;
    if (first) {
      this.rect(0, H - 64, W, 64, BLUE);
      this.mark(M, H - 50, 36, true);
      var x = M + 46, white = [1, 1, 1];
      this.text('Math', x, H - 33, 20, true, white);
      x += width('Math', true, 20);
      this.text('My', x, H - 33, 20, true, [0.525, 0.937, 0.675]);
      x += width('My', true, 20);
      this.text('Loan', x, H - 33, 20, true, white);
      this.text(TAGLINE, M + 46, H - 47, 8.5, false, [0.86, 0.92, 1]);
      this.text('mathmyloan.com', W - M, H - 37, 11, true, white, 'r');
      this.y = H - 96;
    } else {
      this.mark(M, H - 34, 14, false);
      this.text('MathMyLoan', M + 20, H - 30, 10, true, BLUE);
      this.text(this.title, W - M, H - 30, 8.5, false, MUTED, 'r');
      this.line(M, H - 38, W - M, H - 38, LINE);
      this.y = H - 58;
    }
  };
  Doc.prototype.need = function (h) { if (this.y - h < BOTTOM) { this.newPage(); return true; } return false; };
  Doc.prototype.text = function (s, x, y, size, bold, color, align) {
    s = clean(s);
    if (align === 'r') x -= width(s, bold, size);
    else if (align === 'c') x -= width(s, bold, size) / 2;
    this.ops.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + n(size) + ' Tf ' + rgb(color || INK) + ' rg ' + n(x) + ' ' + n(y) + ' Td (' + esc(s) + ') Tj ET');
  };
  Doc.prototype.rect = function (x, y, w, h, fill) { this.ops.push(rgb(fill) + ' rg ' + n(x) + ' ' + n(y) + ' ' + n(w) + ' ' + n(h) + ' re f'); };
  // Rounded rectangle (Bezier corners), x/y is the bottom-left corner.
  Doc.prototype.rrect = function (x, y, w, h, r, fill) {
    var k = r * 0.5523;
    this.ops.push(rgb(fill) + ' rg ' + [
      n(x + r) + ' ' + n(y) + ' m', n(x + w - r) + ' ' + n(y) + ' l',
      n(x + w - r + k) + ' ' + n(y) + ' ' + n(x + w) + ' ' + n(y + r - k) + ' ' + n(x + w) + ' ' + n(y + r) + ' c',
      n(x + w) + ' ' + n(y + h - r) + ' l',
      n(x + w) + ' ' + n(y + h - r + k) + ' ' + n(x + w - r + k) + ' ' + n(y + h) + ' ' + n(x + w - r) + ' ' + n(y + h) + ' c',
      n(x + r) + ' ' + n(y + h) + ' l',
      n(x + r - k) + ' ' + n(y + h) + ' ' + n(x) + ' ' + n(y + h - r + k) + ' ' + n(x) + ' ' + n(y + h - r) + ' c',
      n(x) + ' ' + n(y + r) + ' l',
      n(x) + ' ' + n(y + r - k) + ' ' + n(x + r - k) + ' ' + n(y) + ' ' + n(x + r) + ' ' + n(y) + ' c',
    ].join(' ') + ' h f');
  };
  // The calculator-keys logo (as assets/brand/logo.svg, on a 40-unit grid). On the blue band it sits on a white tile.
  Doc.prototype.mark = function (x, y, size, onBlue) {
    var u = size / 40, self = this;
    this.rrect(x, y, size, size, 11 * u, onBlue ? [1, 1, 1] : BLUE);
    var keys = [[8, 8, onBlue ? BLUE : [1, 1, 1]], [21, 8, [0.576, 0.773, 0.992]], [8, 21, [0.576, 0.773, 0.992]], [21, 21, [0.133, 0.773, 0.369]]];
    keys.forEach(function (k) { self.rrect(x + k[0] * u, y + (40 - k[1] - 11) * u, 11 * u, 11 * u, 3 * u, k[2]); });
    if (size >= 24) {
      // "=" on the green key; the rupee key stays plain because the standard fonts have no ₹.
      this.rrect(x + 23.6 * u, y + (40 - 24.4 - 1.7) * u, 5.8 * u, 1.7 * u, 0.85 * u, [1, 1, 1]);
      this.rrect(x + 23.6 * u, y + (40 - 27.6 - 1.7) * u, 5.8 * u, 1.7 * u, 0.85 * u, [1, 1, 1]);
    }
  };
  Doc.prototype.line = function (x1, y1, x2, y2, color) { this.ops.push(rgb(color) + ' RG 0.6 w ' + n(x1) + ' ' + n(y1) + ' m ' + n(x2) + ' ' + n(y2) + ' l S'); };

  Doc.prototype.heading = function (s) {
    this.need(40);
    this.y -= 8;
    this.text(s, M, this.y - 12, 12.5, true, INK);
    this.y -= 20;
    this.line(M, this.y, W - M, this.y, LINE);
    this.y -= 10;
  };
  Doc.prototype.para = function (s, size, color) {
    var self = this;
    size = size || 9;
    wrap(clean(s), false, size, CW).forEach(function (l) {
      self.need(size + 4);
      self.text(l, M, self.y - size, size, false, color || MUTED);
      self.y -= size + 4;
    });
    this.y -= 4;
  };
  // Label/value tiles, two per row.
  // Long values wrap onto a second, slightly smaller line rather than being cut off.
  Doc.prototype.tiles = function (items) {
    var gap = 10, w = (CW - gap) / 2, self = this;
    var lay = items.map(function (it) {
      var v = clean(it[1]), size = 12, lines = [v];
      if (width(v, true, 12) > w - 20) {
        size = 10.5;
        lines = wrap(v, true, size, w - 20).slice(0, 2);
        if (lines.length === 2) lines[1] = fit(lines[1], true, size, w - 20);
      }
      return { it: it, size: size, lines: lines, h: lines.length > 1 ? 50 : 38 };
    });
    for (var i = 0; i < lay.length; i += 2) {
      var h = Math.max(lay[i].h, lay[i + 1] ? lay[i + 1].h : 0);
      this.need(h + gap);
      for (var j = 0; j < 2 && i + j < lay.length; j++) {
        var t = lay[i + j], x = M + j * (w + gap), top = this.y, color = t.it[2] ? BLUE : INK;
        this.rect(x, top - h, w, h, t.it[2] ? HEAD : SOFT);
        this.text(fit(clean(t.it[0]), false, 8, w - 20), x + 10, top - 13, 8, false, MUTED);
        t.lines.forEach(function (l, k) { self.text(l, x + 10, top - 30 - k * 13, t.size, true, color); });
      }
      this.y -= h + gap;
    }
  };
  // A table that repeats its header row on every page it spans.
  Doc.prototype.table = function (t) {
    var cols = t.head.length, self = this;
    var fr = t.widths || t.head.map(function (_, i) { return i === 0 ? 1.3 : 1; });
    var tot = fr.reduce(function (a, b) { return a + b; }, 0);
    var ws = fr.map(function (f) { return (f / tot) * CW; });
    var align = t.align || t.head.map(function (_, i) { return i === 0 ? 'l' : 'r'; });
    var rh = 15, hh = 18;
    function header() {
      self.rect(M, self.y - hh, CW, hh, HEAD);
      var x = M;
      t.head.forEach(function (h, i) {
        var s = fit(clean(h), true, 7.8, ws[i] - 10);
        self.text(s, align[i] === 'r' ? x + ws[i] - 5 : x + 5, self.y - 12, 7.8, true, MUTED, align[i] === 'r' ? 'r' : null);
        x += ws[i];
      });
      self.y -= hh;
    }
    this.need(hh + rh * 2);
    header();
    t.rows.forEach(function (row, r) {
      if (self.need(rh)) header();
      if (r % 2) self.rect(M, self.y - rh, CW, rh, ZEBRA);
      var x = M;
      for (var i = 0; i < cols; i++) {
        var s = fit(clean(row[i]), i === 0 && t.boldFirst, 8.3, ws[i] - 10);
        self.text(s, align[i] === 'r' ? x + ws[i] - 5 : x + 5, self.y - 10.5, 8.3, i === 0 && t.boldFirst, INK, align[i] === 'r' ? 'r' : null);
        x += ws[i];
      }
      self.y -= rh;
    });
    this.line(M, this.y, W - M, this.y, LINE);
    this.y -= 12;
  };

  Doc.prototype.finish = function (generated) {
    var total = this.pages.length, self = this;
    this.pages.forEach(function (ops, i) {
      self.ops = ops;
      // Footer
      self.line(M, 44, W - M, 44, LINE);
      self.text('Estimates for planning only, not a loan offer. Bank rates are advertised starting rates from official bank websites.', M, 32, 7, false, MUTED);
      self.text('Generated at mathmyloan.com on ' + generated, M, 22, 7, false, MUTED);
      self.text('Page ' + (i + 1) + ' of ' + total, W - M, 22, 7.5, true, MUTED, 'r');
      // Watermark across the middle of every page, drawn last at low opacity so it shows over table fills.
      var wm = 'MathMyLoan.com', size = 66, a = 33 * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      var half = width(wm, true, size) / 2, x = W / 2 - half * c, y = H / 2 - half * s - 20;
      ops.push('q /GS1 gs BT /F2 ' + size + ' Tf ' + rgb(BLUE) + ' rg ' + n(c) + ' ' + n(s) + ' ' + n(-s) + ' ' + n(c) + ' ' + n(x) + ' ' + n(y) + ' Tm (' + wm + ') Tj ET Q');
    });
    return serialize(this.pages, this.title, generated);
  };

  function serialize(pages, title, generated) {
    var objs = [];
    var add = function (s) { objs.push(s); return objs.length; };
    var catalog = add(''), pagesObj = add('');
    var f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    var f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var gs = add('<< /Type /ExtGState /ca 0.09 /CA 0.09 >>');
    var res = '<< /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >> /ExtGState << /GS1 ' + gs + ' 0 R >> >>';
    var kids = pages.map(function (ops) {
      var body = ops.join('\n');
      var content = add('<< /Length ' + body.length + ' >>\nstream\n' + body + '\nendstream');
      return add('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources ' + res + ' /Contents ' + content + ' 0 R >>');
    });
    objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>';
    objs[pagesObj - 1] = '<< /Type /Pages /Count ' + kids.length + ' /Kids [' + kids.map(function (k) { return k + ' 0 R'; }).join(' ') + '] >>';
    var info = add('<< /Title (' + esc(title) + ') /Author (MathMyLoan.com) /Creator (mathmyloan.com) /Subject (' + esc('Generated on ' + generated) + ') >>');
    var out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', offsets = [];
    objs.forEach(function (o, i) { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    var bytes = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }

  // report: { title, subtitle, inputs: [[label, value]], results: [[label, value, highlight]],
  //           sections: [{ title, note, head, rows, widths, align, boldFirst }], notes: [text] }
  function build(report, now) {
    now = now || new Date();
    var generated = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    var d = new Doc(report.title);
    d.text(report.title, M, d.y - 16, 17, true, INK);
    d.y -= 24;
    if (report.subtitle) d.para(report.subtitle, 9.5, MUTED);
    if (report.inputs && report.inputs.length) { d.heading('Your inputs'); d.tiles(report.inputs); }
    if (report.results && report.results.length) { d.heading('Results'); d.tiles(report.results); }
    (report.sections || []).forEach(function (s) {
      d.heading(s.title);
      if (s.note) d.para(s.note, 8.5);
      d.table(s);
    });
    if (report.notes && report.notes.length) { d.heading('Notes'); report.notes.forEach(function (t) { d.para(t, 8.5); }); }
    return d.finish(generated);
  }

  function download(report) {
    var bytes = build(report);
    var name = 'MathMyLoan-' + clean(report.file || report.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.pdf';
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return name;
  }

  root.MMLPdf = { build: build, download: download, clean: clean };
})(typeof window !== 'undefined' ? window : globalThis);
