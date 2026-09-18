// Places a layered PDF and compares the layer structure of source and output.
//   node research/addpdf/check-layers.js <layered.pdf>
// Writes layers-out.pdf so the layer panel can be opened in a viewer as well.
var fs = require('fs');
var path = require('path');
var pl = require('pdf-lib');
var PDFDocument = require('./prototype/pdfkit-bundle');

var SOURCE = process.argv[2];
var OUT = path.resolve(__dirname, 'layers-out.pdf');

if (!SOURCE) {
  console.log('usage: node research/addpdf/check-layers.js <layered.pdf>');
  process.exit(1);
}

var failures = [];
function check(name, ok, detail) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
  if (!ok) failures.push(name);
}

var bytesOf = buffer =>
  new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

// name, type and default state of every layer, plus the layer selectors used
// in the content that actually draws
function layerReport(document, pageIndex) {
  var context = document.context;
  var report = { groups: [], on: [], off: [], order: [], selectors: [], baseState: null };

  var properties = context.lookupMaybe(
    document.catalog.get(pl.PDFName.of('OCProperties')),
    pl.PDFDict
  );
  if (!properties) return report;

  var nameOf = function(ref) {
    var group = context.lookup(ref);
    if (!(group instanceof pl.PDFDict)) return '(not a dict)';
    var title = group.get(pl.PDFName.of('Name'));
    var resolved =
      context.lookupMaybe(title, pl.PDFString) ||
      context.lookupMaybe(title, pl.PDFHexString);
    return resolved ? resolved.decodeText() : '(unnamed)';
  };

  var list = function(dict, key) {
    var array = dict && context.lookupMaybe(dict.get(pl.PDFName.of(key)), pl.PDFArray);
    return array ? array.asArray().map(nameOf) : [];
  };

  report.groups = list(properties, 'OCGs');
  var config = context.lookupMaybe(properties.get(pl.PDFName.of('D')), pl.PDFDict);
  report.on = list(config, 'ON');
  report.off = list(config, 'OFF');
  report.order = list(config, 'Order');
  var base = config && config.get(pl.PDFName.of('BaseState'));
  report.baseState = base && base.asString ? base.asString() : null;

  // which layers the drawing operators select, wherever they live
  var seen = {};
  var collect = function(text) {
    var match;
    var pattern = /\/OC\s*\/(\S+)\s+BDC/g;
    while ((match = pattern.exec(text))) {
      seen[match[1]] = (seen[match[1]] || 0) + 1;
    }
  };
  var readStreams = function(value) {
    var streams =
      value instanceof pl.PDFArray
        ? value.asArray().map(function(ref) { return context.lookup(ref); })
        : [value];
    streams.forEach(function(stream) {
      if (!stream || !stream.contents) return;
      collect(Buffer.from(pl.decodePDFRawStream(stream).decode()).toString('binary'));
    });
  };

  var page = document.getPage(pageIndex).node;
  if (page.Contents()) readStreams(page.Contents());

  var resources = page.Resources();
  var xobjects =
    resources && resources.lookupMaybe(pl.PDFName.of('XObject'), pl.PDFDict);
  if (xobjects) {
    xobjects.entries().forEach(function(entry) {
      var stream = context.lookup(entry[1]);
      if (!stream || !stream.dict) return;
      var subtype = stream.dict.get(pl.PDFName.of('Subtype'));
      if (!subtype || subtype.asString() !== '/Form') return;
      readStreams(stream);
    });
  }

  report.selectors = Object.keys(seen).sort();
  return report;
}

var sourceBuffer = fs.readFileSync(SOURCE);

pl.PDFDocument.load(bytesOf(sourceBuffer), { updateMetadata: false })
  .then(function(sourceDocument) {
    var before = layerReport(sourceDocument, 0);

    var doc = new PDFDocument({ size: 'A4', margin: 0, compress: true });
    var chunks = [];
    doc.on('data', function(chunk) { chunks.push(chunk); });

    return doc.openPdf(SOURCE).then(function(art) {
      var size = art.size(0, 'crop');
      var scale = Math.min(515 / size.width, 760 / size.height);
      doc.placePdf(art, 40, 40, { width: size.width * scale });
      doc.end();

      return new Promise(function(resolve) {
        doc.on('end', function() {
          resolve({ before: before, buffer: Buffer.concat(chunks) });
        });
      });
    });
  })
  .then(function(result) {
    fs.writeFileSync(OUT, result.buffer);
    return pl.PDFDocument.load(bytesOf(result.buffer), { updateMetadata: false })
      .then(function(outputDocument) {
        return { before: result.before, after: layerReport(outputDocument, 0), size: result.buffer.length };
      });
  })
  .then(function(result) {
    var before = result.before;
    var after = result.after;

    console.log('=== layers: ' + path.basename(SOURCE) + ' ===');
    console.log('source  groups : ' + JSON.stringify(before.groups));
    console.log('        ON     : ' + JSON.stringify(before.on) +
      '   OFF: ' + JSON.stringify(before.off) +
      (before.baseState ? '   BaseState: ' + before.baseState : ''));
    console.log('        drawn  : ' + JSON.stringify(before.selectors));
    console.log('output  groups : ' + JSON.stringify(after.groups));
    console.log('        ON     : ' + JSON.stringify(after.on) +
      '   OFF: ' + JSON.stringify(after.off));
    console.log('        drawn  : ' + JSON.stringify(after.selectors));
    console.log('output  file   : ' + OUT + ' (' + (result.size / 1048576).toFixed(1) + 'MB)');
    console.log('');

    check('every layer of the source is registered in the output',
      before.groups.length > 0 && before.groups.length === after.groups.length,
      before.groups.length + ' -> ' + after.groups.length);
    check('layer names survive', before.groups.every(function(name, index) {
      return after.groups[index] === name;
    }), after.groups.join(', '));
    check('layers visible by default stay visible',
      JSON.stringify(before.on.slice().sort()) === JSON.stringify(after.on.slice().sort()),
      JSON.stringify(after.on));
    check('layers hidden by default stay hidden',
      JSON.stringify(before.off.slice().sort()) === JSON.stringify(after.off.slice().sort()),
      JSON.stringify(after.off));
    check('layer order survives', JSON.stringify(before.order) === JSON.stringify(after.order));
    check('the drawing still selects the same layers',
      JSON.stringify(before.selectors) === JSON.stringify(after.selectors),
      JSON.stringify(after.selectors));

    console.log('');
    console.log(failures.length ? '*** ' + failures.length + ' CHECK(S) FAILED ***' : 'ALL CHECKS PASSED');
    process.exitCode = failures.length ? 1 : 0;
  })
  .catch(function(error) {
    console.log('FAILED ' + error.stack);
    process.exitCode = 1;
  });
