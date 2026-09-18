// Runs doc.addPdf over a list of real PDFs and verifies every result.
//   node research/addpdf/corpus.js list.txt
// One path per line. Prints a baseline the spec's section 8.2 tracks.
var fs = require('fs');
var path = require('path');
var mp = require('./prototype/miniparse');
var PDFDocument = require('./prototype/pdfkit-bundle');

var list = fs
  .readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .map(function(line) {
    return line.trim();
  })
  .filter(Boolean)
  .map(function(line) {
    return line.replace(/^\/c\//, 'C:/');
  });

function verify(buf) {
  var reader = new mp.PDFReader(buf);

  Object.keys(reader.xref).forEach(function(num) {
    var off = reader.xref[num];
    if (!new RegExp('^' + num + '\\s+0\\s+obj').test(buf.toString('binary', off, off + 24))) {
      throw new Error('xref offset broken for object ' + num);
    }
  });

  var seen = {};
  var streams = 0;
  (function walk(value) {
    if (value instanceof mp.PRef) {
      if (seen[value.num]) return;
      seen[value.num] = 1;
      if (reader.xref[value.num] === undefined) throw new Error('dangling ref ' + value.num);
      var lex = new mp.Lexer(buf, reader.xref[value.num]);
      lex.readToken(); lex.readToken(); lex.readToken();
      var obj = lex.parseObject(reader);
      if (obj instanceof mp.PStream) {
        streams++;
        if (reader.resolve(obj.dict.Length) !== obj.raw.length) {
          throw new Error('bad /Length on object ' + value.num);
        }
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

  var page = reader.getPage(0);
  var resources = reader.resolve(
    page.dict.Resources !== undefined ? page.dict.Resources : page.inherited.Resources
  );
  var xobjects = reader.resolve(resources.XObject);
  if (!xobjects || !xobjects.Fx1) throw new Error('no /Fx1 on the output page');
  var form = reader.resolve(xobjects.Fx1);
  if (!(form instanceof mp.PStream) || form.dict.Subtype.raw !== 'Form') {
    throw new Error('/Fx1 is not a form XObject');
  }
  if (/\/CharSet *\/[A-Za-z]/.test(buf.toString('binary'))) {
    throw new Error('a PDF string leaked out as a name');
  }

  return { objects: Object.keys(reader.xref).length, streams: streams };
}

function runOne(file) {
  var name = path.basename(file);
  var started = Date.now();
  var size = 0;
  try {
    size = fs.statSync(file).size;
  } catch (e) {
    return Promise.resolve({ file: name, ok: false, why: 'unreadable' });
  }

  var doc = new PDFDocument({ size: 'A4', margin: 0, compress: true });
  var chunks = [];
  doc.on('data', function(chunk) { chunks.push(chunk); });

  return doc
    .openPdf(file)
    .then(function(art) {
      var page = art.size(0, 'crop');
      var scale = Math.min(515 / page.width, 700 / page.height);
      doc.placePdf(art, 40, 70, { width: page.width * scale });
      doc.end();

      return new Promise(function(resolve) {
        doc.on('end', function() {
          var buf = Buffer.concat(chunks);
          try {
            var checked = verify(buf);
            resolve({
              file: name, ok: true, srcSize: size, outSize: buf.length,
              ms: Date.now() - started, objects: checked.objects, streams: checked.streams
            });
          } catch (error) {
            resolve({ file: name, ok: false, why: 'VERIFY: ' + error.message.slice(0, 70) });
          }
        });
      });
    })
    .catch(function(error) {
      doc.end();
      return { file: name, ok: false, why: String(error.message).slice(0, 80) };
    });
}

var results = [];
list
  .reduce(function(chain, file) {
    return chain.then(function() {
      return runOne(file).then(function(result) {
        results.push(result);
        process.stdout.write(result.ok ? '.' : 'F');
      });
    });
  }, Promise.resolve())
  .then(function() {
    var ok = results.filter(function(r) { return r.ok; });
    console.log('\n\n=== doc.addPdf over ' + results.length + ' real PDFs ===');
    console.log('SUCCESS ' + ok.length + '   FAILED ' + (results.length - ok.length));

    var reasons = {};
    results
      .filter(function(r) { return !r.ok; })
      .forEach(function(r) {
        reasons[r.why] = (reasons[r.why] || 0) + 1;
      });
    if (Object.keys(reasons).length) {
      console.log('\nfailures by cause:');
      Object.keys(reasons).forEach(function(key) {
        console.log('  ' + reasons[key] + 'x  ' + key);
      });
    }

    var times = ok.map(function(r) { return r.ms; }).sort(function(a, b) { return a - b; });
    console.log('\nms per file: median ' + times[Math.floor(times.length / 2)] +
      ', max ' + times[times.length - 1]);
    console.log('streams copied: ' + ok.reduce(function(a, r) { return a + r.streams; }, 0));
    fs.writeFileSync(path.resolve(__dirname, 'corpus-results.json'), JSON.stringify(results, null, 1));
  });
