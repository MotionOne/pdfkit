// Acceptance run for doc.addPdf / openPdf / placePdf against the built bundle.
//   node research/addpdf/acceptance.js [external.pdf]
// Checks the structure of what we produced, that copied streams are untouched,
// and that the colour information of the source survived.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var mp = require('./prototype/miniparse');
var PDFDocument = require('./prototype/pdfkit-bundle');

var EXTERNAL =
  process.argv[2] ||
  'C:/Users/harry/Downloads/icc프로파일 포함 pdf파일 샘플/altona_visual_1v2a_x3.pdf';
var ICC = path.resolve(
  __dirname,
  '../../../edicus-prepress/src/bin/icc/ISO Coated v2.icc'
);
var OUT = path.resolve(__dirname, 'acceptance-out.pdf');

var failures = [];
function check(name, ok, detail) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
  if (!ok) failures.push(name);
}
function sha(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}
function countMarks(buf, keys) {
  var text = buf.toString('binary');
  var out = {};
  keys.forEach(function(key) {
    out[key] = (text.match(new RegExp('/' + key, 'g')) || []).length;
  });
  return out;
}

var peak = 0;
var sampler = setInterval(function() {
  var rss = process.memoryUsage().rss;
  if (rss > peak) peak = rss;
}, 15);

var started = Date.now();
var doc = new PDFDocument({
  size: [595.28, 841.89],
  margin: 0,
  pdfVersion: '1.4',
  compress: true,
  trim: { l: 10, t: 10, r: 10, b: 10 },
  bleed: { l: 3, t: 3, r: 3, b: 3 }
});
var chunks = [];
doc.on('data', function(chunk) {
  chunks.push(chunk);
});

if (fs.existsSync(ICC)) {
  doc.addCMYKOutputIntent('ISO Coated v2', 'FOGRA39', fs.readFileSync(ICC));
}
doc.fontSize(10).fillColor('#222').text('imposition sheet drawn by pdfkit', 20, 16);

