// Deep check of the pdf-lib -> pdfkit path: are copied streams byte-identical to the source?
var fs = require('fs');
var crypto = require('crypto');
var pl = require('pdf-lib');
var mp = require('./miniparse');
var PDFDocument = require('./pdfkit-bundle');
var bridge = require('./bridge');

var path = require('path');
var SRC = process.argv[2] || path.resolve(__dirname, '../../../examples/kitchen-sink.pdf');
var OUT = __dirname + '/out-pdflib.pdf';
function sha(b) { return crypto.createHash('sha1').update(b).digest('hex'); }

// instrument: remember sha1 of every raw stream we hand to pdfkit, keyed by target object id
var expected = {};
var origRef;

bridge.openPdf(SRC).then(function (srcDoc) {
  var doc = new PDFDocument({ size: 'A4', margin: 0 });
  var ws = fs.createWriteStream(OUT);
  doc.pipe(ws);

  // wrap doc.ref to capture stream payloads per object id
  origRef = doc.ref.bind(doc);
  doc.ref = function (data) {
    var r = origRef(data);
    var passthrough = !!(data && data.Filter);   // only these are meant to land byte-identical;
    var origEnd = r.end.bind(r);                 // a payload with no /Filter is pdfkit's to compress
    r.end = function (chunk) {
      if (chunk && chunk.length && passthrough) expected[r.id] = { sha: sha(chunk), len: chunk.length };
      return origEnd(chunk);
    };
    return r;
  };

  doc.fontSize(14).fillColor('#c00').text('native pdfkit text + pdf-lib-parsed page below', 40, 30);
  var stats = { objects: 0, streams: 0, bytes: 0 };
  var form = bridge.importPageAsForm(doc, srcDoc, 0, stats);
  doc.page.xobjects['Fx1'] = form.ref;
  var scale = 0.45;
  doc.save();
  doc.transform(scale, 0, 0, -scale, 40, 70 + form.height * scale);
  doc.addContent('/Fx1 Do');
  doc.restore();
  doc.rect(40, 70, form.width * scale, form.height * scale).lineWidth(0.5).strokeColor('#0a0').stroke();
  doc.end();

  ws.on('finish', function () {
    var buf = fs.readFileSync(OUT);
    var r = new mp.PDFReader(buf);
    var fails = [];
    function check(n, c, d) { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '  [' + d + ']' : '')); if (!c) fails.push(n); }

    var bad = [];
    Object.keys(r.xref).forEach(function (n) {
      var off = r.xref[n];
      if (!new RegExp('^' + n + '\\s+0\\s+obj').test(buf.toString('binary', off, off + 24))) bad.push(n);
    });
    check('xref offsets all resolve', bad.length === 0, Object.keys(r.xref).length + ' objects');

    var seen = {}, streams = 0, lenErr = [], exact = 0, mismatch = [];
    (function walk(v) {
      if (v instanceof mp.PRef) {
        if (seen[v.num]) return; seen[v.num] = 1;
        if (r.xref[v.num] === undefined) throw new Error('dangling ' + v.num);
        var lex = new mp.Lexer(buf, r.xref[v.num]);
        lex.readToken(); lex.readToken(); lex.readToken();
        var o = lex.parseObject(r);
        if (o instanceof mp.PStream) {
          streams++;
          if (r.resolve(o.dict.Length) !== o.raw.length) lenErr.push(v.num);
          var exp = expected[v.num];
          if (exp) {
            if (exp.sha === sha(o.raw)) exact++;
            else mismatch.push(v.num + ' in=' + exp.len + ' out=' + o.raw.length);
          }
          walk(o.dict);
        } else walk(o);
        return;
      }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object' && !(v instanceof mp.PName) && !(v instanceof mp.PStr)) {
        for (var k in v) walk(v[k]);
      }
    })(r.trailer.Root);
    check('object graph resolves from /Root', true, Object.keys(seen).length + ' reachable');
    check('every stream /Length correct', lenErr.length === 0, streams + ' streams');
    check('handed-in stream bytes land byte-identical on disk', mismatch.length === 0 && exact > 0,
      exact + '/' + Object.keys(expected).length + ' compared' + (mismatch.length ? ' bad=' + mismatch.slice(0, 3) : ''));

    var page = r.getPage(0);
    var res = r.resolve(page.dict.Resources !== undefined ? page.dict.Resources : page.inherited.Resources);
    var xo = r.resolve(res.XObject) || {};
    var form2 = r.resolve(xo.Fx1);
    check('/Fx1 is a Form XObject', form2 instanceof mp.PStream && form2.dict.Subtype.raw === 'Form',
      form2 ? 'BBox=' + JSON.stringify(form2.dict.BBox) : 'missing');
    var pc = r.decode(r.resolve(page.dict.Contents)).toString('binary');
    check('page invokes /Fx1 Do and keeps native content', pc.indexOf('/Fx1 Do') >= 0 && /BT|Tf/.test(pc));

    // PDF string round-trip: no string should have leaked out as a bare name
    var leaked = /\/CharSet *\/[A-Za-z]/.test(buf.toString('binary'));
    check('PDF strings did not leak as names (Buffer-identity trap)', !leaked);

    // compare against the source: same resource stream contents present?
    var srcR = new mp.PDFReader(fs.readFileSync(SRC));
    var srcShas = {};
    Object.keys(srcR.xref).forEach(function (n) {
      try { var o = srcR.get(+n); if (o instanceof mp.PStream) srcShas[sha(o.raw)] = +n; } catch (e) {}
    });
    var matchedFromSource = 0;
    Object.keys(expected).forEach(function (id) { if (srcShas[expected[id].sha] !== undefined) matchedFromSource++; });
    check('copied streams traced back to source objects', matchedFromSource > 0,
      matchedFromSource + ' of ' + Object.keys(expected).length + ' streams identical to a source stream');

    console.log('\noutput: ' + OUT + ' (' + buf.length + ' bytes, source ' + fs.statSync(SRC).size + ')');
    console.log(fails.length ? '*** ' + fails.length + ' FAILED ***' : 'ALL CHECKS PASSED');
  });
}).catch(function (e) { console.log('ERROR:', e.message); });
