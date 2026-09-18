// Option B: pdf-lib as the PARSER, pdfkit as the WRITER.
// Places page 1 of an external PDF onto the current pdfkit page as a Form XObject.
var fs = require('fs');
var pl = require('pdf-lib');

// pdfkit turns any JS string into /Name, Buffers into <hex> (but see the Buffer-identity
// trap in the bundle), so pre-serialised tokens are passed through this wrapper.
function rawToken(text) { var m = new Map(); m.toString = function () { return text; }; return m; }

function nameKey(pdfName) { return pdfName.asString().slice(1); } // '/Foo' -> 'Foo'

function makeBridge(doc, srcDoc, stats) {
  var ctx = srcDoc.context;
  var map = {}; // "num gen" -> pdfkit ref

  function copy(o) {
    if (o instanceof pl.PDFRef) return mapRef(o);
    if (o instanceof pl.PDFName) return nameKey(o);
    if (o instanceof pl.PDFNumber) return o.asNumber();
    if (o instanceof pl.PDFBool) return o.asBoolean();
    if (o === pl.PDFNull || o === undefined || o === null) return null; // PDFNull is a singleton, not a class
    if (o instanceof pl.PDFString || o instanceof pl.PDFHexString) return rawToken(o.toString());
    if (o instanceof pl.PDFArray) return o.asArray().map(copy);
    if (o instanceof pl.PDFDict) {
      var out = {};
      o.entries().forEach(function (e) { out[nameKey(e[0])] = copy(e[1]); });
      return out;
    }
    if (o instanceof pl.PDFRawStream) throw new Error('stream must be indirect');
    return rawToken(o.toString()); // anything exotic: keep its own serialisation
  }

  function mapRef(ref) {
    var key = ref.objectNumber + ' ' + ref.generationNumber;
    if (map[key]) return map[key];
    var src = ctx.lookup(ref);

    if (src instanceof pl.PDFRawStream) {
      var dict = src.dict;
      // /Filter must be present when doc.ref() is called, or pdfkit re-deflates the bytes.
      var data = {};
      var filter = dict.get(pl.PDFName.of('Filter'));
      if (filter) data.Filter = copy(filter);
      var r = doc.ref(data);
      map[key] = r;
      dict.entries().forEach(function (e) {
        var k = nameKey(e[0]);
        if (k === 'Length' || k === 'Filter') return;
        data[k] = copy(e[1]);
      });
      r.end(Buffer.from(src.contents));   // raw, still-encoded bytes: no re-encoding
      stats.streams++; stats.bytes += src.contents.length;
      return r;
    }

    var d = {};
    var r2 = doc.ref(d);
    map[key] = r2;
    var v = copy(src);
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map)) {
      Object.keys(v).forEach(function (k) { d[k] = v[k]; });
    } else { r2.data = v; }
    r2.end();
    stats.objects++;
    return r2;
  }

  return { copy: copy, mapRef: mapRef };
}

// returns { ref, width, height } - a Form XObject in the pdfkit document
function importPageAsForm(doc, srcDoc, pageIndex, stats) {
  var page = srcDoc.getPage(pageIndex);
  var node = page.node;
  var bridge = makeBridge(doc, srcDoc, stats);

  // pdf-lib resolves inherited page attributes for us
  var boxObj = node.CropBox() || node.MediaBox();
  if (!boxObj) throw new Error('page has no MediaBox/CropBox');
  var box = boxObj.asArray().map(function (n) { return srcDoc.context.lookupMaybe(n, pl.PDFNumber).asNumber(); });
  var rotate = node.Rotate ? (node.Rotate() ? node.Rotate().asNumber() : 0) : 0;

  var contents = node.Contents();
  if (!contents) throw new Error('page has no /Contents');
  var streams = contents instanceof pl.PDFArray
    ? contents.asArray().map(function (r) { return srcDoc.context.lookup(r); })
    : [contents];
  var parts = [];
  streams.forEach(function (st) {
    parts.push(Buffer.from(pl.decodePDFRawStream(st).decode()));
    parts.push(Buffer.from('\n'));
  });

  var res = node.Resources();
  var resources = res ? bridge.copy(res) : {};
  // if Resources was an indirect object, copy() already produced a ref

  var formDict = {
    Type: 'XObject', Subtype: 'Form', FormType: 1,
    BBox: box,
    Matrix: [1, 0, 0, 1, -box[0], -box[1]],
    Resources: resources
  };
  var group = node.get(pl.PDFName.of('Group'));
  if (group) formDict.Group = bridge.copy(group);

  var form = doc.ref(formDict);
  form.end(Buffer.concat(parts));
  stats.objects++;

  var w = box[2] - box[0], h = box[3] - box[1];
  var swap = Math.abs(rotate % 180) === 90;
  return { ref: form, width: swap ? h : w, height: swap ? w : h, rotate: rotate };
}

// doc.addPdf(path) shaped helper: load is async because pdf-lib's API is async
function openPdf(path) {
  return pl.PDFDocument.load(new Uint8Array(fs.readFileSync(path)), {
    updateMetadata: false, throwOnInvalidObject: false
  });
}

module.exports = { openPdf: openPdf, importPageAsForm: importPageAsForm, rawToken: rawToken };