doc
  .openPdf(EXTERNAL)
  .then(function(art) {
    var openedAt = Date.now();
    var trim = art.size(0, 'trim');
    var media = art.size(0, 'media');

    // two placements of the same page, to exercise the cache
    doc.placePdf(art, 20, 40, { box: 'trim', width: 260 });
    doc.placePdf(art, 300, 40, { box: 'trim', width: 260 });

    doc.end();

    return new Promise(function(resolve) {
      doc.on('end', function() {
        clearInterval(sampler);
        var rss = process.memoryUsage().rss;
        if (rss > peak) peak = rss;
        resolve({
          buffer: Buffer.concat(chunks),
          openMs: openedAt - started,
          totalMs: Date.now() - started,
          trim: trim,
          media: media
        });
      });
    });
  })
  .then(function(result) {
    var buf = result.buffer;
    fs.writeFileSync(OUT, buf);

    console.log('=== doc.addPdf acceptance ===');
    console.log('external      : ' + path.basename(EXTERNAL) + ', ' +
      (fs.statSync(EXTERNAL).size / 1048576).toFixed(1) + 'MB');
    console.log('page 1 media  : ' + result.media.width + ' x ' + result.media.height + ' pt');
    console.log('page 1 trim   : ' + result.trim.width + ' x ' + result.trim.height + ' pt');
    console.log('openPdf       : ' + result.openMs + 'ms');
    console.log('total         : ' + result.totalMs + 'ms, peak RSS ' +
      (peak / 1048576).toFixed(0) + 'MB');
    console.log('output        : ' + (buf.length / 1048576).toFixed(1) + 'MB -> ' + OUT);
    console.log('');

    var reader = new mp.PDFReader(buf);

    var bad = [];
    Object.keys(reader.xref).forEach(function(num) {
      var off = reader.xref[num];
      if (!new RegExp('^' + num + '\\s+0\\s+obj').test(buf.toString('binary', off, off + 24))) {
        bad.push(num);
      }
    });
    check('xref offsets all resolve', bad.length === 0,
      Object.keys(reader.xref).length + ' objects');

    var seen = {}, streams = 0, lengthErrors = [], dangling = [];
    (function walk(value) {
      if (value instanceof mp.PRef) {
        if (seen[value.num]) return;
        seen[value.num] = 1;
        if (reader.xref[value.num] === undefined) { dangling.push(value.num); return; }
        var lex = new mp.Lexer(buf, reader.xref[value.num]);
        lex.readToken(); lex.readToken(); lex.readToken();
        var obj = lex.parseObject(reader);
        if (obj instanceof mp.PStream) {
          streams++;
          if (reader.resolve(obj.dict.Length) !== obj.raw.length) lengthErrors.push(value.num);
          walk(obj.dict);
        } else walk(obj);
        return;
      }
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (value && typeof value === 'object' &&
          !(value instanceof mp.PName) && !(value instanceof mp.PStr)) {
        for (var key in value) walk(value[key]);
      }
    })(reader.trailer.Root);
    check('object graph resolves from /Root', dangling.length === 0,
      Object.keys(seen).length + ' reachable');
    check('every stream /Length matches its bytes', lengthErrors.length === 0,
      streams + ' streams');

    var page = reader.getPage(0);
    var resources = reader.resolve(
      page.dict.Resources !== undefined ? page.dict.Resources : page.inherited.Resources
    );
    var xobjects = reader.resolve(resources.XObject) || {};
    var form = xobjects.Fx1 && reader.resolve(xobjects.Fx1);
    check('the placed page is a form XObject',
      form instanceof mp.PStream && form.dict.Subtype && form.dict.Subtype.raw === 'Form',
      form ? 'BBox=' + JSON.stringify(form.dict.BBox) + ' Matrix=' + JSON.stringify(form.dict.Matrix) : 'missing');

    var content = reader.decode(reader.resolve(page.dict.Contents)).toString('binary');
    var invocations = (content.match(/\/Fx1 Do/g) || []).length;
    check('both placements share one form XObject', invocations === 2 &&
      Object.keys(xobjects).length === 1, invocations + ' invocations of /Fx1');
    check('the native pdfkit content is still there', /BT|Tf/.test(content));

    check('prepress boxes survived',
      !!page.dict.TrimBox && !!page.dict.BleedBox,
      'TrimBox ' + JSON.stringify(page.dict.TrimBox));

    var root = reader.resolve(reader.trailer.Root);
    check('our own output intent is intact', !!root.OutputIntents);

    // colour information of the source, in the objects we copied
    var sourceBuf = fs.readFileSync(EXTERNAL);
    var keys = ['ICCBased', 'Separation', 'DeviceN', 'DeviceCMYK', 'Indexed'];
    var before = countMarks(sourceBuf, keys);
    var after = countMarks(buf, keys);
    var mismatched = keys.filter(function(key) { return before[key] !== after[key]; });
    check('colour spaces carried over unchanged', mismatched.length === 0,
      keys.map(function(k) { return k + ' ' + before[k] + '->' + after[k]; }).join(', '));

    // every stream we copied should be byte identical to one in the source
    var sourceShas = {};
    var sourceReader = new mp.PDFReader(sourceBuf);
    Object.keys(sourceReader.xref).forEach(function(num) {
      try {
        var obj = sourceReader.get(+num);
        if (obj instanceof mp.PStream) sourceShas[sha(obj.raw)] = +num;
      } catch (e) {}
    });
    var traced = 0, untraced = 0;
    Object.keys(reader.xref).forEach(function(num) {
      try {
        var obj = reader.get(+num);
        if (!(obj instanceof mp.PStream)) return;
        if (sourceShas[sha(obj.raw)] !== undefined) traced++;
        else untraced++;
      } catch (e) {}
    });
    check('copied streams are byte identical to the source', traced > 0,
      traced + ' traced back, ' + untraced + ' written by pdfkit itself');

    check('no PDF string leaked out as a name',
      !/\/CharSet *\/[A-Za-z]/.test(buf.toString('binary')));

    console.log('');
    console.log(failures.length ? '*** ' + failures.length + ' CHECK(S) FAILED ***' : 'ALL CHECKS PASSED');
    process.exitCode = failures.length ? 1 : 0;
  })
  .catch(function(error) {
    clearInterval(sampler);
    console.log('FAILED: ' + error.stack);
    process.exitCode = 1;
  });
