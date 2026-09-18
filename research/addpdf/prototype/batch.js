// Same corpus, same verification as the self-written-parser spike, but parsed by pdf-lib.
var fs = require('fs');
var mp = require('./miniparse');          // used ONLY to verify the produced output
var PDFDocument = require('./pdfkit-bundle');
var bridge = require('./bridge');

var list = fs.readFileSync(process.argv[2], 'utf8').split('\n')
  .map(function (s) { return s.trim(); }).filter(Boolean)
  .map(function (p) { return p.replace(/^\/c\//, 'C:/'); });

function verify(buf) {
  var r = new mp.PDFReader(buf);
  Object.keys(r.xref).forEach(function (n) {
    var off = r.xref[n];
    if (!new RegExp('^' + n + '\\s+0\\s+obj').test(buf.toString('binary', off, off + 24)))
      throw new Error('xref offset broken for obj ' + n);
  });
  var seen = {}, streams = 0;
  (function walk(v) {
    if (v instanceof mp.PRef) {
      if (seen[v.num]) return; seen[v.num] = 1;
      if (r.xref[v.num] === undefined) throw new Error('dangling ref ' + v.num);
      var lex = new mp.Lexer(buf, r.xref[v.num]);
      lex.readToken(); lex.readToken(); lex.readToken();
      var o = lex.parseObject(r);
      if (o instanceof mp.PStream) {
        streams++;
        if (r.resolve(o.dict.Length) !== o.raw.length) throw new Error('bad /Length on obj ' + v.num);
        walk(o.dict);
      } else walk(o);
      return;
    }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object' && !(v instanceof mp.PName) && !(v instanceof mp.PStr)) {
      for (var k in v) walk(v[k]);
    }
  })(r.trailer.Root);
  var page = r.getPage(0);
  var res = r.resolve(page.dict.Resources !== undefined ? page.dict.Resources : page.inherited.Resources);
  var xo = r.resolve(res.XObject) || {};
  if (!xo.Fx1) throw new Error('/Fx1 missing from output page resources');
  var form = r.resolve(xo.Fx1);
  if (!(form instanceof mp.PStream) || form.dict.Subtype.raw !== 'Form') throw new Error('/Fx1 not a Form XObject');
  return { objects: Object.keys(r.xref).length, streams: streams };
}

function runOne(f) {
  var name = f.split('/').pop();
  var t0 = Date.now();
  var stats = { objects: 0, streams: 0, bytes: 0 };
  var size = 0;
  try { size = fs.statSync(f).size; } catch (e) { return Promise.resolve({ f: name, ok: false, why: 'stat failed' }); }

  return bridge.openPdf(f).then(function (srcDoc) {
    var tParse = Date.now() - t0;
    return new Promise(function (resolve) {
      var chunks = [], settled = false;
      function done(r) { if (!settled) { settled = true; resolve(r); } }
      var doc = new PDFDocument({ size: 'A4', margin: 0 });
      doc.on('data', function (c) { chunks.push(c); });
      doc.on('end', function () {
        var buf = Buffer.concat(chunks);
        try {
          var v = verify(buf);
          done({ f: name, ok: true, srcSize: size, outSize: buf.length, parseMs: tParse, ms: Date.now() - t0,
                 objs: stats.objects, streams: stats.streams, bytes: stats.bytes, outObjs: v.objects,
                 encrypted: srcDoc.isEncrypted });
        } catch (e) { done({ f: name, ok: false, why: 'VERIFY: ' + e.message.slice(0, 70) }); }
      });
      doc.on('error', function (e) { done({ f: name, ok: false, why: 'stream: ' + e.message.slice(0, 60) }); });
      try {
        var form = bridge.importPageAsForm(doc, srcDoc, 0, stats);
        doc.page.xobjects['Fx1'] = form.ref;
        var scale = Math.min(595 / form.width, 842 / form.height);
        doc.save();
        doc.transform(scale, 0, 0, -scale, 0, form.height * scale);
        doc.addContent('/Fx1 Do');
        doc.restore();
        doc.end();
      } catch (e) { done({ f: name, ok: false, why: e.message.slice(0, 80) }); }
    });
  }).catch(function (e) {
    return { f: name, ok: false, why: (e.constructor ? e.constructor.name + ': ' : '') + String(e.message).slice(0, 80) };
  });
}

var results = [];
list.reduce(function (p, f) {
  return p.then(function () {
    return runOne(f).then(function (r) {
      results.push(r);
      fs.appendFileSync(__dirname + '/progress.log',
        (r.ok ? 'OK   ' : 'FAIL ') + (r.ms || 0) + 'ms  ' + r.f.slice(0, 42) + '  ' + (r.why || '') + '\n');
    });
  });
}, Promise.resolve()).then(function () {
  var ok = results.filter(function (r) { return r.ok; });
  console.log('=== pdf-lib parser + pdfkit writer, ' + results.length + ' real-world PDFs ===');
  console.log('SUCCESS ' + ok.length + '   FAILED ' + (results.length - ok.length));
  var reasons = {};
  results.filter(function (r) { return !r.ok; }).forEach(function (r) {
    reasons[r.why.slice(0, 74)] = (reasons[r.why.slice(0, 74)] || 0) + 1;
  });
  console.log('\nfailures by cause:');
  Object.keys(reasons).forEach(function (k) { console.log('  ' + reasons[k] + 'x  ' + k); });
  console.log('\nstreams copied byte-for-byte: ' +
    (ok.reduce(function (a, r) { return a + r.bytes; }, 0) / 1048576).toFixed(1) + ' MB across ' +
    ok.reduce(function (a, r) { return a + r.streams; }, 0) + ' streams');
  var parse = ok.map(function (r) { return r.parseMs; }).sort(function (a, b) { return a - b; });
  var tot = ok.map(function (r) { return r.ms; }).sort(function (a, b) { return a - b; });
  console.log('pdf-lib parse ms: median ' + parse[Math.floor(parse.length / 2)] + ', max ' + parse[parse.length - 1]);
  console.log('total ms/file   : median ' + tot[Math.floor(tot.length / 2)] + ', max ' + tot[tot.length - 1]);
  fs.writeFileSync(__dirname + '/batch-pdflib.json', JSON.stringify(results, null, 1));
});
